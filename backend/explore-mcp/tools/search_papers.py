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

# DEFAULT PAPERS BEHAVIOR (unconditional, no since_year/UI control needed):
# fetch a much larger per-source candidate POOL, then sort the merged/deduped/
# WINNER-ranked pool by date_iso desc and cap to the caller's limit. Diagnosed
# problem: with a ~10-per-source cap, ranking by relevance/citations, recent
# papers on a narrow topic can't outrank old landmark papers for a slot in the
# pool at all — sorting the RESULT by date afterwards still only had 10 (old)
# candidates to sort. The fix has to widen the pool that's fetched, not just
# reorder what's already been fetched.
#
# 75 is chosen from the two extremes seen in diagnosis:
#   * a narrow query ("PDAC Classical Basal subtype GATA6") had only ~12
#     PubMed hits in the entire 2024-2026 window — a pool of 75 comfortably
#     contains every recent hit even if OpenAlex's RELEVANCE sort (the mode
#     search_papers uses, see fetch_openalex's `sort` param below) buries a
#     couple of them below rank 10.
#   * a broad, hot query ("KRAS inhibitor") has thousands of recent papers,
#     so 75 relevance-ranked OpenAlex results (or date-sorted PubMed/Crossref
#     results, which are already date-sorted regardless of pool size) are
#     virtually guaranteed to include plenty from 2024-2026 without pulling
#     an unreasonably large page (225 total across 3 sources per query,
#     vs. 30 before — a real but bounded increase in per-search network cost).
_DEFAULT_POOL_SIZE = 75


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
    ranked = await _ranked_pool(query, limit, since_year)
    return _order_and_cap(ranked, limit, since_year)


async def search_papers_dual_async(
    query: str, limit: int = 20, since_year: int | None = None
) -> tuple[list[Item], list[Item]]:
    """Same cached pool as search_papers_async, but returns BOTH orderings —
    (latest, key) — of the SAME already-fetched/ranked pool, no second fetch:

      * latest — _order_and_cap's existing date-desc order (unchanged).
      * key    — WINNER's own re-ranked order (rank_papers_winner's output,
                 which _order_and_cap otherwise overrides/discards for the
                 default date-sorted view — see _order_and_cap's docstring).

    Both are capped to `limit`. See tools/explore.py's papers section, the
    only caller that needs both views at once.
    """
    ranked = await _ranked_pool(query, limit, since_year)
    latest = _order_and_cap(ranked, limit, since_year)
    key = ranked[:limit]
    return latest, key


async def _ranked_pool(query: str, limit: int, since_year: int | None) -> list[Item]:
    """Cached + single-flighted: the merged/deduped/WINNER-ranked pool for
    `query`, UNCAPPED and in WINNER's own order — the shared input both
    search_papers_async (date view) and search_papers_dual_async (date +
    WINNER views) derive their final capped lists from, with exactly one
    underlying fetch per (query, limit, since_year)."""
    key = normalize_key(f"papers:{limit}:{since_year or ''}", query)
    return await cache.get_or_compute(
        key, lambda: _fetch(query, limit, since_year), TTL_SOURCE, STALE_SOURCE
    )


def _order_and_cap(ranked: list[Item], limit: int, since_year: int | None) -> list[Item]:
    """Final ordering step, applied AFTER WINNER's re-rank.

    DEFAULT (since_year is None — every current caller): unconditional
    latest-first order. This deliberately OVERRIDES _rank_merge/WINNER's
    citation-graph ordering for the final list handed back — WINNER still
    runs (see _fetch/search_papers_multi_async) and its relevance signal is
    what shapes WHICH ~75 candidates per source made it into the pool in the
    first place (OpenAlex is fetched with SORT_RELEVANCE), but the final
    top-`limit` slice is chosen by date, not by WINNER's rank.

    since_year supplied (internal/future use, e.g. a status-filter-style
    caller — not reachable from the current UI): kept exactly as before,
    WINNER/_rank_merge's own order stands, no date re-sort on top of it.
    """
    if since_year is None:
        ranked = sorted(ranked, key=lambda i: i.date_iso or "", reverse=True)
    return ranked[:limit]


