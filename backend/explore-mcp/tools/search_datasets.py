"""
tools/search_datasets.py — search NCBI GEO for gene-expression/functional-
genomics datasets.

Wraps sources.geo.fetch_geo. kind="dataset", source="geo", signal=None (no
ranking metric — GEO records don't cite each other, so there is no citation
graph for rank_papers_winner to work with; this tool never calls it. See
ranking.py / search_papers.py for what WINNER needs and why GEO can't supply
it). The source call is isolated — a failure degrades to an empty list
rather than raising, same pattern as search_trials.py.

Ordering: relevance, then recency. NCBI's esearch (no `sort=` param, unlike
pubmed.py's explicit `sort=date`) returns ids in ITS OWN relevance-ranked
order, and that order is what fetch_geo/esummary preserve — NCBI exposes no
relevance SCORE, only rank position, so there is nothing to break ties on:
a "sort by date" pass here would not just tie-break, it would silently
invert relevance order across the whole list (every item has a different
date), producing a recency-sorted list wearing a "relevance" label. So this
tool does exactly one sort — NCBI's own relevance order, verbatim — and
"then recency" is honored in the only honest sense available: recency is
never allowed to override it.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import STALE_SOURCE, TTL_SOURCE, cache, normalize_key
from models import Item
from sources.geo import fetch_geo

logger = logging.getLogger(__name__)


async def search_datasets_async(query: str, limit: int = 20) -> list[Item]:
    """Cached + single-flighted (see _fetch)."""
    key = normalize_key(f"datasets:{limit}", query)
    return await cache.get_or_compute(
        key, lambda: _fetch(query, limit), TTL_SOURCE, STALE_SOURCE
    )


async def _fetch(query: str, limit: int) -> list[Item]:
    try:
        async with httpx.AsyncClient() as client:
            items = await fetch_geo(client, query, limit)
    except Exception:
        logger.exception("search_datasets: GEO fetch failed for query=%r", query)
        return []   # per-source isolation

    # No re-sort here — fetch_geo already returns NCBI's own relevance order
    # verbatim (see module docstring for why a date-based tie-break isn't
    # implementable without corrupting it).
    return items[:limit]


def search_datasets(query: str, limit: int = 20) -> list[Item]:
    """Search NCBI GEO for gene-expression/functional-genomics datasets
    relevant to `query`. Returns up to `limit` Items (kind="dataset")."""
    return asyncio.run(search_datasets_async(query, limit))
