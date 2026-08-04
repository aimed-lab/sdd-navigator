"""
tools/search_pager.py — search PAGER for gene sets and pathways.

Wraps sources.pager.fetch_pager. kind="geneset", source="pager",
signal=None — no WINNER (see sources/pager.py's docstring: gene sets don't
cite each other, there is no citation graph to build one from). Fetch
failures are isolated (log + return []), same pattern as every other
source tool here.

The httpx.AsyncClient built HERE is the one and only place PAGER's TLS
trust-bundle workaround is applied (`verify=_trust_bundle_path()`) — scoped
to this one client, never global, never any other source. See
sources/pager.py's module docstring "TLS" section for the diagnosis and why
this is temporary.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import STALE_SOURCE, TTL_SOURCE, cache, normalize_key
from models import Item
from sources.pager import _trust_bundle_path, fetch_pager

logger = logging.getLogger(__name__)


async def search_pager_async(query: str, limit: int = 20) -> list[Item]:
    """Cached + single-flighted (see _fetch)."""
    key = normalize_key(f"pager:{limit}", query)
    return await cache.get_or_compute(
        key, lambda: _fetch(query, limit), TTL_SOURCE, STALE_SOURCE
    )


async def _fetch(query: str, limit: int) -> list[Item]:
    try:
        async with httpx.AsyncClient(verify=_trust_bundle_path()) as client:
            # fetch_pager ranks the FULL result set and cuts to `limit`
            # internally (see its docstring) — what comes back here, and what
            # therefore lands in the cache above, is already the trimmed set.
            return await fetch_pager(client, query, limit)
    except Exception:
        logger.exception("search_pager: PAGER fetch failed for query=%r", query)
        return []   # per-source isolation


def search_pager(query: str, limit: int = 20) -> list[Item]:
    """Search PAGER for gene sets and pathways relevant to `query`. Returns
    up to `limit` Items (kind="geneset")."""
    return asyncio.run(search_pager_async(query, limit))
