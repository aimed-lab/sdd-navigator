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
from tools.search_papers import search_papers_async
from tools.search_people import search_people
from tools.search_tools import search_tools_async
from tools.search_trials import search_trials_async
from tools.search_wiki import search_wiki

SCOPE_KEYS = ["topics", "genes", "diseases", "assets", "methods"]

_NET_LIMIT = 10        # external-source tools (papers/trials/grants/tools)
_INTERNAL_LIMIT = 20   # internal DB tools (lab_resources/people/wiki)

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
    "  • 'clinical trials for X' → trials (and papers).\n"
    "  • 'funding for X' / a grant/screen to fund → grants (and relevant tools).\n"
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
# The RIGHT scope slice per tool. Disease-facing searches (papers/trials/grants)
# get the disease + topic; capability searches (tools/resources) get the method +
# gene; people get disease + method; wiki gets the topic. Never swapped.
#
# search_papers intentionally gets the RICHEST slice (disease + topic + gene):
# papers are the broadest result kind, so a gene target like PHGDH belongs in the
# literature query even though trials/grants stay strictly disease + topic.
#
# search_datasets gets disease + gene + topic (topic standing in for tissue —
# SCOPE_KEYS has no dedicated tissue field, and the LLM's `topics` extraction
# already captures tissue/organ phrases like "liver" or "brain tissue" when
# they're in the message). Deliberately EXCLUDES methods: GEO's own metadata
# already carries the assay/method (gdstype — RNA-seq vs microarray vs
# ChIP-seq), so a method term in the query text narrows by keyword match
# against submitter-written titles/summaries instead, which is much noisier
# than letting disease/gene/tissue drive the search. Datasets are found BY
# disease/tissue/gene, not by method — see tools/search_datasets.py.
_QUERY_SLICES: dict[str, tuple[str, ...]] = {
    "search_papers":        ("diseases", "topics", "genes"),  # richest slice — broadest kind
    "search_news":          ("topics", "diseases"),           # the field, not a target — no genes
    "search_trials":        ("diseases", "topics"),
    "search_grants":        ("diseases", "topics"),
    "search_tools":         ("methods", "genes"),
    "search_datasets":      ("diseases", "genes", "topics"),  # disease + gene + tissue(topic) — NOT method
    "search_pager":         ("diseases", "genes", "topics"),  # same slice as datasets — PAGER keyword-matches disease/gene/tissue text, not method text
    "search_lab_resources": ("methods", "genes"),
    "search_people":        ("diseases", "methods"),
    "search_wiki":          ("topics",),
}

# Fallback slice used ONLY when a tool's primary slice comes out empty, so a
# chosen tool never runs with a blank query. e.g. "funding for a CRISPR screen"
# has no disease/topic, so grants falls back to methods+topics ("CRISPR screen").
# This fixes the query STRING only; it never changes which tools were chosen.
_FALLBACK_SLICES: dict[str, tuple[str, ...]] = {
    "search_grants": ("methods", "topics"),
    "search_trials": ("methods", "topics"),
    # method-less scopes (e.g. the default landing feed) fall back to the topic so
    # GitHub gets "drug discovery" instead of "" (which returns generic top repos).
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


# ── Steps 4–5: execute chosen tools in parallel and assemble the result ───────


def _dispatch(name: str, query: str):
    """Return an awaitable that runs `name` with `query`. Async source tools are
    awaited directly; blocking DB tools run off the event loop via to_thread."""
    if name == "search_papers":
        return search_papers_async(query, _NET_LIMIT)
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
    specs: list[tuple[str, str, str]] = []  # (tool, kind, query)
    for name in chosen:
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
