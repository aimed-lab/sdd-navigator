"""
tools/search_grants.py — search federal funding opportunities on Grants.gov.

Wraps sources.grants_gov.fetch_grants. kind="grant", source="grants_gov",
signal=None (no ranking metric). The source call is isolated — a failure
degrades to an empty list rather than raising.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import STALE_SOURCE, TTL_SOURCE, cache, normalize_key
from models import Item
from sources.grants_gov import fetch_grants

logger = logging.getLogger(__name__)

_USER_AGENT = "explore-mcp/0.1 (SDD Navigator; research tooling)"


# Filtering by activity_codes (see sources/grants_gov.py) is a POST-fetch
# drop, not a narrower request — it can remove most of a plain keyword
# search's hits (federal listings skew R01/U01/R21-heavy). Fetching only
# `limit` rows and THEN filtering would starve the result down to almost
# nothing, same problem search_papers.py's _DEFAULT_POOL_SIZE fixes for
# papers — so a career-stage-filtered request fetches a much wider
# candidate pool first, then caps to `limit` after filtering.
_ACTIVITY_FILTER_POOL_SIZE = 75


async def search_grants_async(
    query: str, limit: int = 20, activity_codes: tuple[str, ...] | None = None
) -> list[Item]:
    """Cached + single-flighted (see _fetch). `activity_codes`, when given,
    is folded into the cache key — a stage-filtered search and an
    unfiltered one for the same query text are genuinely different results
    and must never share a cache entry."""
    codes_key = "|".join(sorted(c.upper() for c in activity_codes)) if activity_codes else ""
    key = normalize_key(f"grants:{limit}:{codes_key}", query)
    return await cache.get_or_compute(
        key, lambda: _fetch(query, limit, activity_codes), TTL_SOURCE, STALE_SOURCE
    )


async def _fetch(
    query: str, limit: int, activity_codes: tuple[str, ...] | None = None
) -> list[Item]:
    try:
        fetch_cap = _ACTIVITY_FILTER_POOL_SIZE if activity_codes else limit
        async with httpx.AsyncClient(headers={"User-Agent": _USER_AGENT}) as client:
            items = await fetch_grants(client, query, fetch_cap, activity_codes=activity_codes)
        return items[:limit] if activity_codes else items
    except Exception:
        logger.exception("search_grants: grants.gov fetch failed for query=%r", query)
        return []   # per-source isolation


def search_grants(
    query: str, limit: int = 20, activity_codes: tuple[str, ...] | None = None
) -> list[Item]:
    """Search Grants.gov for forecasted/posted federal funding opportunities
    relevant to `query`. Returns up to `limit` Items (kind="grant").
    `activity_codes` (e.g. ("K99","R00","K23","K01","R03")), when given,
    drops any opportunity whose title names an NIH activity code NONE of
    which are in that set — see sources/grants_gov.py's own comment on why
    this can only ever be a positive-signal filter, not a guarantee."""
    return asyncio.run(search_grants_async(query, limit, activity_codes))
