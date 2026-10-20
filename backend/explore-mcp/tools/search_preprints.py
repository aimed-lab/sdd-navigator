"""
tools/search_preprints.py — search preprints (bioRxiv, medRxiv, Research Square,
...) on Europe PMC.

Wraps sources.europepmc.fetch_preprints. kind="preprint", source="europepmc",
signal=None (no ranking metric). The source call is isolated — a failure
degrades to an empty list rather than raising.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import STALE_SOURCE, TTL_SOURCE, cache, normalize_key
from models import Item
from sources.europepmc import fetch_preprints

logger = logging.getLogger(__name__)


async def search_preprints_async(query: str, limit: int = 20) -> list[Item]:
    """Cached + single-flighted (see _fetch)."""
    key = normalize_key(f"preprints:{limit}", query)
    return await cache.get_or_compute(
        key, lambda: _fetch(query, limit), TTL_SOURCE, STALE_SOURCE
    )


async def _fetch(query: str, limit: int) -> list[Item]:
    try:
        async with httpx.AsyncClient() as client:
            return await fetch_preprints(client, query, limit)
    except Exception:
        logger.exception("search_preprints: europepmc fetch failed for query=%r", query)
        return []   # per-source isolation


def search_preprints(query: str, limit: int = 20) -> list[Item]:
    """Search Europe PMC for preprints relevant to `query`. Returns up to
    `limit` Items (kind="preprint"), newest first."""
    return asyncio.run(search_preprints_async(query, limit))
