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
"""

from __future__ import annotations

import asyncio

import httpx

from dedupe import merge_items
from models import Item
from ranking import rank_papers_winner, relevance_seed_ids
from sources.crossref import fetch_crossref
from sources.openalex import SORT_RELEVANCE, fetch_openalex
from sources.pubmed import fetch_pubmed

_USER_AGENT = "explore-mcp/0.1 (SDD Navigator; research tooling)"


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


async def search_papers_async(query: str, limit: int = 20) -> list[Item]:
    """Async core: fan out, isolate failures, merge, dedupe, sort, cap."""
    async with httpx.AsyncClient(headers={"User-Agent": _USER_AGENT}) as client:
        results = await asyncio.gather(
            fetch_pubmed(client, query, limit),
            # Relevance, not recency: a topic's important papers cite each other,
            # which is what gives WINNER a graph to rank (a recency-sorted set
            # has ~zero intra-set citations). search_news keeps the recency sort.
            fetch_openalex(client, query, limit, sort=SORT_RELEVANCE),
            fetch_crossref(client, query, limit),
            return_exceptions=True,   # a failing source must not sink the batch
        )

    merged: list[Item] = []
    for result in results:
        if isinstance(result, Exception):
            continue  # per-source isolation — swallow this source, keep the rest
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


def search_papers(query: str, limit: int = 20) -> list[Item]:
    """Synchronous entry point (the registered tool signature).

    Search PubMed, OpenAlex and Crossref for papers relevant to `query` and return
    up to `limit` deduped Items, best-ranked first.
    """
    return asyncio.run(search_papers_async(query, limit))
