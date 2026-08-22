"""
tools/explore.py — the orchestration tool (10-tool JSON routing).

Takes a scientist's free-text message and, in order:
  1. extracts a structured SCOPE (topics/genes/diseases/assets/methods) via the
     LLM — empty fields are expected and left empty, never invented;
  2. ROUTES to a subset of the 10 search tools via a JSON routing prompt (native
     function-calling was unreliable for parallel calls on Groq, so the LLM
     instead returns {"tools": [...], "reasoning": "..."} which we parse);
  3. builds each chosen tool's query from the RIGHT slice of scope — grants /
     trials / papers get the disease + topic; tools / resources get the method +
     gene; datasets and pager get disease + gene + topic(tissue) — NOT method;
     people get disease + method; wiki gets the topic. The slices are NEVER
     swapped (a grant search must not be run with a technique string, etc.);
  4. runs the chosen tools in parallel (failures isolated);
  5. returns {scope, tools_called, reasoning, sections:[{kind, items}]}.

The LLM only DECIDES which tools to run; the query strings are built
deterministically here from scope. No ranking is ever claimed that isn't backed
by a real signal (see models.Signal). A deterministic heuristic is the fallback
if the routing JSON can't be parsed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re

import llm

logger = logging.getLogger(__name__)
from cache import (
    STALE_DEFAULT_FEED,
    STALE_LLM,
    STALE_TOPIC,
    TTL_DEFAULT_FEED,
    TTL_LLM,
    TTL_TOPIC,
    cache,
    normalize_key,
)
from tools.search_chembl import search_chembl_async
from tools.search_datasets import search_datasets_async
from tools.search_grants import search_grants_async
from tools.search_lab_resources import search_lab_resources
from tools.search_news import search_news_async
from tools.search_opentargets import search_opentargets_async
from tools.search_pager import search_pager_async
from tools.search_papers import search_papers_async, search_papers_multi_dual_async
from tools.search_people import search_people
from tools.search_tools import search_tools_async
from tools.search_trials import search_trials_async
from tools.search_wiki import search_wiki

SCOPE_KEYS = ["topics", "genes", "diseases", "assets", "methods"]

_NET_LIMIT = 10        # external-source tools (papers/trials/grants/tools)
_INTERNAL_LIMIT = 20   # internal DB tools (lab_resources/people/wiki)

# search_papers ENTITY FAN-OUT — see tools/search_papers.py's module docstring
# for why this exists at all (the diagnosed bag-of-words dilution bug) and
# _entity_queries_for_papers() below for the exact query-set construction.
#
# CAP: a project naming 8 genes must not fire 8 x 3-sources = 24 raw upstream
# calls with no limit at all. Capped at 4 genes (+1 broad query when there's
# more than one gene) = at most 5 sub-queries x 3 sources = 15 raw calls per
# search_papers section, vs. 3 before fan-out — see the query builder's own
# docstring for the full accounting. Genes beyond the cap are DROPPED, not
# folded into a leftover query: kept in EXTRACTION ORDER (scope['genes'] is
# already order-preserving from _extract_scope, and a scope's headline target
# tends to be mentioned first in the source text), so the first 4 genes
# mentioned are queried and later ones are silently skipped. A real
# limitation for an 8-gene project, not a full fix — flagged, not solved.
_GENE_QUERY_CAP = 4

# Blank-input landing feed: a field-wide default scope + a fixed tool set (the
# front page for an empty query). No LLM is called — we skip extraction/routing.
_EMPTY_SCOPE: dict[str, list[str]] = {key: [] for key in SCOPE_KEYS}
_DEFAULT_SCOPE: dict[str, list[str]] = {
    **_EMPTY_SCOPE,
    "topics": ["drug discovery", "AI in drug discovery"],
}
_DEFAULT_TOOLS = [
    "search_news", "search_papers", "search_tools",
    "search_trials", "search_grants", "search_wiki",
]

# PERSONALIZED landing feed: the same blank-input feed, but scoped to terms the
# caller supplies (the signed-in user's saved interests — see the frontend's
# lib/server/interests.ts). They become the scope's `topics` verbatim: no LLM
# runs, exactly as for the generic default feed, so the personalized front page
# is just as cheap. Bounds mirror the interests column's own caps (20 × 60) so a
# tampered payload can't turn the feed into an unbounded fan-out.
_MAX_SCOPE_TERMS = 20
_MAX_TERM_CHARS = 60


def _clean_terms(terms) -> list[str]:
    """Normalize caller-supplied scope terms: whitespace-collapsed, length- and
    count-capped, de-duplicated case-insensitively, order preserved."""
    out: list[str] = []
    seen: set[str] = set()
    for term in terms or []:
        # Non-strings are dropped, not coerced: str(None) is the string "None",
        # which would search for it.
        if not isinstance(term, str):
            continue
        text = " ".join(term.split())[:_MAX_TERM_CHARS].strip()
        if not text or text.lower() in seen:
            continue
        seen.add(text.lower())
        out.append(text)
        if len(out) >= _MAX_SCOPE_TERMS:
            break
    return out

# ── Step 1: scope extraction ─────────────────────────────────────────────────

_SCOPE_SYSTEM = (
    "You extract a structured research scope from a scientist's message. "
    "Return ONLY a JSON object with exactly these keys, each an array of short strings:\n"
    "  topics   — the overall research subject phrases\n"
    "  genes    — gene / protein symbols (e.g. PHGDH, EGFR)\n"
    "  diseases — disease or condition names (e.g. Alzheimer's disease, glioblastoma)\n"
    "  assets   — named molecules / drugs / compounds\n"
    "  methods  — experimental techniques, assays, model systems, or data types "
    "(e.g. RNA-seq, CRISPR screen, mouse model)\n"
    "Leave an array EMPTY if the message has nothing for it. NEVER invent values to "
    "fill an empty field. Output JSON only — no prose, no code fences."
)


def _loads_lenient(content: str | None) -> dict:
    """Parse a JSON object out of an LLM reply, tolerating code fences / prose."""
    if not content:
        return {}
    try:
        return json.loads(content)
    except (json.JSONDecodeError, TypeError):
        pass
    m = re.search(r"\{.*\}", content, re.DOTALL)  # first {...} block
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}
    return {}


def _normalize_scope(data: dict) -> dict:
    """Coerce to the fixed 5-key shape, each a list of non-empty strings."""
    out: dict[str, list[str]] = {}
    for key in SCOPE_KEYS:
        raw = data.get(key) if isinstance(data, dict) else None
        values = raw if isinstance(raw, list) else []
        out[key] = [str(v).strip() for v in values if str(v).strip()]
    return out


def _extract_scope(input_text: str) -> dict:
    resp = llm.complete(
        [{"role": "system", "content": _SCOPE_SYSTEM}, {"role": "user", "content": input_text}],
        temperature=0,
    )
    return _normalize_scope(_loads_lenient(resp.content))


# ── Step 2: JSON tool routing ────────────────────────────────────────────────

# One-line descriptions the router reasons over. Order defines a stable listing.
_TOOL_DESCRIPTIONS: dict[str, str] = {
    "search_papers":        "live scientific literature — PubMed / OpenAlex / Crossref",
    "search_news":          "recency-first industry news for the drug-discovery field (newest work first)",
    "search_trials":        "clinical trials — ClinicalTrials.gov",
    "search_grants":        "federal funding opportunities — Grants.gov",
    "search_tools":         "open-source software tools / repositories — GitHub",
    "search_datasets":      "gene-expression / functional-genomics DATASETS (not papers) — NCBI GEO",
    "search_pager":         "GENE SETS and PATHWAYS a gene/disease belongs to (not papers, not datasets) — PAGER",
    "search_chembl":        "drug MECHANISMS and quantified BIOACTIVITY against a specific GENE target — ChEMBL (gene-only, not disease/topic text)",
    "search_opentargets":   "target-disease EVIDENCE — association score plus the evidence-type breakdown (genetic association, literature, animal model, ...) and tractability — Open Targets (gene OR disease)",
    "search_lab_resources": "INTERNAL lab registry — techniques, equipment, models, cell lines, reagents, software for collaboration",
    "search_people":        "researchers — public platform profiles + internal collaborators",
    "search_wiki":          "INTERNAL podcast-derived episode wiki pages",
}
_KNOWN_TOOLS = list(_TOOL_DESCRIPTIONS)

_ROUTING_SYSTEM = (
    "You are Explore, a research assistant for drug-discovery scientists. Given the "
    "user's message and an extracted scope, choose which of the available tools should "
    "run. Rules:\n"
    "  • Choose ONLY tools that fit the message. One tool or several is fine; do not "
    "call everything by default.\n"
    "  • A scientific target/topic/disease/gene (e.g. 'PHGDH in Alzheimer's', or even "
    "just a bare gene symbol or disease name by itself) → papers, datasets, pager, "
    "internal resources, people, and the internal wiki. ALWAYS include BOTH datasets "
    "AND pager whenever the scope has a disease and/or a gene, even if the message "
    "doesn't explicitly ask for data or pathways — a named gene or disease is itself "
    "reason enough to check GEO for existing datasets AND PAGER for the gene sets/ "
    "pathways it belongs to.\n"
    "  • A message about DATA or a METHOD the user has (e.g. 'I have RNA-seq datasets') "
    "→ internal resources, software tools, and people who can help — not papers-first, "
    "and not search_datasets or search_pager either (both are about disease/tissue/gene "
    "targets, not the user's own method).\n"
    "  • Whenever the scope names a DISEASE — even if the message never says 'trials' or "
    "'funding' explicitly (e.g. 'CRISPR gene therapy for cystic fibrosis' names cystic "
    "fibrosis; 'PHGDH in Alzheimer's' names Alzheimer's) → ALSO include search_trials "
    "AND search_grants. Virtually every named disease has active clinical trials and "
    "funding activity worth surfacing — same reasoning as why a disease/gene alone "
    "already triggers datasets and pager above, not only when the user's own wording "
    "happens to say 'clinical trials' or 'funding'.\n"
    "  • An explicit funding ask with NO disease named ('funding for a CRISPR screen', "
    "'grant for a high-throughput assay') → grants (and relevant tools) even though the "
    "disease-triggered rule above doesn't apply to it.\n"
    "  • Whenever the scope names a GENE (e.g. 'KRAS G12C inhibitor', 'PHGDH glioblastoma') "
    "→ ALSO include search_chembl for drug mechanisms and quantified bioactivity against "
    "that gene target. GENES ONLY — a disease alone with no gene named is NOT enough to "
    "route to search_chembl (ChEMBL's target lookup needs a gene/protein symbol; a "
    "disease-only query has nothing to resolve to a target).\n"
    "  • ALWAYS include search_opentargets whenever the scope has a disease AND/OR a "
    "gene (e.g. 'PHGDH glioblastoma', 'KRAS pancreatic cancer', or even a bare gene or "
    "disease name alone) — same reasoning as datasets/pager above: a named gene or "
    "disease target is itself reason enough to check Open Targets for its association "
    "score and evidence-type breakdown (genetic association, literature, animal model, "
    "...), whether or not the user's own wording asks for 'evidence' or 'targets' "
    "explicitly. Unlike search_chembl (gene-only), search_opentargets accepts EITHER a "
    "gene OR a disease on its own.\n"
    "  • Never claim a ranking that isn't backed by a real signal.\n"
    'Return ONLY a JSON object of the form '
    '{"tools": ["search_papers", ...], "reasoning": "one sentence"}. '
    "Use exact tool names from the list. No prose, no code fences."
)


def _heuristic_tools(scope: dict) -> list[str]:
    """Deterministic scope-based routing — the fallback used only when the routing
    JSON can't be parsed. Mirrors the routing intent across the 7 tools."""
    topical = bool(scope["topics"] or scope["diseases"] or scope["genes"] or scope["assets"])
    methody = bool(scope["methods"] or scope["genes"])
    chosen: list[str] = []
    if topical:
        chosen.append("search_papers")
    if scope["diseases"]:
        chosen.append("search_trials")
        chosen.append("search_grants")
    if methody:
        chosen.append("search_tools")
        chosen.append("search_lab_resources")
    if scope["diseases"] or scope["genes"]:
        chosen.append("search_datasets")
        chosen.append("search_pager")
    if scope["genes"]:
        chosen.append("search_chembl")
    if scope["diseases"] or scope["genes"]:
        chosen.append("search_opentargets")
    if scope["diseases"] or scope["methods"]:
        chosen.append("search_people")
    if topical:
        chosen.append("search_wiki")
    return chosen


