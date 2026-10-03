"""
sources/rss_news.py — real industry news from public RSS feeds.

Each result is headline + source name + date + link to the original article,
nothing else: no article text and no RSS description/summary is read or kept.

FEEDS were checked live (2026-10-03):
  * BioPharma Dive  https://www.biopharmadive.com/feeds/news/   200, RSS
  * STAT News       https://www.statnews.com/feed/                200, RSS
  * Endpoints News  https://endpoints.news/feed/                  200 — but only
    with a "Mozilla/5.0 (compatible; …)" User-Agent; a bare custom UA gets a
    403 from its CDN.
  * Fierce Biotech  https://www.fiercebiotech.com/rss/xml        403 — every
    URL variant sits behind a Cloudflare challenge. NOT USED.

One feed failing (HTTP error, timeout, bad XML) is logged and skipped;
fetch_news() never raises.
"""

from __future__ import annotations

import asyncio
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha1
from urllib.parse import urlsplit, urlunsplit

import httpx

from dedupe import dedupe_key
from models import Item

from .base import _iso

logger = logging.getLogger(__name__)

FEEDS: list[tuple[str, str, str]] = [
    # (source slug, display name, url)
    ("biopharmadive", "BioPharma Dive", "https://www.biopharmadive.com/feeds/news/"),
    ("statnews", "STAT News", "https://www.statnews.com/feed/"),
    ("endpoints", "Endpoints News", "https://endpoints.news/feed/"),
]

MAX_AGE_DAYS = 30
FEED_TIMEOUT = 10.0
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; explore-mcp/0.1; SDD Navigator)",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}


def _clean_link(link: str) -> str:
    """Drop query string and fragment (utm_* tracking) so one article seen via
    two feeds, or twice with different tracking params, dedupes by link."""
    p = urlsplit(link.strip())
    return urlunsplit((p.scheme, p.netloc, p.path, "", ""))


def parse_feed(xml_text: str, slug: str, name: str) -> list[Item]:
    """RSS 2.0 -> Items (headline, source, date, link). Items with no title,
    link or parseable date are skipped. Never reads description/content."""
    items: list[Item] = []
    root = ET.fromstring(xml_text)
    for node in root.iter("item"):
        title = (node.findtext("title") or "").strip()
        link = (node.findtext("link") or "").strip()
        pub = (node.findtext("pubDate") or "").strip()
        if not title or not link or not pub:
            continue
        try:
            when = parsedate_to_datetime(pub)
        except (TypeError, ValueError):
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        link = _clean_link(link)
        items.append(
            Item(
                id=f"news:{sha1(link.encode()).hexdigest()[:12]}",
                kind="news",
                title=title,
                summary=name,          # source name, shown as the card's small print
                url=link,
                source=slug,
                date_iso=_iso(when),
                dedupe_key=dedupe_key(link, title),
                raw={"source_name": name},
            )
        )
    return items


async def _fetch_one(client: httpx.AsyncClient, slug: str, name: str, url: str) -> list[Item]:
    try:
        resp = await client.get(url, headers=_HEADERS, timeout=FEED_TIMEOUT, follow_redirects=True)
        resp.raise_for_status()
        return parse_feed(resp.text, slug, name)
    except Exception as e:  # a failing feed is skipped, never fatal
        logger.warning("rss_news: feed %s failed: %s: %s", slug, type(e).__name__, e)
        return []


async def fetch_news(now: datetime | None = None) -> list[Item]:
    """All feeds, merged: items older than MAX_AGE_DAYS dropped, duplicates by
    link removed, newest first. Never raises."""
    try:
        async with httpx.AsyncClient() as client:
            results = await asyncio.gather(*(_fetch_one(client, s, n, u) for s, n, u in FEEDS))
    except Exception:
        logger.exception("rss_news: fetch failed")
        return []
    cutoff = _iso((now or datetime.now(timezone.utc)) - timedelta(days=MAX_AGE_DAYS))
    seen: set[str] = set()
    out: list[Item] = []
    for item in (i for group in results for i in group):
        if item.url in seen or (item.date_iso or "") < cutoff:
            continue
        seen.add(item.url)
        out.append(item)
    out.sort(key=lambda i: i.date_iso or "", reverse=True)
    return out
