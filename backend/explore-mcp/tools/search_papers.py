"""
tools/search_papers.py — one tool that searches the scientific literature.

Fans out to PubMed + OpenAlex + Crossref IN PARALLEL over a single shared HTTP
client (asyncio.gather with return_exceptions=True), so one source failing (or
timing out) never sinks the others. The merged set is collapsed DOI-aware across
sources (dedupe.merge_items — a PubMed paper and its OpenAlex twin become one
item, keeping the citations signal + referenced_works) and then rank-interleaved
(see `_rank_merge`): cited papers rank among themselves by
citations desc, uncited among themselves by date desc, and the two groups are
merged by rank position so the top-cited and the newest both surface near the top.

That order is then handed to WINNER (ranking.rank_papers_winner), which re-ranks
by centrality in the citation graph the result set forms among itself. When the
set is too sparsely self-citing for that to mean anything, WINNER is a no-op and
the _rank_merge order stands — see ranking.py for the guard rails.

Read-only. No Supabase, no writes. Never fabricates a ranking signal — a paper
carries a Signal only when its source (OpenAlex) actually reported one.

ENTITY FAN-OUT (search_papers_multi_async, below `search_papers_async`). A
single query built by concatenating every scope term ("KRAS NSCLC KRAS G12C
inhibitors resistance KRAS SHP2 SOS1") was diagnosed to starve out
secondary-entity literature: PubMed/OpenAlex/Crossref's own relevance ranking
rewards documents matching MORE of the query's terms, so a generic review
matching "KRAS"+"resistance"+"inhibitors"+"NSCLC" outranks a SHP2-specific
paper matching only "SHP2"+"KRAS" — confirmed empirically (see
tools/explore.py's entity-query builder for the query-set construction this
function consumes). search_papers_multi_async runs several SHORT,
entity-scoped queries in parallel through the existing single-query path
(search_papers_async) instead of one long one, then re-merges with the SAME
dedupe/rank/WINNER pipeline _fetch already uses for one query — no second
ranking system.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import STALE_SOURCE, TTL_SOURCE, cache, normalize_key
from dedupe import merge_items
from models import Item
from ranking import rank_papers_winner, relevance_seed_ids
from sources.crossref import fetch_crossref
from sources.openalex import SORT_RELEVANCE, fetch_openalex
from sources.pubmed import fetch_pubmed

logger = logging.getLogger(__name__)

_USER_AGENT = "explore-mcp/0.1 (SDD Navigator; research tooling)"
_SOURCE_NAMES = ("pubmed", "openalex", "crossref")


def _rank_merge(items: list[Item]) -> list[Item]:
    """Interleave signalled and unsignalled items by within-group rank so signal
    does NOT dominate source.

    - Items WITH a citations signal are ranked among themselves by value desc.
    - Items WITHOUT a signal are ranked among themselves by date desc.
    - The two groups are then merged by that rank position (rank 0 of each group
      first, then rank 1, …), so the top-cited paper and the newest paper both
      surface near the top instead of all signalled items landing first.
    - Ties (same rank across the two groups) are broken by date desc.
    """
    signalled = sorted(
        (i for i in items if i.signal is not None),
        key=lambda i: (i.signal.value, i.date_iso or ""),
        reverse=True,   # citations desc, date desc as the intra-group tie-break
    )
    unsignalled = sorted(
        (i for i in items if i.signal is None),
        key=lambda i: (i.date_iso or ""),
        reverse=True,   # date desc
    )

    ranked: list[tuple[int, Item]] = [
        (rank, item)
        for group in (signalled, unsignalled)
        for rank, item in enumerate(group)
    ]
    # Stable two-pass sort: date desc first, then rank asc — leaves items ordered
    # by rank ascending with same-rank ties broken by date desc.
    ranked.sort(key=lambda pair: pair[1].date_iso or "", reverse=True)
    ranked.sort(key=lambda pair: pair[0])
    return [item for _, item in ranked]


async def search_papers_async(
    query: str, limit: int = 20, since_year: int | None = None
) -> list[Item]:
    """Cached + single-flighted wrapper around the fan-out (see _fetch).

    `since_year`, when set, is folded into the cache key: a date-filtered
    search and an unfiltered one for the same query text are genuinely
    different results and must never share a cache entry.
    """
    key = normalize_key(f"papers:{limit}:{since_year or ''}", query)
    return await cache.get_or_compute(
        key, lambda: _fetch(query, limit, since_year), TTL_SOURCE, STALE_SOURCE
    )


async def _fetch(query: str, limit: int, since_year: int | None = None) -> list[Item]:
    """Async core: fan out, isolate failures, merge, dedupe, sort, cap."""
    async with httpx.AsyncClient(headers={"User-Agent": _USER_AGENT}) as client:
        results = await asyncio.gather(
            fetch_pubmed(client, query, limit, since_year=since_year),
            # Relevance, not recency: a topic's important papers cite each other,
            # which is what gives WINNER a graph to rank (a recency-sorted set
            # has ~zero intra-set citations). search_news keeps the recency sort.
            fetch_openalex(client, query, limit, sort=SORT_RELEVANCE, since_year=since_year),
            fetch_crossref(client, query, limit, since_year=since_year),
            return_exceptions=True,   # a failing source must not sink the batch
        )

    merged: list[Item] = []
    for source_name, result in zip(_SOURCE_NAMES, results):
        if isinstance(result, Exception):
            # per-source isolation — swallow this source, keep the rest, but log it
            # (this loop is the only place that still knows which source failed).
            logger.exception(
                "search_papers: %s fetch failed for query=%r", source_name, query,
                exc_info=result,
            )
            continue
        merged.extend(result)

    collapsed = merge_items(merged)   # DOI-aware cross-source merge (not first-seen-drop)
    ranked = _rank_merge(collapsed)

    # WINNER network re-rank over the citation graph these papers form among
    # themselves. Seeds are the best scope-matching papers; everything else is an
    # expansion candidate. This is a no-op (same order, no signal) whenever the
    # set is too sparsely self-citing to rank meaningfully — see ranking.py.
    seeds = relevance_seed_ids(ranked, query, top_n=10)
    ranked = rank_papers_winner(ranked, seeds)

    return ranked[:limit]


async def search_papers_multi_async(
    queries: list[str], *, limit_per_query: int, final_limit: int,
    since_year: int | None = None,
) -> list[Item]:
    """Fan-out entry point: run several entity-scoped queries in PARALLEL,
    each through the existing single-query path (search_papers_async) — so
    each sub-query gets its OWN cache entry and single-flight coalescing
    (see cache.py), rather than the whole fan-out being one opaque unit. That
    matters for cache hit rate specifically: "SHP2 KRAS NSCLC" recurs across
    different projects/searches the way a 7-term project-specific combined
    string never would, so per-entity queries are individually cacheable in
    a way the old combined query wasn't.

    FAILURE ISOLATION: `return_exceptions=True` means one sub-query raising
    (e.g. every source failing for it, or — the real-world case that
    motivated this — Crossref 429ing under the extra fan-out load) drops
    only THAT sub-query's contribution and logs it; the rest of the merge
    proceeds. Note search_papers_async's own _fetch already isolates
    per-SOURCE failures within a single query (a Crossref 429 there just
    means that query's results come from PubMed+OpenAlex) — this is the same
    isolation principle one level up, across sub-queries instead of across
    sources.

    ROUND-ROBIN MERGE, not a fixed quota, not a global re-rank. Two earlier
    versions of this function each threw away part of what the fan-out
    fixed:
      * a pure global citation-weighted rank over the deduped union buried a
        minor-gene sub-query's genuinely relevant, low-citation paper under
        high-citation generic reviews contributed by the OTHER sub-queries;
      * a FIXED quota (`quota_n` per sub-query, plus a separate fill phase
        for the rest) was still too rigid — verified two real cases (SHP2 in
        the KRAS project, PSAT1 in a PHGDH project) where the relevant paper
        sat JUST ONE RANK past the fixed cutoff within its own sub-query's
        list, and the leftover "fill" phase just handed the remaining slots
        to the same high-citation generic reviews the fan-out exists to
        stop dominating.
    Round-robin fixes both: no fixed per-sub-query cap, and no separate fill
    phase handing slots back to the global rank.

      1. DOI-dedupe the FULL union first (dedupe.merge_items, same as
         always) — a paper found by two sub-queries costs one slot, not
         two, regardless of which sub-queries found it.
      2. ROUND-ROBIN: take item 0 from every sub-query, in sub-query order;
         then item 1 from every sub-query; then item 2; and so on, until
         `final_limit` is reached or every sub-query is exhausted. "Item N
         from a sub-query" always means that sub-query's own Nth-BEST
         paper by the existing per-query ranking (search_papers_async's own
         _fetch already ranked each sub-query's list before this function
         ever sees it) — round-robin decides how many slots each entity
         gets, the existing ranking still decides WHICH papers represent
         it. A dedupe_key some earlier sub-query already claimed this round
         is skipped WITHOUT costing the current sub-query its turn — it
         just contributes its own next not-yet-claimed paper instead of
         nothing, so a duplicate never shrinks a sub-query's effective
         share the way it would if a claimed slot were simply passed over.
      3. NO separate fill phase. Round-robin naturally keeps rotating through
         every sub-query until `final_limit` slots are filled or the whole
         union is exhausted — there's nothing left over to hand to a global
         rank, which is exactly the point: that fill phase was where the
         two earlier versions kept losing the fix back to generic reviews.
      4. DISPLAY ORDER: the final list is still emitted in global-rank
         order (_rank_merge + WINNER over the full deduped pool), restricted
         to whichever keys round-robin selected — round-robin controls
         SELECTION, the existing ranking still controls the order results
         are handed back in, so the output reads best-first rather than as
         visible per-sub-query blocks.

    WINNER's seeds (step 4) are picked with an empty query string, same
    reasoning as before: relevance_seed_ids() defines that as "seed from the
    head of the existing order" — there is no one query string representing
    the whole fan-out to score title/summary overlap against.

    `len(queries) <= 1` skips the fan-out machinery entirely and calls
    search_papers_async directly — the ordinary single-query path, byte-for-
    byte, so a gene-less or single-gene scope (see tools/explore.py) is
    exactly today's behavior, not "fan-out of one." There is nothing to
    round-robin across with one sub-query anyway.
    """
    if not queries:
        return []
    if len(queries) == 1:
        return await search_papers_async(queries[0], final_limit, since_year)

    results = await asyncio.gather(
        *(search_papers_async(q, limit_per_query, since_year) for q in queries),
        return_exceptions=True,
    )

    sub_lists: list[list[Item]] = []
    all_items: list[Item] = []
    for q, result in zip(queries, results):
        if isinstance(result, Exception):
            logger.exception(
                "search_papers: fan-out sub-query %r failed entirely", q, exc_info=result
            )
            sub_lists.append([])
            continue
        sub_lists.append(result)
        all_items.extend(result)

    if not all_items:
        return []

    # Step 1 — dedupe the full union FIRST, before any round-robin accounting.
    collapsed = merge_items(all_items)

    # Global rank, computed once: this is ONLY the final display order now
    # (step 4) — there is no fill phase left to feed from it.
    ranked_global = _rank_merge(collapsed)
    seeds = relevance_seed_ids(ranked_global, "", top_n=10)
    ranked_global = rank_papers_winner(ranked_global, seeds)

    # Step 2 — round-robin: per-sub-query cursor, advanced past whatever an
    # earlier sub-query already claimed THIS round, so a duplicate costs no
    # sub-query its turn.
    used: set[str] = set()
    cursors = [0] * len(sub_lists)
    made_progress = True
    while len(used) < final_limit and made_progress:
        made_progress = False
        for i, sub_items in enumerate(sub_lists):
            if len(used) >= final_limit:
                break
            while cursors[i] < len(sub_items) and sub_items[cursors[i]].dedupe_key in used:
                cursors[i] += 1
            if cursors[i] < len(sub_items):
                used.add(sub_items[cursors[i]].dedupe_key)
                cursors[i] += 1
                made_progress = True

    # Step 4 — emit in global-rank order, restricted to the selected set.
    return [item for item in ranked_global if item.dedupe_key in used][:final_limit]


def search_papers(query: str, limit: int = 20, since_year: int | None = None) -> list[Item]:
    """Synchronous entry point (the registered tool signature).

    Search PubMed, OpenAlex and Crossref for papers relevant to `query` and return
    up to `limit` deduped Items, best-ranked first. `since_year`, when given,
    restricts to papers published on/after that year (see sources/*.py).
    """
    return asyncio.run(search_papers_async(query, limit, since_year))
