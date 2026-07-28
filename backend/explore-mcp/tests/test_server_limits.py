"""
tests/test_server_limits.py — MCP tool `limit` clamping (server.py).

Every MCP tool used to accept an UNBOUNDED `limit`; the HTTP bridge routes
(/api/papers, /api/wiki) already clamped theirs. These tests cover both the
clamp helper in isolation and that each registered tool actually applies it
at the boundary (not just that the helper works). No pytest-asyncio in this
project — async calls run via asyncio.run(...), matching the rest of tests/.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

import server  # noqa: E402


# ── _clamp_limit in isolation ───────────────────────────────────────────────


@pytest.mark.parametrize("requested", [51, 100, 5000, 10 ** 9])
def test_over_ceiling_is_clamped(requested):
    assert server._clamp_limit(requested, ceiling=50, default=20, tool="t") == 50


@pytest.mark.parametrize("requested", [1, 10, 20, 49, 50])
def test_under_or_at_ceiling_passes_through(requested):
    assert server._clamp_limit(requested, ceiling=50, default=20, tool="t") == requested


@pytest.mark.parametrize("requested", [0, -1, -100, None, "not a number", ""])
def test_missing_zero_or_negative_falls_back_to_default(requested):
    assert server._clamp_limit(requested, ceiling=50, default=20, tool="t") == 20


def test_clamp_never_raises_on_garbage_input():
    for bad in (None, "", "abc", [], {}, object()):
        # must not raise — an agent should get useful results, not a rejection
        assert server._clamp_limit(bad, ceiling=50, default=20, tool="t") == 20


def test_clamp_logs_at_info_when_it_actually_clamps(caplog):
    with caplog.at_level(logging.INFO, logger="server"):
        server._clamp_limit(5000, ceiling=50, default=20, tool="search_papers")
    assert any(
        "search_papers" in r.message and "5000" in r.message and "50" in r.message
        for r in caplog.records
    )


def test_clamp_does_not_log_when_within_ceiling(caplog):
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="server"):
        server._clamp_limit(10, ceiling=50, default=20, tool="search_papers")
    assert caplog.records == []


# ── Applied at each tool boundary ───────────────────────────────────────────
# Each tool is patched so the underlying async/sync search function just
# records the `limit` it actually received, proving the tool applied the
# clamp BEFORE calling downstream — not just that the helper works alone.


def test_search_papers_clamps_at_the_boundary(monkeypatch):
    seen = {}

    async def fake(query, limit):
        seen["limit"] = limit
        return []

    monkeypatch.setattr(server, "search_papers_async", fake)
    asyncio.run(server.search_papers("q", limit=99999))
    assert seen["limit"] == server.MAX_LIMIT


def test_search_papers_under_ceiling_passes_through(monkeypatch):
    seen = {}

    async def fake(query, limit):
        seen["limit"] = limit
        return []

    monkeypatch.setattr(server, "search_papers_async", fake)
    asyncio.run(server.search_papers("q", limit=7))
    assert seen["limit"] == 7


def test_search_papers_zero_limit_falls_back_to_default(monkeypatch):
    seen = {}

    async def fake(query, limit):
        seen["limit"] = limit
        return []

    monkeypatch.setattr(server, "search_papers_async", fake)
    asyncio.run(server.search_papers("q", limit=0))
    assert seen["limit"] == 20


def test_search_papers_negative_limit_falls_back_to_default(monkeypatch):
    seen = {}

    async def fake(query, limit):
        seen["limit"] = limit
        return []

    monkeypatch.setattr(server, "search_papers_async", fake)
    asyncio.run(server.search_papers("q", limit=-5))
    assert seen["limit"] == 20


@pytest.mark.parametrize("tool_name,fn_name", [
    ("search_news", "search_news_async"),
    ("search_trials", "search_trials_async"),
    ("search_grants", "search_grants_async"),
    ("search_tools", "search_tools_async"),
])
def test_external_source_tools_clamp_at_max_limit(monkeypatch, tool_name, fn_name):
    seen = {}

    async def fake(query, limit):
        seen["limit"] = limit
        return []

    monkeypatch.setattr(server, fn_name, fake)
    tool = getattr(server, tool_name)
    asyncio.run(tool("q", limit=99999))
    assert seen["limit"] == server.MAX_LIMIT


def test_search_lab_resources_clamps_at_max_limit(monkeypatch):
    seen = {}

    def fake(query, category, limit):
        seen["limit"] = limit
        return []

    monkeypatch.setattr(server, "_search_lab_resources", fake)
    asyncio.run(server.search_lab_resources("q", None, limit=99999))
    assert seen["limit"] == server.MAX_LIMIT


def test_search_people_clamps_at_max_limit(monkeypatch):
    seen = {}

    def fake(query, limit):
        seen["limit"] = limit
        return []

    monkeypatch.setattr(server, "_search_people", fake)
    asyncio.run(server.search_people("q", limit=99999))
    assert seen["limit"] == server.MAX_LIMIT


def test_search_wiki_uses_the_wiki_ceiling_not_max_limit(monkeypatch):
    """search_wiki's ceiling is 500 (matches /api/wiki), not the general 50 —
    a caller asking for 99999 should be clamped to MAX_WIKI_LIMIT, and that
    must be strictly greater than MAX_LIMIT for this test to mean anything."""
    assert server.MAX_WIKI_LIMIT > server.MAX_LIMIT
    seen = {}

    def fake(query, limit):
        seen["limit"] = limit
        return []

    monkeypatch.setattr(server, "_search_wiki", fake)
    asyncio.run(server.search_wiki("q", limit=99999))
    assert seen["limit"] == server.MAX_WIKI_LIMIT


def test_search_wiki_under_wiki_ceiling_passes_through(monkeypatch):
    seen = {}

    def fake(query, limit):
        seen["limit"] = limit
        return []

    monkeypatch.setattr(server, "_search_wiki", fake)
    asyncio.run(server.search_wiki("q", limit=200))
    assert seen["limit"] == 200
