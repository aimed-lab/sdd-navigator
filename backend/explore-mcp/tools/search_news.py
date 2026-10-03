"""
tools/search_news.py — real industry news from public RSS feeds (BioPharma
Dive, STAT, Endpoints; see sources/rss_news.py for which feeds work and why
Fierce Biotech isn't one).

Each Item is headline + source name + date + link only (kind="news").

THE FEEDS ARE CACHED, NOT THE QUERY: one cache entry holds the merged,
30-day-trimmed, de-duplicated, newest-first list for 1 hour (cache.py's own
get_or_compute — which also gives single-flight and the short empty-result
TTL if every feed is down). A query then filters that cached list in memory.

QUERY RULES:
  * match=False (the landing feed): newest first across all sources, no filter.
  * match=True (a typed search): only items whose HEADLINE matches the search
    terms. No match -> [] (the frontend hides an empty section). It NEVER falls
    back to OpenAlex papers or anything else.
"""

from __future__ import annotations

import asyncio
import re

from cache import cache
from models import Item
from sources.rss_news import fetch_news

TTL_NEWS = 60 * 60          # feeds are fresh for 1 hour
STALE_NEWS = 3 * 60 * 60

# Words that carry no topic on their own — a query of only these matches nothing.
_STOP = {
    "the", "and", "for", "with", "from", "into", "that", "this", "are", "was",
    "disease", "diseases", "drug", "drugs", "study", "studies", "research",
}


def _terms(query: str) -> list[str]:
    seen: list[str] = []
    for w in re.findall(r"[a-z0-9][a-z0-9\-']*", (query or "").lower()):
        w = w.strip("-'")
        if len(w) >= 3 and w not in _STOP and w not in seen:
            seen.append(w)
    return seen


def matches(headline: str, terms: list[str]) -> bool:
    """Whole-word match on the headline: every term for 1-2 term searches, at
    least two terms for longer ones (a long extracted phrase rarely appears
    verbatim in a headline)."""
    if not terms:
        return False
    text = (headline or "").lower()
    hits = sum(1 for t in terms if re.search(rf"(?<![a-z0-9]){re.escape(t)}(?![a-z0-9])", text))
    return hits >= (len(terms) if len(terms) <= 2 else 2)


async def search_news_async(query: str, limit: int = 20, match: bool = True) -> list[Item]:
    """Cached feeds, filtered per query. Never raises."""
    items = await cache.get_or_compute("news:feeds", fetch_news, TTL_NEWS, STALE_NEWS)
    if match:
        terms = _terms(query)
        items = [i for i in items if matches(i.title, terms)]
    return items[:limit]


def search_news(query: str, limit: int = 20) -> list[Item]:
    """Industry news whose headline matches `query`, newest first."""
    return asyncio.run(search_news_async(query, limit))
