"""
tools/search_chembl.py — search ChEMBL for drug mechanisms/bioactivity against
a gene target.

Wraps sources.chembl.fetch_chembl. kind="compound", source="chembl",
signal=None (no ranking metric). GENE-ONLY — see fetch_chembl's own docstring
for why a disease/topic string is not a useful query here. The source call is
isolated — a failure degrades to an empty list rather than raising, same
pattern as search_trials.py/search_datasets.py.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import STALE_SOURCE, TTL_SOURCE, cache, normalize_key
from models import Item
from sources.chembl import fetch_chembl

logger = logging.getLogger(__name__)


async def search_chembl_async(query: str, limit: int = 20) -> list[Item]:
    """Cached + single-flighted (see _fetch). `query` is expected to be a gene
    symbol (e.g. "KRAS") — see tools/explore.py's _QUERY_SLICES for how the
    orchestrator composes this tool's query."""
    key = normalize_key(f"chembl:{limit}", query)
    return await cache.get_or_compute(
        key, lambda: _fetch(query, limit), TTL_SOURCE, STALE_SOURCE
    )


async def _fetch(query: str, limit: int) -> list[Item]:
    try:
        async with httpx.AsyncClient() as client:
            return await fetch_chembl(client, query, limit)
    except Exception:
        logger.exception("search_chembl: ChEMBL fetch failed for query=%r", query)
        return []   # per-source isolation


def search_chembl(query: str, limit: int = 20) -> list[Item]:
    """Search ChEMBL for drug mechanisms and quantified bioactivity records
    against a gene target. `query` should be a gene symbol, e.g. "KRAS".
    Returns up to `limit` Items (kind="compound")."""
    return asyncio.run(search_chembl_async(query, limit))
