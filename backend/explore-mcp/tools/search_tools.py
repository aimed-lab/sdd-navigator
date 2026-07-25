"""
tools/search_tools.py — search open-source software tools on GitHub.

Wraps sources.github.fetch_github. kind="tool", source="github". Each result
carries a REAL stars Signal (metric="stars"); nothing is fabricated. The source
call is isolated — a failure degrades to an empty list rather than raising.
"""

from __future__ import annotations

import asyncio

import httpx

from models import Item
from sources.github import fetch_github

_USER_AGENT = "explore-mcp/0.1 (SDD Navigator; research tooling)"


async def search_tools_async(query: str, limit: int = 20) -> list[Item]:
    try:
        async with httpx.AsyncClient(headers={"User-Agent": _USER_AGENT}) as client:
            return await fetch_github(client, query, limit)
    except Exception:
        return []   # per-source isolation


def search_tools(query: str, limit: int = 20) -> list[Item]:
    """Search GitHub for open-source software tools/repositories relevant to
    `query`, ranked by stars. Returns up to `limit` Items (kind="tool")."""
    return asyncio.run(search_tools_async(query, limit))
