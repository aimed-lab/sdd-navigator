"""
tools/search_grants.py — search federal funding opportunities on Grants.gov.

Wraps sources.grants_gov.fetch_grants. kind="grant", source="grants_gov",
signal=None (no ranking metric). The source call is isolated — a failure
degrades to an empty list rather than raising.
"""

from __future__ import annotations

import asyncio

import httpx

from models import Item
from sources.grants_gov import fetch_grants

_USER_AGENT = "explore-mcp/0.1 (SDD Navigator; research tooling)"


async def search_grants_async(query: str, limit: int = 20) -> list[Item]:
    try:
        async with httpx.AsyncClient(headers={"User-Agent": _USER_AGENT}) as client:
            return await fetch_grants(client, query, limit)
    except Exception:
        return []   # per-source isolation


def search_grants(query: str, limit: int = 20) -> list[Item]:
    """Search Grants.gov for forecasted/posted federal funding opportunities
    relevant to `query`. Returns up to `limit` Items (kind="grant")."""
    return asyncio.run(search_grants_async(query, limit))