def _choose_tools(input_text: str, scope: dict) -> tuple[list[str], str | None]:
    """Route via a JSON prompt (primary), falling back to the deterministic
    heuristic if the JSON can't be parsed or names nothing valid. Returns
    (chosen tool names in order, one-sentence reasoning or None)."""
    tool_list = "\n".join(f"  - {name}: {desc}" for name, desc in _TOOL_DESCRIPTIONS.items())
    user = (
        f"Message: {input_text}\n"
        f"Extracted scope: {json.dumps(scope)}\n\n"
        f"Available tools:\n{tool_list}\n\n"
        'Return ONLY the JSON object {"tools": [...], "reasoning": "..."}.'
    )
    try:
        resp = llm.complete(
            [{"role": "system", "content": _ROUTING_SYSTEM}, {"role": "user", "content": user}],
            temperature=0,
        )
        data = _loads_lenient(resp.content)
        raw_tools = data.get("tools") if isinstance(data, dict) else None
        if isinstance(raw_tools, list):
            chosen: list[str] = []
            for t in raw_tools:
                name = str(t).strip()
                if name in _KNOWN_TOOLS and name not in chosen:
                    chosen.append(name)
            if chosen:
                reasoning = data.get("reasoning")
                return chosen, (reasoning if isinstance(reasoning, str) else None)
        # Parsed but no usable tools — fall through to the heuristic.
    except Exception:
        logger.exception("explore: LLM tool-routing failed for input=%r; using scope heuristic", input_text)
    return _heuristic_tools(scope), "fallback: routing JSON unavailable; used scope heuristic"


