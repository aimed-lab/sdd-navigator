"""
test_search_news — news = real RSS headlines (sources/rss_news.py), cached for
an hour, filtered by headline for typed searches. Fixture XML, no network.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sources import rss_news  # noqa: E402
from tools import search_news as sn  # noqa: E402


def _rss(entries):
    body = "".join(
        f"<item><title>{t}</title><link>{l}</link><pubDate>{format_datetime(d)}</pubDate>"
        f"<description>SHOULD NOT APPEAR</description></item>"
        for t, l, d in entries
    )
    return f'<?xml version="1.0"?><rss version="2.0"><channel>{body}</channel></rss>'


NOW = datetime.now(timezone.utc)


def test_parse_feed_headline_source_date_link_only():
    xml = _rss([("KRAS drug wins nod", "https://x.com/a?utm_source=rss#top", NOW)])
    (it,) = rss_news.parse_feed(xml, "endpoints", "Endpoints News")
    assert it.kind == "news" and it.title == "KRAS drug wins nod"
    assert it.url == "https://x.com/a"            # tracking query + fragment stripped
    assert it.summary == "Endpoints News"          # source name, never article text
    assert "SHOULD NOT APPEAR" not in it.model_dump_json()


def test_fetch_news_drops_old_dedupes_by_link_newest_first(monkeypatch):
    feeds = {
        "a": _rss([("Old story", "https://x.com/old", NOW - timedelta(days=45)),
                   ("Newer", "https://x.com/n", NOW - timedelta(days=1)),
                   ("Same link, first feed", "https://x.com/dup", NOW - timedelta(days=3))]),
        "b": _rss([("Same link, second feed", "https://x.com/dup?ref=b", NOW - timedelta(days=3)),
                   ("Newest", "https://x.com/newest", NOW - timedelta(hours=2))]),
    }

    async def fake_one(client, slug, name, url):
        return rss_news.parse_feed(feeds[slug], slug, name)

    monkeypatch.setattr(rss_news, "FEEDS", [("a", "A", "u"), ("b", "B", "u")])
    monkeypatch.setattr(rss_news, "_fetch_one", fake_one)
    items = asyncio.run(rss_news.fetch_news())
    assert [i.title for i in items] == ["Newest", "Newer", "Same link, first feed"]


def test_failing_feed_is_skipped(monkeypatch):
    async def fake_one(client, slug, name, url):
        if slug == "bad":
            return []
        return rss_news.parse_feed(_rss([("Good", "https://x.com/g", NOW)]), slug, name)

    monkeypatch.setattr(rss_news, "FEEDS", [("bad", "Bad", "u"), ("ok", "OK", "u")])
    monkeypatch.setattr(rss_news, "_fetch_one", fake_one)
    assert [i.title for i in asyncio.run(rss_news.fetch_news())] == ["Good"]


def test_headline_matching_rules():
    t = sn._terms
    assert sn.matches("Amgen's KRAS inhibitor advances", t("KRAS"))
    assert not sn.matches("Cancer drug news", t("KRAS"))
    assert not sn.matches("Anything", t("RDKit"))
    assert not sn.matches("The drug disease", t("the drug disease"))   # only stopwords -> no match
    assert sn.matches("KRAS and SHP2 combo", t("KRAS SHP2"))
    assert not sn.matches("KRAS only here", t("KRAS SHP2"))


def test_search_filters_but_landing_does_not(monkeypatch):
    from models import Item

    def item(title):
        return Item(id=f"news:{title}", kind="news", title=title, url=f"https://x.com/{title}",
                    source="s", date_iso="2026-10-01T00:00:00.000Z", dedupe_key=title)

    async def fake_get(key, fn, ttl, stale):
        return [item("KRAS win"), item("Other")]

    monkeypatch.setattr(sn.cache, "get_or_compute", fake_get)
    assert [i.title for i in asyncio.run(sn.search_news_async("KRAS", 10))] == ["KRAS win"]
    assert asyncio.run(sn.search_news_async("RDKit", 10)) == []
    assert len(asyncio.run(sn.search_news_async("drug discovery", 10, match=False))) == 2
