"""
tools/search_fda.py — FDA-approved drugs whose label indication mentions a disease.

Wraps sources.openfda.fetch_fda_approvals. kind="approval", source="openfda",
signal=None. The source call is isolated — a failure degrades to an empty list
rather than raising. Approvals change slowly, so results are cached for hours.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import cache, normalize_key
from models import Item
from sources.openfda import fetch_fda_approvals

logger = logging.getLogger(__name__)

_TTL_FDA = 6 * 60 * 60
_STALE_FDA = 24 * 60 * 60


async def search_fda_async(query: str, limit: int = 20) -> list[Item]:
    """Cached + single-flighted (see _fetch)."""
    key = normalize_key(f"fda:{limit}", query)
    return await cache.get_or_compute(key, lambda: _fetch(query, limit), _TTL_FDA, _STALE_FDA)


async def _fetch(query: str, limit: int) -> list[Item]:
    try:
        async with httpx.AsyncClient() as client:
            return await fetch_fda_approvals(client, query, limit)
    except Exception:
        logger.exception("search_fda: openfda fetch failed for query=%r", query)
        return []   # per-source isolation


def search_fda(query: str, limit: int = 20) -> list[Item]:
    """FDA-approved (NDA/BLA) drugs whose label indication mentions `query`,
    newest approval first. Returns up to `limit` Items (kind="approval")."""
    return asyncio.run(search_fda_async(query, limit))