# ── Step 3: per-tool query construction ──────────────────────────────────────
# The RIGHT scope slice per tool. Two different composition philosophies live
# side by side here, and mixing them up is the bug this section exists to
# prevent:
#
#   RELEVANCE-RANKED sources (papers, datasets, pager, wiki, ...) — PubMed/
#   OpenAlex/Crossref/GEO/PAGER all rank a big candidate pool by best-match, so
#   a longer, richer query (more terms) generally still returns SOMETHING,
#   just possibly diluted lower down. These can afford disease + topic + gene.
#
#   STRICT-MATCHING sources (trials, grants) — verified live that
#   ClinicalTrials.gov's query.term effectively requires every term to be
#   satisfiable, not just most of them: a real diagnosed case sent
#   "glioblastoma glioblastoma clinical trials funding opportunities" (disease
#   + a topic phrase THAT NAMED THE DISEASE AGAIN + a second, unrelated topic
#   phrase about funding) and got back ZERO studies, even though a bare
#   "glioblastoma" query returns 10 — no trial record's text ever contains
#   "funding opportunities", so requiring it killed the match entirely. A
#   free-text `topics` phrase is exactly what's unsafe to feed a strict
#   matcher: it's whatever words the LLM extracted from the user's sentence,
#   not a controlled vocabulary term. This also kills the duplicate for free:
#   the reported "glioblastoma glioblastoma" happened because the disease
#   name was ALSO embedded inside a `topics` phrase ("glioblastoma clinical
#   trials") — _join_unique only dedupes EXACT term matches, not sub-phrase
#   overlap, so two literally-different strings both landed in the query.
#   Dropping `topics` removes the phrase that carried the duplicate, rather
#   than trying to dedupe at the word level.
#
#   search_trials specifically is DISEASES ONLY, no genes either — a second
#   real case (a real ALS + ATXN2 + TARDBP project) showed the SAME strict-
#   AND behavior fires from genes just as easily as from topics. A trial
#   record names a CONDITION and an INTERVENTION, but "intervention" does
#   NOT mean "the gene symbol appears as a literal string in the record" —
#   verified directly: "ALS" alone -> 10 studies, including the real BIIB105
#   ATXN2-antisense ALS trial; adding just ONE gene ("ALS ATXN2") already
#   drops that to 2; the real scope for that project extracted TWO genes
#   (ATXN2 AND TARDBP), and "ALS ATXN2 TARDBP" -> 0 — even though the BIIB105
#   trial exists and is exactly what the project needed, because ITS OWN
#   record never mentions "TARDBP". A trial record almost never spells out
#   every molecular target a project cares about; disease/condition names are
#   what trial titles and summaries reliably use. Genes stay a real, useful
#   signal for OTHER sources below (GEO, papers) — this is trials-specific.
#
#   search_grants KEEPS genes — checked directly for the same failure mode
#   and did not find it: "ATXN2" alone returns 0 grants, but "Amyotrophic
#   lateral sclerosis ATXN2" returns the SAME 10 (same top 3, same order) as
#   "Amyotrophic lateral sclerosis" alone — Grants.gov's own matching does
#   NOT appear to require every term, unlike ClinicalTrials.gov's query.term.
#   Adding a gene term neither helped nor hurt in this case; NIH/DoD award
#   text does sometimes name a target directly (unlike a trial's structured
#   condition/intervention fields), so there's a real, if unproven here,
#   upside to keeping it. Revisit if a grants case surfaces the same problem.
#
#   NOT extending this to search_tools (GitHub) — audited its existing slice
#   (methods, genes) and it's already narrow AND GitHub's own search already
#   proved tolerant of a multi-term query live (a 3-term "single cell rna
#   seq" search returned 10 good results) — no evidence it has the same
#   strict-AND behavior ClinicalTrials.gov does. Left unchanged; revisit if
#   evidence turns up, not preemptively.
#
#   NOT extending the fan-out machinery (tools/search_papers.py's entity
#   queries) to trials/grants here either — that's a separate decision once
#   this narrower composition fix is measured on its own.
#
# search_papers intentionally gets the RICHEST slice (disease + topic + gene):
# papers are the broadest result kind, so a gene target like PHGDH belongs in the
# literature query even though trials now stays disease-only and grants/
# datasets/pager stay disease + gene. NOT touched by this round's fix —
# search_papers already has
# its own entity fan-out (tools/search_papers.py:search_papers_multi_async),
# a separately verified fix for the same class of dilution problem; folding
# it into this diseases+genes composition-only fix would be redundant at
# best and would bypass that verified machinery at worst.
#
# search_datasets / search_pager: ORIGINALLY (diseases, genes, topics) with
# `topics` standing in for tissue (no dedicated tissue field in scope) — this
# was assumed safe because GEO/PAGER are RELEVANCE-RANKED, same class as
# papers, not strict-matching like ClinicalTrials.gov. That assumption held
# for search_trials/search_grants ONLY in the sense that GEO/PAGER don't 400
# or hard-fail on a long query — but the routing fix that made these two
# tools fire on more queries surfaced the SAME symptom trials had: a bare
# "glioblastoma" query returns 10/10 for both, the old diluted combined
# string ("glioblastoma glioblastoma clinical trials funding opportunities")
# returns 0/0 for both, verified directly against search_datasets_async/
# search_pager_async with no other code involved. So NCBI GEO's and PAGER's
# own search endpoints turn out to have the same strict-AND-ish behavior as
# ClinicalTrials.gov, not the OR/relevance behavior PubMed/OpenAlex have —
# the "relevance-ranked" bucket these were filed under above was wrong for
# these two specifically. Fixed the same way as trials/grants: dropped
# `topics` entirely, kept (diseases, genes) — and genes is independently
# confirmed the strong signal for GEO specifically (the PHGDH diagnostic:
# 8-9 of 10 relevant on a bare gene query). PAGER takes a single term anyway
# per its own tool docstring, so a shorter, gene/disease-only query can only
# help it, never hurt it. `topics` (tissue) is lost as a dedicated signal for
# both — a real, accepted trade-off, same one trials/grants already made.
#
# search_pager: the comment above (and the tool's own docstring in
# _TOOL_DESCRIPTIONS) already said "PAGER takes a single term anyway" but the
# slice was never actually narrowed to match — it stayed (diseases, genes),
# same as datasets. Confirmed the gap directly: "Amyotrophic lateral
# sclerosis ATXN2 TARDBP" (disease + 2 genes) returns 0 from PAGER; a bare
# "ATXN2" returns 20 real gene sets, including a TARDBP protein-interactor
# set. So PAGER turns out to be even stricter than GEO — GEO tolerated
# (diseases, genes), PAGER doesn't. Dropped to genes-only, the SAME fix
# shape as search_trials being dropped to diseases-only above. `diseases` is
# the fallback (see _FALLBACK_SLICES below) for a gene-less scope, so a
# disease-only project still gets a real PAGER query instead of skipping the
# tool or sending nothing.
_QUERY_SLICES: dict[str, tuple[str, ...]] = {
    "search_papers":        ("diseases", "topics", "genes"),  # richest slice — broadest kind; own fan-out handles dilution separately
    "search_news":          ("topics", "diseases"),           # the field, not a target — no genes
    "search_trials":        ("diseases",),                    # STRICT matcher — condition ONLY; even one gene term can zero out a real trial (see note above)
    "search_grants":        ("diseases", "genes"),            # checked for trials' same failure mode, did not find it — Grants.gov didn't reduce results when a gene was added (see note above); kept
    "search_tools":         ("methods", "genes"),             # VESTIGIAL — _query_for special-cases this to _single_method_query(), which drops genes entirely. Left here as a record: "RNA ASO preclinical ATXN2 TARDBP" (this slice's output) returned 0 GitHub repos; RNA/ASO/preclinical alone each returned 16-20, ATXN2/TARDBP alone each returned 0 — genes are actively harmful here, not just diluting, since GitHub indexes what a repo DOES, not what gene it studies.
    "search_datasets":      ("diseases", "genes"),            # VESTIGIAL — _query_for's _SINGLE_TERM_TOOLS branch overrides this. Left here as a record of the slice that turned out still-too-diluted: "Amyotrophic lateral sclerosis ATXN2 TARDBP" (this slice's output) returned 1 dataset; "ATXN2"/"TARDBP"/"Amyotrophic lateral sclerosis" alone each returned 20. Same strict-AND behavior as PAGER, confirmed directly, not assumed.
    "search_pager":         ("genes",),                       # VESTIGIAL — see _SINGLE_TERM_TOOLS in _query_for, which is what actually runs for this tool now. Left here as a record only.
    "search_chembl":        ("genes",),                       # GENE-ONLY — ChEMBL's target search resolves a gene/protein symbol to a target_chembl_id; a disease/topic string has nothing to resolve to. Single most specific gene, same _SINGLE_TERM_TOOLS-style handling as pager/datasets (see _query_for).
    "search_opentargets":   ("genes", "diseases"),             # GENE-OR-DISEASE — unlike ChEMBL, Open Targets' `search` resolves either a gene/protein symbol OR a disease name to an id (see sources/opentargets.py's GENE-PRIMARY, DISEASE-FALLBACK). VESTIGIAL — _query_for special-cases this to _opentargets_query() (single most specific gene, else single most specific disease), same "one term, not several" discipline as the strict-matcher tools above. Left here as a record only.
    "search_lab_resources": ("methods", "genes"),
    "search_people":        ("diseases", "methods"),
    "search_wiki":          ("topics",),
}

