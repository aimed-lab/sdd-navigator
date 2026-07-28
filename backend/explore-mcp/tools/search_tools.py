"""
tools/search_tools.py — search open-source software tools on GitHub.

Wraps sources.github.fetch_github. kind="tool", source="github". Each result
carries a REAL stars Signal (metric="stars"); nothing is fabricated. The source
call is isolated — a failure degrades to an empty list rather than raising.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import STALE_TOOLS, TTL_TOOLS, cache, normalize_key
from models import Item
from sources.github import fetch_github

logger = logging.getLogger(__name__)

_USER_AGENT = "explore-mcp/0.1 (SDD Navigator; research tooling)"


async def _fetch(query: str, limit: int) -> list[Item]:
    try:
        async with httpx.AsyncClient(headers={"User-Agent": _USER_AGENT}) as client:
            return await fetch_github(client, query, limit)
    except Exception:
        logger.exception("search_tools: github fetch failed for query=%r", query)
        return []   # per-source isolation


async def search_tools_async(query: str, limit: int = 20) -> list[Item]:
    """Cached + single-flighted.

    GitHub's SEARCH bucket is 30 requests per MINUTE authenticated — a tight
    burst ceiling, not a generous hourly one. So this tool gets the LONGEST
    fresh window of any source (star counts barely move hour to hour), and
    single-flight is what keeps a cold-cache burst from eating the minute's
    budget on one repeated query.
    """
    key = normalize_key(f"tools:{limit}", query)
    return await cache.get_or_compute(
        key, lambda: _fetch(query, limit), TTL_TOOLS, STALE_TOOLS
    )


def search_tools(query: str, limit: int = 20) -> list[Item]:
    """Search GitHub for open-source software tools/repositories relevant to
    `query`, ranked by stars. Returns up to `limit` Items (kind="tool")."""
    return asyncio.run(search_tools_async(query, limit))
