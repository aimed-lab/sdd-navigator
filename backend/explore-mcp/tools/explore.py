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
from tools.search_datasets import search_datasets_async
from tools.search_grants import search_grants_async
from tools.search_lab_resources import search_lab_resources
from tools.search_news import search_news_async
from tools.search_pager import search_pager_async
from tools.search_papers import search_papers_async, search_papers_multi_async
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
#   not a controlled vocabulary term. So trials/grants get ONLY diseases +
#   genes — a trial record fundamentally describes a CONDITION (disease) and
#   an INTERVENTION (a molecular target is the closest scope field to that);
#   nothing else in scope reliably appears in a trial or funding record's own
#   text. This also kills the duplicate for free: the reported
#   "glioblastoma glioblastoma" happened because the disease name was ALSO
#   embedded inside a `topics` phrase ("glioblastoma clinical trials") —
#   _join_unique only dedupes EXACT term matches, not sub-phrase overlap, so
#   two literally-different strings both landed in the query. Dropping
#   `topics` from these two slices removes the phrase that carried the
#   duplicate, rather than trying to dedupe at the word level.
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
# literature query even though trials/grants/datasets/pager now stay strictly
# disease + gene. NOT touched by this round's fix — search_papers already has
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
_QUERY_SLICES: dict[str, tuple[str, ...]] = {
    "search_papers":        ("diseases", "topics", "genes"),  # richest slice — broadest kind; own fan-out handles dilution separately
    "search_news":          ("topics", "diseases"),           # the field, not a target — no genes
    "search_trials":        ("diseases", "genes"),            # STRICT matcher — condition + intervention only, no free-text topics
    "search_grants":        ("diseases", "genes"),            # same reasoning as trials — Grants.gov tolerated the old diluted string, but shorter is strictly safer and consistent
    "search_tools":         ("methods", "genes"),
    "search_datasets":      ("diseases", "genes"),            # was + topics — GEO's own search proved to share trials' strict-AND behavior; genes is GEO's strongest signal (PHGDH: 8-9/10 relevant on a bare gene query)
    "search_pager":         ("diseases", "genes"),            # same fix, same reasoning as datasets — PAGER takes a single term anyway, per its own docstring
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
    # GitHub gets "drug discovery" instead of "" (which returns generic top repos).
    # search_tools is a relevance-ranked source (see the audit note above), so a
    # topics fallback here carries none of the strict-matcher risk trials/grants had.
    "search_tools": ("topics",),
}

_KINDS: dict[str, str] = {
    "search_papers": "paper",
    "search_news": "news",
    "search_trials": "trial",
    "search_grants": "grant",
    "search_tools": "tool",
    "search_datasets": "dataset",
    "search_pager": "geneset",
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


def _query_for(name: str, scope: dict) -> str:
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
    if name == "search_lab_resources":
        return asyncio.to_thread(search_lab_resources, query, None, _INTERNAL_LIMIT)
    if name == "search_people":
        return asyncio.to_thread(search_people, query, _INTERNAL_LIMIT)
    if name == "search_wiki":
        return asyncio.to_thread(search_wiki, query, _INTERNAL_LIMIT)
    raise ValueError(f"unknown tool: {name}")


async def _execute(chosen: list[str], scope: dict) -> list[dict]:
    tasks = []
    specs: list[tuple[str, str, str]] = []  # (tool, kind, display_query)
    for name in chosen:
        if name == "search_papers":
            # Entity fan-out (see _entity_queries_for_papers) instead of one
            # combined-string query. `display_query` joins the sub-queries
            # with " | " purely for the section's own `query` field — the
            # UI/API transparency string — never re-parsed as a single query
            # anywhere.
            queries = _entity_queries_for_papers(scope)
            tasks.append(
                search_papers_multi_async(queries, limit_per_query=_NET_LIMIT, final_limit=_NET_LIMIT)
            )
            specs.append((name, _KINDS[name], " | ".join(queries)))
            continue
        query = _query_for(name, scope)
        tasks.append(_dispatch(name, query))
        specs.append((name, _KINDS[name], query))

    results = await asyncio.gather(*tasks, return_exceptions=True) if tasks else []

    sections: list[dict] = []
    for (tool, kind, query), result in zip(specs, results):
        section: dict = {"tool": tool, "kind": kind, "query": query}
        if isinstance(result, Exception):
            # one tool failing never sinks the others; report an empty, flagged section
            section["items"] = []
            section["error"] = f"{type(result).__name__}: {result}"
            logger.exception(
                "explore: tool %s failed for query=%r", tool, query, exc_info=result
            )
        else:
            section["items"] = [item.model_dump() for item in result]
        sections.append(section)
    return sections


async def _explore_uncached(input_text: str, scope_terms: list[str] | None = None) -> dict:
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

    sections = await _execute(chosen, scope)
    return {
        "input": input_text,
        "scope": scope,
        "tools_called": chosen,
        "reasoning": reasoning,
        "sections": sections,
    }


async def explore_async(input_text: str, scope_terms: list[str] | None = None) -> dict:
    """Async orchestration core (used by the MCP server), cached end-to-end.

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

    key = normalize_key("explore:interests", terms) if terms else normalize_key("explore", input_text)
    ttl, stale = (
        (TTL_DEFAULT_FEED, STALE_DEFAULT_FEED) if blank else (TTL_TOPIC, STALE_TOPIC)
    )
    return await cache.get_or_compute(
        key,
        lambda: _explore_uncached(input_text, terms),
        ttl, stale,
    )


def explore(input_text: str, scope_terms: list[str] | None = None) -> dict:
    """Synchronous entry point (the registered tool signature).

    Reason about a free-text research message, route to the fitting search tools,
    run them with the right per-tool query, and return results grouped by kind:
    {scope, tools_called, reasoning, sections:[{kind, items}]}.
    """
    return asyncio.run(explore_async(input_text, scope_terms))