# Fallback slice used ONLY when a tool's primary slice comes out empty, so a
# chosen tool never runs with a blank query. e.g. "funding for a CRISPR screen"
# has no disease/gene, so grants falls back to methods ("CRISPR screen").
# This fixes the query STRING only; it never changes which tools were chosen.
#
# `topics` dropped from BOTH fallbacks (was (methods, topics) for each) —
# same strict-matcher reasoning as the primary slices above: a free-text
# topic phrase is exactly what's unsafe to hand ClinicalTrials.gov/Grants.gov,
# fallback or not. `methods` alone is a real risk-reduction here since the
# genuinely-empty-scope case (no disease, no gene, no method either) still
# has `_query_for`'s own last-resort — joining every scope key — as the final
# safety net; that net accepts the dilution risk only in that fully degenerate
# case, which is the one case there's nothing better to search on anyway.
_FALLBACK_SLICES: dict[str, tuple[str, ...]] = {
    "search_grants": ("methods",),
    "search_trials": ("methods",),
    # method-less scopes (e.g. the default landing feed) fall back to the topic so
    # search_tools is NOT looked up here anymore — it's special-cased in
    # _query_for to _single_method_query(), which has its own topics fallback
    # built in (most specific method, else most specific topic).
    # search_pager and search_datasets are NOT looked up here either — both
    # are in _SINGLE_TERM_TOOLS (see _query_for), which has its own disease
    # fallback built in (most specific gene, else most specific disease)
    # rather than going through this dict.
}

_KINDS: dict[str, str] = {
    "search_papers": "paper",
    "search_news": "news",
    "search_trials": "trial",
    "search_grants": "grant",
    "search_tools": "tool",
    "search_datasets": "dataset",
    "search_pager": "geneset",
    "search_chembl": "compound",
    "search_opentargets": "target",
    "search_lab_resources": "resource",
    "search_people": "person",
    "search_wiki": "episode",
}


def _join_unique(*groups: list[str]) -> str:
    """Join terms across groups, de-duplicating case-insensitively, preserving order."""
    seen: set[str] = set()
    out: list[str] = []
    for group in groups:
        for term in group:
            t = (term or "").strip()
            if not t or t.lower() in seen:
                continue
            seen.add(t.lower())
            out.append(t)
    return " ".join(out)


