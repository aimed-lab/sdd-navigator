"""
test_search_grants — Grants.gov fetcher Item-shape test from a recorded fixture.

Asserts kind/source, signal is None (no metric — never fabricated), the
missing-number drop, and that no forbidden field appears in output.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sources.grants_gov import fetch_grants  # noqa: E402

_FORBIDDEN = ("email", "transcript", "contact_info")


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        # Real httpx.Response always has this; sources/base.py's get_json/
        # post_json now read it directly (no getattr fallback), so an
        # unfaithful double fails loudly rather than silently reporting 200.
        self.status_code = status_code

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payload):
        self._payload = payload

    async def post(self, url, timeout=None, json=None, headers=None):
        return _FakeResponse(self._payload)


def _assert_no_forbidden(items):
    for it in items:
        blob = json.dumps(it.model_dump(), default=str)
        for field in _FORBIDDEN:
            assert field not in blob


def test_grants_item_shape_and_no_signal():
    client = _FakeClient({"data": {"oppHits": [
        {
            "id": 358123,
            "title": "Glioblastoma Therapeutics Development",
            "number": "RFA-CA-26-001",
            "agencyCode": "HHS-NIH-NCI",
            "agency": "National Cancer Institute",
            "openDate": "2026-06-01",
        },
        {"title": "Missing number opportunity"},          # no number -> dropped
        {"number": "X-1"},                                  # no title  -> dropped
    ]}})
    items = asyncio.run(fetch_grants(client, "glioblastoma", 10))

    assert len(items) == 1
    it = items[0]
    assert it.id == "grants_gov:358123"
    assert it.kind == "grant"
    assert it.source == "grants_gov"
    assert it.title == "Glioblastoma Therapeutics Development"
    assert it.summary == "HHS-NIH-NCI — National Cancer Institute"
    assert it.url == "https://www.grants.gov/search-results-detail/358123"
    assert it.date_iso == "2026-06-01T00:00:00.000Z"
    assert it.signal is None                # grants expose no ranking metric
    _assert_no_forbidden(items)


_HITS_PANCREATIC = {"data": {"oppHits": [
    {"id": 1, "number": "A-1", "title": "The Role of the Innate Immune System in the Pathogenesis of Type 1 Diabetes"},
    {"id": 2, "number": "A-2", "title": "Immune Tolerance Network"},
    {
        "id": 3, "number": "PAR-26-001", "title": "Pancreatic Cancer Detection Consortium",
        "agencyCode": "HHS-NIH-NCI", "agency": "National Cancer Institute", "oppStatus": "posted",
        "openDate": "2026-05-01", "closeDate": "2026-12-15",
    },
]}}


def test_grants_must_mention_drops_off_topic_titles():
    client = _FakeClient(_HITS_PANCREATIC)
    items = asyncio.run(fetch_grants(client, "pancreatic cancer KRAS", 10, must_mention=["pancreatic cancer", "KRAS"]))
    assert [it.title for it in items] == ["Pancreatic Cancer Detection Consortium"]


def test_grants_must_mention_no_match_returns_empty_not_unfiltered():
    client = _FakeClient(_HITS_PANCREATIC)
    assert asyncio.run(fetch_grants(client, "x", 10, must_mention=["glioblastoma"])) == []


def test_grants_must_mention_is_whole_phrase():
    client = _FakeClient({"data": {"oppHits": [{"id": 9, "number": "B-1", "title": "Nonkrasonic Studies"}]}})
    assert asyncio.run(fetch_grants(client, "x", 10, must_mention=["kras"])) == []


def test_grants_without_must_mention_keeps_everything():
    client = _FakeClient(_HITS_PANCREATIC)
    assert len(asyncio.run(fetch_grants(client, "x", 10))) == 3


def test_grants_raw_is_small_dict_with_close_date():
    client = _FakeClient(_HITS_PANCREATIC)
    items = asyncio.run(fetch_grants(client, "x", 10, must_mention=["pancreatic cancer"]))
    assert items[0].raw == {
        "number": "PAR-26-001",
        "agency": "National Cancer Institute",
        "agency_code": "HHS-NIH-NCI",
        "status": "posted",
        "open_date": "2026-05-01",
        "close_date": "2026-12-15",
    }


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