async def _fetch(query: str, limit: int, since_year: int | None = None) -> list[Item]:
    """Async core: fan out, isolate failures, merge, dedupe, sort, WINNER-rank.

    Returns the ranked pool UNCAPPED, in WINNER's own order — capping/final
    ordering is the caller's job (_order_and_cap for the date view, a bare
    slice for the WINNER view — see search_papers_async/search_papers_dual_async).
    `limit` still shapes the fetch (see fetch_cap below) even though it's no
    longer applied as a final cap here.
    """
    # Unconditional default: fetch a much larger per-source pool (see
    # _DEFAULT_POOL_SIZE) so a date-sort afterwards has recent candidates to
    # find. since_year supplied internally keeps the old cap=limit fetch.
    fetch_cap = _DEFAULT_POOL_SIZE if since_year is None else limit
    async with httpx.AsyncClient(headers={"User-Agent": _USER_AGENT}) as client:
        results = await asyncio.gather(
            fetch_pubmed(client, query, fetch_cap, since_year=since_year),
            # Relevance, not recency: a topic's important papers cite each other,
            # which is what gives WINNER a graph to rank (a recency-sorted set
            # has ~zero intra-set citations). search_news keeps the recency sort.
            fetch_openalex(client, query, fetch_cap, sort=SORT_RELEVANCE, since_year=since_year),
            fetch_crossref(client, query, fetch_cap, since_year=since_year),
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

    return ranked


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
         paper by the existing per-query ranking (_ranked_pool's own _fetch
         already WINNER-ranked each sub-query's list before this function
         ever sees it — see _multi_selected, which calls _ranked_pool
         directly rather than search_papers_async specifically so that
         WINNER's per-sub-query order survives instead of being overwritten
         by search_papers_async's date-sort-and-cap) — round-robin decides
         how many slots each entity gets, the existing ranking still decides
         WHICH papers represent it. A dedupe_key some earlier sub-query already claimed this round
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
    selected = await _multi_selected(queries, limit_per_query, final_limit, since_year)
    return _order_and_cap(selected, final_limit, since_year)


async def search_papers_multi_dual_async(
    queries: list[str], *, limit_per_query: int, final_limit: int,
    since_year: int | None = None,
) -> tuple[list[Item], list[Item]]:
    """search_papers_multi_async's selection logic, exposed as BOTH orderings
    — (latest, key) — of the SAME selected set, no second fan-out: `latest`
    is _order_and_cap's date-desc view (byte-for-byte what
    search_papers_multi_async already returned), `key` is that same
    selected set in its existing global-rank/WINNER order, merely capped —
    see search_papers_dual_async's docstring for the same idea at the
    single-query level."""
    selected = await _multi_selected(queries, limit_per_query, final_limit, since_year)
    latest = _order_and_cap(selected, final_limit, since_year)
    key = selected[:final_limit]
    return latest, key


async def _multi_selected(
    queries: list[str], limit_per_query: int, final_limit: int,
    since_year: int | None,
) -> list[Item]:
    """Shared core of search_papers_multi_async/search_papers_multi_dual_async:
    everything through round-robin selection, UNCAPPED and in global-rank/
    WINNER order — see search_papers_multi_async's own docstring for the
    full algorithm (round-robin selection, global-rank display order)."""
    if not queries:
        return []
    if len(queries) == 1:
        return await _ranked_pool(queries[0], final_limit, since_year)

    # Use _ranked_pool, NOT search_papers_async, for each sub-query. This is
    # the fix for a diagnosed bug: search_papers_async's return value has
    # already been through _order_and_cap, which (for since_year=None, the
    # only path reachable from the real UI) date-sorts AND caps to
    # `limit_per_query` (10) — discarding the WINNER re-rank that
    # search_papers_async's own _fetch just computed on that sub-query's
    # full, healthy pool (~90 nodes / 124-164 edges per sub-query, verified
    # live) and handing round-robin ten date-ordered, WINNER-blind items
    # instead. _ranked_pool is the exact same cached fetch (identical
    # normalize_key(f"papers:{limit}:{since_year or ''}", query) — this call
    # and the one search_papers_async makes internally share one cache
    # entry, so this costs NO additional OpenAlex/PubMed/Crossref credits),
    # just returned UNCAPPED and in WINNER's own order (or _rank_merge's
    # order, on the rarer sub-query where WINNER itself fell back) instead
    # of re-sorted by date. Round-robin (step 2 below) can then draw each
    # sub-query's genuinely-most-central papers first, not its most-recent.
    results = await asyncio.gather(
        *(_ranked_pool(q, limit_per_query, since_year) for q in queries),
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
    #
    # DOES WINNER RUN TWICE? Yes, deliberately, and the two runs are not
    # redundant. The per-sub-query run (inside _ranked_pool/_fetch, above)
    # ranks each gene's OWN ~90-node pool by centrality within that gene's
    # own literature — that's what round-robin now draws from to pick WHICH
    # papers represent each gene. This second run ranks the union of those
    # (now uncapped, ~90-per-gene) pools AFTER dedup — a much richer graph
    # than the old 10-per-gene union, since it still contains each gene's
    # full citation cluster, not just its 10 most recent papers — and its
    # job is ONLY to decide the FINAL DISPLAY ORDER (step 4) of whichever
    # papers round-robin selected. It commonly has enough edges to run for
    # real now (each gene's own cluster still cites itself even if cross-
    # gene citations stay rare), which is a genuine improvement over before;
    # if it still falls short of MIN_EDGES for a particular query, step 4
    # just emits the round-robin selection in _rank_merge's citations/date
    # order instead — never a meaningless rank on an unrankable graph, and
    # never a reason to lower MIN_EDGES. Either way, Key Papers' ORDER never
    # depends on this second call succeeding: which ten papers appear was
    # already decided by round-robin over each gene's own WINNER rank; this
    # call only refines how those ten are sequenced against each other.
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

    # Step 4 — emit in global-rank order, restricted to the selected set —
    # capping/date-ordering is left to the caller (_order_and_cap for the
    # date view, a bare slice for the WINNER view).
    return [item for item in ranked_global if item.dedupe_key in used]


def search_papers(query: str, limit: int = 20, since_year: int | None = None) -> list[Item]:
    """Synchronous entry point (the registered tool signature).

    Search PubMed, OpenAlex and Crossref for papers relevant to `query` and return
    up to `limit` deduped Items, best-ranked first. `since_year`, when given,
    restricts to papers published on/after that year (see sources/*.py).
    """
    return asyncio.run(search_papers_async(query, limit, since_year))