# Sources confirmed to have PAGER's same strict-AND behaviour rather than
# PubMed/OpenAlex-style relevance ranking: a composed multi-term query
# collapses to near-zero even though every individual term alone returns a
# full page. search_pager: "ATXN2 TARDBP" -> 0, "ATXN2" alone -> 20.
# search_datasets: "Amyotrophic lateral sclerosis ATXN2 TARDBP" -> 1,
# each single term alone -> 20. Both get the SAME single-term treatment
# here — most specific gene, else most specific disease, else the ordinary
# last-resort net — rather than duplicating the branch per tool. See
# CLAUDE.md-style audit note below `_QUERY_SLICES` for which other sources
# were checked and found NOT to need this.
#
# search_datasets (GEO) is now handled SEPARATELY from this set — see
# _datasets_query below. Diagnosed live (2026-08-21): the gene-first
# single-term rule above was built and verified against GENE-LED queries
# ("Amyotrophic lateral sclerosis ATXN2 TARDBP" -> 1; "ATXN2" alone -> 20),
# but a DISEASE+MODALITY query with no gene at all was never checked against
# that same rule, and it turns out to behave the opposite way: reducing to
# `diseases[0]` alone THROWS AWAY the modality term and returns a huge,
# modality-undifferentiated pool (bare "PDAC" -> 1560 GEO records; bare
# "pancreatic ductal adenocarcinoma" -> 1491), while sending GEO the LITERAL
# disease+modality phrase, no reduction at all, returns a small, actually
# relevant set ("pancreatic ductal adenocarcinoma bulk RNA-seq" -> 54;
# "PDAC single cell RNA-seq" -> 40; "PDAC spatial transcriptomics" -> 71;
# "pancreatic organoid drug response" -> 18). So GEO's esearch is NOT
# strict-AND across the board the way the original PHGDH/ATXN2 diagnostic
# assumed — it tolerates a several-word disease+modality phrase fine; what it
# doesn't tolerate is a GENE competing with unrelated disease/topic terms in
# the same query (confirmed again here: "KRAS G12D pancreatic cancer
# inhibitor" -> 19, healthy; "PHGDH glioblastoma metabolism" -> 0, while bare
# "PHGDH" -> 61). The dividing line the evidence actually supports is
# gene-led vs. not, not single-term vs. not — see _datasets_query.
_SINGLE_TERM_TOOLS = {"search_pager"}

# search_tools (GitHub) is the SAME collapse-under-composition bug, but a
# DIFFERENT rule, not the gene-first one above — confirmed directly on the
# ALS project: ATXN2 alone -> 0 GitHub results, TARDBP alone -> 0, while
# RNA/ASO/preclinical (the method terms) each return a full page (16-20).
# GitHub indexes what a repo DOES (a technique, an assay, a tool class), not
# what gene it studies, so the single-most-specific-GENE rule that fixed
# PAGER/GEO would zero this out on every run, not fix it. Most specific
# METHOD instead (same "longest phrase as a specificity proxy" heuristic
# _context_for_papers already uses), falling back to the single most
# specific topic, genes dropped entirely from the composition.
_MAX_TOPIC_FALLBACK_WORDS = 8  # see docstring below


def _single_method_query(scope: dict) -> str:
    """LENGTH GATE ON THE TOPIC FALLBACK: `topics` is free text extracted from
    the user's own sentence, not a controlled vocabulary — _SCOPE_SYSTEM asks
    the LLM for "short strings" but nothing downstream enforced that, so a
    degenerate extraction (no methods, no clean topic segmentation) could
    hand GitHub a near-verbatim chunk of the project description as its
    query — a real diagnosed case sent ~400 words and got back 0 results.
    A topic candidate only qualifies here if it reads like a phrase, at most
    _MAX_TOPIC_FALLBACK_WORDS words; anything longer falls through to the
    bounded last-resort join below instead of being used raw. Genes stay
    excluded from every branch here, unchanged — see the module comment
    above this function for why (GitHub indexes what a repo DOES, not what
    gene it studies; a bare gene symbol alone already returns 0 on this
    source, confirmed directly)."""
    methods = scope.get("methods") or []
    if methods:
        return max(methods, key=len).strip()
    topics = [t.strip() for t in (scope.get("topics") or []) if t.strip()]
    short_topics = [t for t in topics if len(t.split()) <= _MAX_TOPIC_FALLBACK_WORDS]
    if short_topics:
        return max(short_topics, key=len)
    # Last resort: same bounded join as _query_for's own final line, EXCEPT
    # `topics` is swapped for `short_topics` (empty here, since if any topic
    # had qualified we'd have returned above) rather than the raw field —
    # otherwise an over-long topic rejected two lines up would walk right
    # back in through this join, since _join_unique treats each scope entry
    # as one opaque term and never re-checks its own length.
    safe_scope = {**scope, "topics": short_topics}
    return _join_unique(*[safe_scope[k] for k in SCOPE_KEYS])


def _datasets_query(scope: dict) -> str:
    """GEO (search_datasets) query composition — see the note above
    _SINGLE_TERM_TOOLS for the live evidence this is built from.

    GENE-LED (scope has a gene) -> the single most specific gene, alone,
    same rule as the old _SINGLE_TERM_TOOLS branch and for the same reason:
    a gene competing with disease/topic terms in one query can zero GEO out
    ("PHGDH glioblastoma metabolism" -> 0; "PHGDH" alone -> 61). This is the
    ORIGINAL documented fix (the PHGDH/ATXN2 diagnostic in the comments
    above) and stays unchanged so it does not regress.

    NOT GENE-LED (disease/modality only, e.g. "PDAC spatial transcriptomics")
    -> the full non-gene scope (diseases + methods + topics), not just
    `diseases[0]`. This is the fix: a disease-only reduction throws away the
    modality term and returns a huge, undifferentiated pool (bare "PDAC" ->
    1560), while keeping disease+modality together returns a small, relevant
    set ("PDAC spatial transcriptomics" -> 71) — measured live, not assumed.
    Genes are still excluded from this branch (there are none, by
    definition, since this is the not-gene-led case)."""
    genes = scope.get("genes") or []
    if genes:
        return genes[0].strip()
    query = _join_unique(scope.get("diseases") or [], scope.get("methods") or [], scope.get("topics") or [])
    if query:
        return query
    # Fully degenerate scope (no gene, no disease, no method, no topic) —
    # same last-resort net as _query_for's own final line.
    return _join_unique(*[scope[k] for k in SCOPE_KEYS])


