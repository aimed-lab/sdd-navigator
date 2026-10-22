"""
tests/test_explore_only_kinds.py — the optional `only_kinds` restriction on explore.

A user who picks a scope ("Grants") must get THAT source queried with their text,
even when the LLM router would not have chosen it. No network, no Groq: the
per-source functions are stubbed, and the scope/route steps are made to explode
if they are ever reached.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

import tools.explore as te  # noqa: E402


class _item:
    """Minimal stand-in for a source item: the fan-out only calls model_dump()."""

    def __init__(self, kind: str, title: str):
        self._d = {"id": f"{kind}-1", "kind": kind, "title": title}

    def model_dump(self):
        return dict(self._d)


@pytest.fixture
def stubs(monkeypatch):
    calls: list[tuple[str, str]] = []

    def make(name, kind):
        async def fn(query, *args, **kwargs):
            calls.append((name, query))
            return [_item(kind, f"{kind} for {query}")]
        return fn

    monkeypatch.setattr(te, "search_grants_async", make("search_grants", "grant"))
    monkeypatch.setattr(te, "search_preprints_async", make("search_preprints", "preprint"))
    monkeypatch.setattr(te, "search_fda_async", make("search_fda", "approval"))
    monkeypatch.setattr(te, "search_tools_async", make("search_tools", "tool"))
    monkeypatch.setattr(te, "search_datasets_async", make("search_datasets", "dataset"))

    def boom(*a, **k):
        raise AssertionError("scope extraction / routing must not run for only_kinds")

    monkeypatch.setattr(te, "_extract_scope", boom)
    monkeypatch.setattr(te, "_choose_tools", boom)
    return calls


def test_normalize_drops_unknown_and_sorts():
    assert te.normalize_only_kinds(["grant", "bogus", " paper ", "grant"]) == ["grant", "paper"]
    assert te.normalize_only_kinds([]) == []
    assert te.normalize_only_kinds(None) == []
    assert te.normalize_only_kinds("grant") == []


def test_only_grants_queries_grants_with_the_typed_text(stubs):
    result = asyncio.run(te.explore_async("AI in health", only_kinds=["grant"]))

    assert stubs == [("search_grants", "AI in health")]
    assert result["tools_called"] == ["search_grants"]
    assert [s["kind"] for s in result["sections"]] == ["grant"]
    assert result["sections"][0]["items"][0]["title"] == "grant for AI in health"
    assert result["scope"]["topics"] == ["AI in health"]


def test_only_preprints_and_fda_are_reachable(stubs):
    result = asyncio.run(te.explore_async("KRAS lung", only_kinds=["preprint", "approval"]))

    assert sorted(c[0] for c in stubs) == ["search_fda", "search_preprints"]
    assert sorted(s["kind"] for s in result["sections"]) == ["approval", "preprint"]


def test_tools_and_datasets_scope_runs_both(stubs):
    result = asyncio.run(te.explore_async("single cell", only_kinds=["tool", "dataset"]))

    assert sorted(s["kind"] for s in result["sections"]) == ["dataset", "tool"]


def test_unknown_kinds_fall_back_to_normal_routing(monkeypatch):
    seen = {}

    async def fake_uncached(input_text, scope_terms, since_year, status_filter):
        seen["normal"] = True
        return {"input": input_text, "scope": {}, "tools_called": [], "sections": []}

    monkeypatch.setattr(te, "_explore_uncached", fake_uncached)
    asyncio.run(te.explore_async("unknown-kind query", only_kinds=["nope"]))
    assert seen == {"normal": True}


def test_blank_input_ignores_only_kinds(monkeypatch):
    seen = {}

    async def fake_uncached(input_text, scope_terms, since_year, status_filter):
        seen["landing"] = True
        return {"input": "", "scope": {}, "tools_called": [], "sections": []}

    monkeypatch.setattr(te, "_explore_uncached", fake_uncached)
    asyncio.run(te.explore_async("", only_kinds=["grant"]))
    assert seen == {"landing": True}


def test_different_kind_sets_are_cached_separately(stubs):
    asyncio.run(te.explore_async("cache probe topic", only_kinds=["grant"]))
    asyncio.run(te.explore_async("cache probe topic", only_kinds=["preprint"]))
    assert sorted(c[0] for c in stubs) == ["search_grants", "search_preprints"]
