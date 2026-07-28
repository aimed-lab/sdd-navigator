"""
test_search_news — news = recency-first OpenAlex (kind="news") from a fixture.

Asserts kind="news"/source="openalex", the citations Signal where present (else
None), blank-title drop, referenced_works captured in raw, and newest-first order.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sources.openalex import fetch_openalex  # noqa: E402


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        # Real httpx.Response always has this; sources/base.py's get_json now
        # reads it directly (no getattr fallback), so an unfaithful double
        # fails loudly rather than silently reporting 200.
        self.status_code = status_code

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payload):
        self._payload = payload

    async def get(self, url, timeout=None, headers=None):
        return _FakeResponse(self._payload)


def test_news_kind_and_signal_and_refs():
    client = _FakeClient({"results": [
        {
            "id": "https://openalex.org/W100",
            "title": "AI accelerates drug discovery pipelines",
            "doi": "https://doi.org/10.1/news",
            "publication_date": "2026-07-01",
            "cited_by_count": 3,
            "primary_location": {"source": {"display_name": "Nature Biotech"}},
            "authorships": [{"author": {"display_name": "X Y"}}],
            "referenced_works": ["https://openalex.org/W1"],
        },
        {"title": "", "cited_by_count": 0},  # blank title dropped
    ]})
    items = asyncio.run(fetch_openalex(client, "drug discovery", 10, kind="news"))

    assert len(items) == 1
    it = items[0]
    assert it.kind == "news"
    assert it.source == "openalex"
    assert it.title == "AI accelerates drug discovery pipelines"
    assert it.date_iso == "2026-07-01T00:00:00.000Z"
    assert it.signal is not None and it.signal.metric == "citations" and it.signal.value == 3.0
    assert it.doi == "10.1/news"
    assert it.raw["referenced_works"] == ["https://openalex.org/W1"]


def test_news_no_citation_is_none():
    client = _FakeClient({"results": [
        {"id": "https://openalex.org/W200", "title": "Drug candidate preprint", "publication_date": "2026-06-01"},
    ]})
    items = asyncio.run(fetch_openalex(client, "x", 10, kind="news"))
    assert items[0].kind == "news"
    assert items[0].signal is None   # no cited_by_count -> no fabricated signal


def test_search_news_sorts_newest_first():
    # search_news must guarantee date_iso descending regardless of API order.
    from tools import search_news as sn

    async def fake_fetch(client, term, cap, kind="paper", sort=None):
        from models import Item
        def mk(ext, date):
            return Item(id=f"openalex:{ext}", kind=kind, title=ext, source="openalex",
                        date_iso=date, dedupe_key=f"openalex:{ext}", raw={})
        # deliberately out of order
        return [mk("old", "2020-01-01T00:00:00.000Z"),
                mk("new", "2026-05-01T00:00:00.000Z"),
                mk("mid", "2023-01-01T00:00:00.000Z")]

    orig = sn.fetch_openalex
    sn.fetch_openalex = fake_fetch
    try:
        items = asyncio.run(sn.search_news_async("drug discovery", 10))
    finally:
        sn.fetch_openalex = orig

    dates = [it.date_iso for it in items]
    assert dates == sorted(dates, reverse=True)          # newest-first
    assert [it.id for it in items] == ["openalex:new", "openalex:mid", "openalex:old"]
    assert all(it.kind == "news" for it in items)


def test_search_news_requests_the_recency_sort():
    """search_news's contract is recency. If it ever silently switched to
    relevance (e.g. by inheriting a changed default) this catches it."""
    from tools import search_news as sn
    from sources.openalex import SORT_RECENT

    captured = {}

    async def fake_fetch(client, term, cap, kind="paper", sort=None):
        captured["sort"] = sort
        captured["kind"] = kind
        return []

    orig = sn.fetch_openalex
    sn.fetch_openalex = fake_fetch
    try:
        asyncio.run(sn.search_news_async("drug discovery", 5))
    finally:
        sn.fetch_openalex = orig

    assert captured["sort"] == SORT_RECENT
    assert captured["kind"] == "news"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for fn in fns:
        try:
            fn(); print(f"PASS  {fn.__name__}")
        except AssertionError as exc:
            failures += 1; print(f"FAIL  {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failures}/{len(fns)} passed")
    sys.exit(1 if failures else 0)