def _chembl_query(scope: dict) -> str:
    """ChEMBL (search_chembl) query composition — GENE ONLY, no disease/topic
    fallback. See fetch_chembl's own docstring: the tool resolves a gene/
    protein SYMBOL to a target_chembl_id via ChEMBL's target search; a
    disease or topic string has no target to resolve to at all, unlike
    trials/grants/GEO/PAGER, which at least accept a disease as a degraded
    fallback. Only the single most specific gene is used — same "one term,
    not several" reasoning as _SINGLE_TERM_TOOLS. Routing (_heuristic_tools /
    _ROUTING_SYSTEM) only chooses this tool when scope has a gene, so the
    empty-scope branch here is a defensive last resort, not the expected
    path."""
    genes = scope.get("genes") or []
    if genes:
        return genes[0].strip()
    return _join_unique(*[scope[k] for k in SCOPE_KEYS])


def _opentargets_query(scope: dict) -> str:
    """Open Targets (search_opentargets) query composition — GENE-PRIMARY,
    DISEASE-FALLBACK, mirroring sources/opentargets.py's own resolution
    order: single most specific gene when one is present (same "one term,
    not several" reasoning as _chembl_query — Open Targets' `search` resolves
    a SYMBOL, not a bag of words), else the single most specific disease
    (Open Targets' reverse `disease{associatedTargets}}` path handles this
    case natively, unlike ChEMBL which has no disease-side query at all).
    Routing only chooses this tool when scope has a gene or a disease, so the
    empty-scope branch is a defensive last resort, not the expected path."""
    genes = scope.get("genes") or []
    if genes:
        return genes[0].strip()
    diseases = scope.get("diseases") or []
    if diseases:
        return diseases[0].strip()
    return _join_unique(*[scope[k] for k in SCOPE_KEYS])


def _query_for(name: str, scope: dict) -> str:
    if name == "search_tools":
        return _single_method_query(scope)
    if name == "search_datasets":
        return _datasets_query(scope)
    if name == "search_chembl":
        return _chembl_query(scope)
    if name == "search_opentargets":
        return _opentargets_query(scope)
    if name in _SINGLE_TERM_TOOLS:
        if scope["genes"]:
            return scope["genes"][0].strip()
        if scope["diseases"]:
            return scope["diseases"][0].strip()
        return _join_unique(*[scope[k] for k in SCOPE_KEYS])  # same last-resort net as below

    query = _join_unique(*[scope[k] for k in _QUERY_SLICES[name]])
    if not query and name in _FALLBACK_SLICES:   # never let a chosen tool run blank
        query = _join_unique(*[scope[k] for k in _FALLBACK_SLICES[name]])
    if not query:  # last resort: any scope term, so a chosen tool never runs blank
        query = _join_unique(*[scope[k] for k in SCOPE_KEYS])
    return query


def _context_for_papers(scope: dict) -> list[str]:
    """The single most specific available context term for a per-gene
    fan-out query — 0 or 1 items, NEVER a join of several (that's the
    original dilution bug at smaller scale).

    Disease was the first version's default context, and the diagnostic
    showed it's the WEAK choice: "SOS1 KRAS NSCLC" (gene + disease)
    underperformed the hand-written "SOS1 inhibitor KRAS G12C" (gene +
    mechanism phrase) empirically — a bare disease name carries less
    identifying signal than a specific mechanism/drug-class phrase.

    Priority, most specific first:
      1. assets (named molecules/drugs, e.g. "adagrasib") — as specific as
         a scope term gets, when the extraction actually found one.
      2. topics — the single LONGEST topic phrase by word count, used as a
         cheap proxy for specificity: a multi-word mechanism phrase like
         "KRAS G12C inhibitors resistance" encodes more identifying context
         than a short one, and this is exactly the kind of phrase the
         diagnostic's successful hand-written queries used in place of a
         disease name.
      3. diseases — LAST resort, only when neither assets nor topics have
         anything at all.
    Returns [] if the scope has none of the three (a per-gene query then
    runs on the gene name alone, which is still a real improvement over the
    old combined string for that gene specifically).
    """
    candidates = list(scope.get("assets") or []) + list(scope.get("topics") or [])
    if candidates:
        return [max(candidates, key=len)]
    diseases = scope.get("diseases") or []
    return diseases[:1]


def _entity_queries_for_papers(scope: dict) -> list[str]:
    """Build the SET of short, entity-scoped queries search_papers fans out
    over, instead of _query_for's single combined string — see
    tools/search_papers.py's module docstring for the diagnosed bug this
    fixes (a long bag-of-words query lets generic multi-term-matching
    reviews outrank entity-specific papers in PubMed/OpenAlex's own
    relevance ranking).

    NO GENES IN SCOPE -> falls back to EXACTLY _query_for's old single
    combined query, unchanged. There is no entity to fan out over, and this
    is the branch a pure-topic search or the blank-input landing feed takes
    — neither was part of the diagnosed failure (that was specifically about
    a GENE being drowned out by disease/topic terms), so neither should see
    any behavior change here.

    ONE GENE IN SCOPE -> a single query, [gene] + context (see `context`
    below) — e.g. "PHGDH glioblastoma". This is deliberately near-identical
    to _query_for's old output for a single-gene scope (which already
    performed well — see the PHGDH diagnostic: 8-9/10 relevant), and
    search_papers_multi_async's own len(queries)<=1 branch calls
    search_papers_async directly with no merge/re-rank machinery at all, so
    a single-gene scope is BYTE-FOR-BYTE the pre-fan-out code path, not a
    fan-out of one. This is what protects the simple case from regressing.

    TWO OR MORE GENES -> one query per gene (capped at _GENE_QUERY_CAP,
    dropping later-mentioned genes — see that constant's own docstring),
    plus one broad, gene-less query so general context isn't lost when the
    entity queries narrow things down. The PRIMARY gene (scope['genes'][0] —
    order-preserving from extraction, so this is whichever gene the source
    text named first) gets its own query of just [gene] + context; every
    OTHER gene's query additionally includes the primary gene as a
    co-occurrence anchor — e.g. genes=[KRAS, SHP2, SOS1], context="KRAS G12C
    inhibitors" produces "KRAS KRAS G12C inhibitors", "SHP2 KRAS KRAS G12C
    inhibitors", "SOS1 KRAS KRAS G12C inhibitors", plus the broad query
    "KRAS G12C inhibitors". Anchoring secondary genes to the primary one
    mirrors what the diagnostic's successful hand-written queries did
    ("SHP2 inhibitor KRAS G12C combination") — a secondary gene searched in
    total isolation from the primary target would find the wrong literature
    just as easily as the old combined query found the wrong thing by
    including too much.

    TRIED AND REVERTED: dropping this anchor (reasoning that `context` often
    already mentions the primary gene, e.g. the KRAS case above). Verified
    that removing it cost the KRAS case a result it had with the anchor in
    (a rank shuffle put the SHP2-specific paper one slot past that version's
    quota cutoff) while not fixing the PHGDH/PSAT1 case it was meant to
    help — see search_papers_multi_async's ROUND-ROBIN note for why: the
    real constraint there was never the anchor, it was PHGDH's literature
    volume dominating even an anchor-free "PSAT1 glioblastoma" query's own
    internal ranking. Fixed by round-robin instead (below), so the anchor
    goes back to doing the one thing it verifiably helped with.

    `context` is the SINGLE most specific available term — see
    `_context_for_papers` below — never the full topics list and never more
    than one term: keeping every sub-query SHORT is exactly what the
    diagnostic showed matters; joining several context terms together would
    just reintroduce a smaller version of the original dilution bug.
    """
    genes = scope.get("genes") or []

    if not genes:
        return [_query_for("search_papers", scope)]

    context = _context_for_papers(scope)
    capped_genes = genes[:_GENE_QUERY_CAP]
    primary = capped_genes[0]

    queries: list[str] = []
    seen_lower: set[str] = set()

    def _add(q: str) -> None:
        if q and q.lower() not in seen_lower:
            seen_lower.add(q.lower())
            queries.append(q)

    for gene in capped_genes:
        terms = [gene] if gene == primary else [gene, primary]
        _add(_join_unique(terms, context))

    if len(capped_genes) > 1:
        _add(_join_unique(context))

    return queries


