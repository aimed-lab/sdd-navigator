"""
tools/search_trials.py — search ClinicalTrials.gov for studies.

Wraps sources.clinical_trials.fetch_trials. kind="trial", source="clinicaltrials",
signal=None (no ranking metric). The source call is isolated — a failure degrades
to an empty list rather than raising.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import STALE_SOURCE, TTL_SOURCE, cache, normalize_key
from models import Item
from sources.clinical_trials import fetch_trials

logger = logging.getLogger(__name__)

# NOTE: ClinicalTrials.gov's CDN 403s a custom User-Agent (and even a browser-like
# one), but allows httpx's default UA. So we do NOT override User-Agent here; we
# only ask for JSON explicitly.
_HEADERS = {"Accept": "application/json"}


async def search_trials_async(
    query: str, limit: int = 20, status_filter: list[str] | None = None
) -> list[Item]:
    """Cached + single-flighted (see _fetch). `status_filter` (e.g.
    ["TERMINATED", "WITHDRAWN"]) is part of the cache key — a status-filtered
    search and an unfiltered one for the same term are different results and
    must not share a cache entry."""
    status_key = ",".join(status_filter) if status_filter else ""
    key = normalize_key(f"trials:{limit}:{status_key}", query)
    return await cache.get_or_compute(
        key, lambda: _fetch(query, limit, status_filter), TTL_SOURCE, STALE_SOURCE
    )


async def _fetch(query: str, limit: int, status_filter: list[str] | None = None) -> list[Item]:
    try:
        async with httpx.AsyncClient(headers=_HEADERS) as client:
            return await fetch_trials(client, query, limit, status_filter)
    except Exception:
        logger.exception("search_trials: clinicaltrials.gov fetch failed for query=%r", query)
        return []   # per-source isolation


def search_trials(query: str, limit: int = 20, status_filter: list[str] | None = None) -> list[Item]:
    """Search ClinicalTrials.gov for clinical studies relevant to `query`.
    Returns up to `limit` Items (kind="trial"). `status_filter`, when given, is
    forwarded to the v2 API's `filter.overallStatus` (e.g. ["TERMINATED",
    "WITHDRAWN"]) — filtered server-side, not fetched-then-discarded here."""
    return asyncio.run(search_trials_async(query, limit, status_filter))
