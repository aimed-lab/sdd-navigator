"""
tools/search_news.py — recency-first industry news for drug discovery / AI.

Reuses sources.openalex.fetch_openalex (which already sorts by publication_date
desc, NOT by relevance) with kind="news", so items come back newest-first. Same
Item shape, same DOI dedupe, same referenced_works capture in raw, same
blank-title drop, and the citations Signal where OpenAlex reports one (else None).
The source call is isolated — a failure degrades to an empty list.
"""

from __future__ import annotations

import asyncio

import httpx

from models import Item
from sources.openalex import SORT_RECENT, fetch_openalex

_USER_AGENT = "explore-mcp/0.1 (SDD Navigator; research tooling)"


async def search_news_async(query: str, limit: int = 20) -> list[Item]:
    try:
        async with httpx.AsyncClient(headers={"User-Agent": _USER_AGENT}) as client:
            # Recency is this tool's contract — passed explicitly (rather than
            # relying on the default) so a future default change can't silently
            # turn news into a relevance feed.
            items = await fetch_openalex(
                client, query, limit, kind="news", sort=SORT_RECENT
            )
    except Exception:
        return []   # per-source isolation
    # OpenAlex already returns publication_date desc; sort defensively to guarantee
    # newest-first regardless of API ordering.
    items.sort(key=lambda it: it.date_iso or "", reverse=True)
    return items[:limit]


def search_news(query: str, limit: int = 20) -> list[Item]:
    """Recency-first industry news for the drug-discovery field: the most recent
    OpenAlex works matching `query`, newest first (kind="news"). Returns up to
    `limit` Items. Citations Signal is set where OpenAlex reports one, else None."""
    return asyncio.run(search_news_async(query, limit))