# ── Steps 4–5: execute chosen tools in parallel and assemble the result ───────


def _dispatch(name: str, query: str):
    """Return an awaitable that runs `name` with `query`. Async source tools are
    awaited directly; blocking DB tools run off the event loop via to_thread.

    search_papers is NOT dispatched through here — see _execute below, which
    calls search_papers_multi_async with the entity query SET from
    _entity_queries_for_papers instead of a single `query` string. It stays
    listed in _QUERY_SLICES/_KINDS/etc. (routing, kind-labeling) but this
    function is bypassed for it specifically."""
    if name == "search_news":
        return search_news_async(query, _NET_LIMIT)
    if name == "search_trials":
        return search_trials_async(query, _NET_LIMIT)
    if name == "search_grants":
        return search_grants_async(query, _NET_LIMIT)
    if name == "search_tools":
        return search_tools_async(query, _NET_LIMIT)
    if name == "search_datasets":
        return search_datasets_async(query, _NET_LIMIT)
    if name == "search_pager":
        return search_pager_async(query, _NET_LIMIT)
    if name == "search_chembl":
        return search_chembl_async(query, _NET_LIMIT)
    if name == "search_opentargets":
        return search_opentargets_async(query, _NET_LIMIT)
    if name == "search_lab_resources":
        return asyncio.to_thread(search_lab_resources, query, None, _INTERNAL_LIMIT)
    if name == "search_people":
        return asyncio.to_thread(search_people, query, _INTERNAL_LIMIT)
    if name == "search_wiki":
        return asyncio.to_thread(search_wiki, query, _INTERNAL_LIMIT)
    raise ValueError(f"unknown tool: {name}")


async def _execute(
    chosen: list[str], scope: dict, since_year: int | None = None,
    status_filter: list[str] | None = None,
) -> list[dict]:
    tasks = []
    specs: list[tuple[str, str, str]] = []  # (tool, kind, display_query)
    papers_query_display: str | None = None
    for name in chosen:
        if name == "search_papers":
            # Entity fan-out (see _entity_queries_for_papers) instead of one
            # combined-string query. `display_query` joins the sub-queries
            # with " | " purely for the section's own `query` field — the
            # UI/API transparency string — never re-parsed as a single query
            # anywhere.
            queries = _entity_queries_for_papers(scope)
            papers_query_display = " | ".join(queries)
            tasks.append(
                search_papers_multi_dual_async(
                    queries, limit_per_query=_NET_LIMIT, final_limit=_NET_LIMIT,
                    since_year=since_year,
                )
            )
            specs.append((name, _KINDS[name], papers_query_display))
            continue
        query = _query_for(name, scope)
        if name == "search_opentargets":
            # Thread the disease term through as a SEPARATE parameter
            # alongside the gene, not concatenated into `query` — see
            # sources/opentargets.py's fetch_opentargets docstring (Problem
            # 1). Only meaningful when the primary query resolved to the
            # gene (i.e. scope actually has a gene); when it fell back to
            # the disease term itself (no gene in scope), there's no second
            # disease to filter by, so `disease` stays None and the reverse
            # disease-driven path is untouched.
            disease_term = None
            if scope.get("genes"):
                diseases = scope.get("diseases") or []
                if diseases:
                    disease_term = diseases[0].strip()
            tasks.append(search_opentargets_async(query, _NET_LIMIT, disease=disease_term))
        elif name == "search_trials" and status_filter:
            # status_filter is UI-only (see explore_async's docstring) — never
            # derived from scope/LLM extraction, forwarded verbatim to
            # search_trials_async -> ClinicalTrials.gov's filter.overallStatus.
            tasks.append(search_trials_async(query, _NET_LIMIT, status_filter=status_filter))
        else:
            tasks.append(_dispatch(name, query))
        specs.append((name, _KINDS[name], query))

    results = await asyncio.gather(*tasks, return_exceptions=True) if tasks else []

    sections: list[dict] = []
    for (tool, kind, query), result in zip(specs, results):
        section: dict = {"tool": tool, "kind": kind, "query": query}
        if isinstance(result, Exception):
            # one tool failing never sinks the others; report an empty, flagged section
            section["items"] = []
            if tool == "search_papers":
                section["items_key"] = []
            section["error"] = f"{type(result).__name__}: {result}"
            logger.exception(
                "explore: tool %s failed for query=%r", tool, query, exc_info=result
            )
        elif tool == "search_papers":
            # search_papers_multi_dual_async returns (latest, key) — TWO
            # orderings of the SAME already-ranked pool (see that function's
            # docstring). `items` stays the existing date-desc "Latest
            # Papers" view (so every OTHER caller/consumer of a papers
            # section is unaffected); `items_key` is the additional WINNER-
            # ranked "Key Papers" view the frontend renders as a second
            # subsection under the same Papers tab (see CategoryStrip —
            # this is not a new top-level kind/tab).
            latest, key = result
            section["items"] = [item.model_dump() for item in latest]
            section["items_key"] = [item.model_dump() for item in key]
        else:
            section["items"] = [item.model_dump() for item in result]
        sections.append(section)
    return sections


