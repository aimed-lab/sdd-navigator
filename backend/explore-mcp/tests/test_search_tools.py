"""
test_search_tools — GitHub fetcher Item-shape test from a recorded fixture.

Asserts kind/source, the stars Signal (real metric), blank-title drop, and that
no forbidden field (email/transcript/contact_info) appears in output.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sources.github import fetch_github  # noqa: E402

_FORBIDDEN = ("email", "transcript", "contact_info")


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


def _assert_no_forbidden(items):
    for it in items:
        blob = json.dumps(it.model_dump(), default=str)
        for field in _FORBIDDEN:
            assert field not in blob


def test_github_item_shape_and_stars_signal():
    client = _FakeClient({"items": [
        {
            "full_name": "scverse/scanpy",
            "description": "Single-cell analysis in Python",
            "html_url": "https://github.com/scverse/scanpy",
            "pushed_at": "2024-05-01T12:00:00Z",
            "stargazers_count": 1800,
            "language": "Python",
            "topics": ["single-cell", "rna-seq", "bioinformatics"],
        },
        {"full_name": "", "stargazers_count": 10},  # blank full_name -> dropped
    ]})
    items = asyncio.run(fetch_github(client, "single cell rna seq", 10))

    assert len(items) == 1
    it = items[0]
    assert it.id == "github:scverse/scanpy"
    assert it.kind == "tool"
    assert it.source == "github"
    assert it.title == "scverse/scanpy"
    assert it.summary == "Single-cell analysis in Python"
    assert it.url == "https://github.com/scverse/scanpy"
    assert it.date_iso == "2024-05-01T12:00:00.000Z"
    # REAL stars signal
    assert it.signal is not None
    assert it.signal.metric == "stars"
    assert it.signal.value == 1800.0
    assert it.dedupe_key == "url:github.com/scverse/scanpy"
    _assert_no_forbidden(items)


def test_github_missing_description_gets_fallback():
    client = _FakeClient({"items": [
        {"full_name": "a/b", "html_url": "https://github.com/a/b", "stargazers_count": 5},
    ]})
    items = asyncio.run(fetch_github(client, "x", 10))
    assert items[0].summary == "Open-source tool on GitHub."
    assert items[0].signal.value == 5.0


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