async def _explore_uncached(
    input_text: str, scope_terms: list[str] | None = None, since_year: int | None = None,
    status_filter: list[str] | None = None,
) -> dict:
    """The real orchestration: extract scope, route, fan out, assemble."""
    if not (input_text or "").strip():
        chosen = list(_DEFAULT_TOOLS)
        if scope_terms:
            # Personalized landing feed — the caller's terms ARE the scope. Still
            # no LLM: they are already the structured answer extraction would be
            # asked for, so routing stays the fixed default tool set.
            scope = {**_EMPTY_SCOPE, "topics": list(scope_terms),
                     "is_default": True, "is_personalized": True}
            reasoning = "personalized landing feed (blank input): scope from the caller's saved interests"
        else:
            scope = {**_DEFAULT_SCOPE, "is_default": True, "is_personalized": False}
            reasoning = "default landing feed (blank input): field-wide drug-discovery scope"
    else:
        # Groq calls are cached on the input string: extraction and routing run at
        # temperature 0, so they're deterministic for a given input and an
        # identical search should never re-hit the LLM.
        scope = await cache.get_or_compute(
            normalize_key("scope", input_text),
            lambda: asyncio.to_thread(_extract_scope, input_text),
            TTL_LLM, STALE_LLM,
        )
        scope = {**scope, "is_default": False, "is_personalized": False}
        chosen, reasoning = await cache.get_or_compute(
            normalize_key("route", input_text),
            lambda: asyncio.to_thread(_choose_tools, input_text, scope),
            TTL_LLM, STALE_LLM,
        )
        chosen = list(chosen)

    sections = await _execute(chosen, scope, since_year, status_filter)
    return {
        "input": input_text,
        "scope": scope,
        "tools_called": chosen,
        "reasoning": reasoning,
        "sections": sections,
    }


async def explore_async(
    input_text: str, scope_terms: list[str] | None = None, since_year: int | None = None,
    status_filter: list[str] | None = None,
) -> dict:
    """Async orchestration core (used by the MCP server), cached end-to-end.

    `since_year`, when given, restricts search_papers (PubMed/OpenAlex/Crossref
    only — no other tool's date logic changes) to results published on/after
    that year. Never derived from scope extraction; comes only from an explicit
    caller-supplied value (see server.py's /api/explore bridge). Folded into the
    cache key below so a filtered and an unfiltered search of the same input
    never collide.

    `status_filter`, when given (e.g. ["TERMINATED", "WITHDRAWN"]), restricts
    the search_trials section to those ClinicalTrials.gov overall-status values
    — forwarded to search_trials_async -> filter.overallStatus, same mechanism
    tools/project_agent.py's digest already uses for its own two status-filtered
    searches. UI-ONLY, same as since_year: NEVER derived from scope extraction
    or free text. The word "terminated" in a raw query does not reach this
    param — scope extraction has no status key (SCOPE_KEYS is fixed at
    topics/genes/diseases/assets/methods) and would drop it as noise even if it
    tried, the same failure class the since_year fix addressed for dates. A
    small fixed status vocabulary isn't parsed from text here for the same
    reason the date filter stayed UI-only: keeping the LLM out of a filter path
    that changes which real-world results are shown is worth a control click.
    Folded into the cache key below, same as since_year.

    Blank / whitespace-only input skips LLM extraction and routing entirely and
    serves the landing feed: a fixed tool set, with scope.is_default=true so the
    frontend knows this is the blank-state feed. `scope_terms` personalizes THAT
    feed — pass the signed-in user's saved interests and they become the scope
    instead of the field-wide default (scope.is_personalized=true). They apply
    only to the blank feed: a real search's own text always wins, so a query can
    never be silently widened by whoever is logged in.

    Caching is applied at THIS level as well as per-tool, deliberately:
      * the whole-response entry makes a repeat visit a single dict lookup, with
        no per-tool cache probing and no re-assembly;
      * the per-tool entries still pay off when two DIFFERENT explore inputs
        route to the same underlying query.
    The blank landing feed — which every visitor hits — gets the shorter fresh
    window (10 min) since it is the front page; a specific topic gets an hour.

    CACHE KEYS. A personalized feed is keyed by its normalized TERMS under its
    own namespace, never by the caller — three consequences, all wanted:
      * it can't land in (or be served from) the shared blank-input entry, so
        one user's interests never leak into another's feed or into the
        signed-out default;
      * two users with the same interest set share one entry — the input is
        identical, so the answer is, and nothing user-specific is in it;
      * "cancer PHGDH" typed as a SEARCH stays a separate entry from the same
        two words as interests, because the two produce different feeds.
    """
    blank = not (input_text or "").strip()
    terms = _clean_terms(scope_terms) if blank else []

    base_key = "explore:interests" if terms else "explore"
    key_terms = terms if terms else input_text
    if since_year is not None:
        base_key += f":since{since_year}"
    if status_filter:
        base_key += f":status{','.join(status_filter)}"
    key = normalize_key(base_key, key_terms)
    ttl, stale = (
        (TTL_DEFAULT_FEED, STALE_DEFAULT_FEED) if blank else (TTL_TOPIC, STALE_TOPIC)
    )
    return await cache.get_or_compute(
        key,
        lambda: _explore_uncached(input_text, terms, since_year, status_filter),
        ttl, stale,
    )


def explore(
    input_text: str, scope_terms: list[str] | None = None, since_year: int | None = None,
    status_filter: list[str] | None = None,
) -> dict:
    """Synchronous entry point (the registered tool signature).

    Reason about a free-text research message, route to the fitting search tools,
    run them with the right per-tool query, and return results grouped by kind:
    {scope, tools_called, reasoning, sections:[{kind, items}]}. `since_year`
    restricts search_papers's results to that year onward (see search_papers.py).
    `status_filter` restricts search_trials to those ClinicalTrials.gov overall-
    status values (e.g. ["TERMINATED", "WITHDRAWN"]) — UI-only, never parsed
    from `input_text` (see explore_async's docstring).
    """
    return asyncio.run(explore_async(input_text, scope_terms, since_year, status_filter))
