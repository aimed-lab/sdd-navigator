"""
tests/test_explore_personalized.py — the interest-scoped landing feed.

Two things are being pinned down here:

  1. SHAPE — blank input plus scope terms serves the landing feed scoped to those
     terms (no LLM, default tool set, scope.is_personalized=true), while blank
     input alone still serves the generic field-wide feed. A real search ignores
     the terms entirely.

  2. CACHE ISOLATION — the load-bearing one. A personalized feed must never be
     served from, or stored into, the shared blank-input entry, or one user's
     interests would show up on another's front page. Keys are derived from the
     TERMS, so identical interest sets legitimately share an entry and different
     ones never do.

No network and no Groq: _execute (the tool fan-out) is stubbed, and it records
the scope it was handed so each assertion can check what the feed was built from.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

import tools.explore as te  # noqa: E402


@pytest.fixture
def executed(monkeypatch):
    """Stub the fan-out. Returns the list of (chosen_tools, scope) it was called
    with — one entry per ACTUAL compute, so its length is the miss count."""
    calls: list[tuple[list[str], dict]] = []

    async def fake_execute(chosen, scope):
        calls.append((list(chosen), dict(scope)))
        return [{"tool": name, "kind": te._KINDS[name], "query": "", "items": []} for name in chosen]

    monkeypatch.setattr(te, "_execute", fake_execute)
    return calls


@pytest.fixture
def no_llm(monkeypatch):
    """Stub scope extraction + routing so a search path never calls Groq."""
    monkeypatch.setattr(
        te, "_extract_scope",
        lambda text: {**te._EMPTY_SCOPE, "topics": [text]},
    )
    monkeypatch.setattr(te, "_choose_tools", lambda text, scope: (["search_papers"], "stub"))


# ── shape ─────────────────────────────────────────────────────────────────────


def test_interests_become_the_landing_feed_scope(executed):
    result = asyncio.run(te.explore_async("", ["cancer", "PHGDH"]))

    assert result["scope"]["topics"] == ["cancer", "PHGDH"]
    assert result["scope"]["is_personalized"] is True
    assert result["scope"]["is_default"] is True          # still the blank-state feed
    assert "drug discovery" not in result["scope"]["topics"]
    assert result["tools_called"] == te._DEFAULT_TOOLS    # same fixed routing
    assert len(executed) == 1


def test_no_interests_still_serves_the_generic_feed(executed):
    result = asyncio.run(te.explore_async(""))

    assert result["scope"]["topics"] == te._DEFAULT_SCOPE["topics"]
    assert result["scope"]["is_personalized"] is False
    assert result["scope"]["is_default"] is True


@pytest.mark.parametrize("empty", [None, [], ["", "   "]])
def test_empty_interest_sets_fall_back_to_the_generic_feed(executed, empty):
    result = asyncio.run(te.explore_async("", empty))
    assert result["scope"]["topics"] == te._DEFAULT_SCOPE["topics"]
    assert result["scope"]["is_personalized"] is False


def test_a_real_search_is_never_widened_by_the_callers_interests(executed, no_llm):
    """The user's typed query is their scope. Their profile must not join it."""
    result = asyncio.run(te.explore_async("glioblastoma", ["cancer", "PHGDH"]))

    assert result["scope"]["topics"] == ["glioblastoma"]
    assert result["scope"]["is_personalized"] is False
    assert "cancer" not in str(result["scope"])


def test_terms_are_cleaned_and_capped():
    assert te._clean_terms(["  cancer  ", "CANCER", "cancer"]) == ["cancer"]
    assert te._clean_terms(["a\n b"]) == ["a b"]
    assert te._clean_terms([None, "", "  ", "x"]) == ["x"]
    assert len(te._clean_terms([f"t{i}" for i in range(50)])) == te._MAX_SCOPE_TERMS
    assert all(len(t) <= te._MAX_TERM_CHARS for t in te._clean_terms(["z" * 500]))


# ── cache isolation ───────────────────────────────────────────────────────────


def test_one_users_feed_is_not_served_to_another(executed):
    """Three different scopes -> three computes, each with its own scope. If any
    of them shared a key, a user would see someone else's feed."""

    async def body():
        a = await te.explore_async("", ["cancer", "PHGDH"])
        b = await te.explore_async("", ["glioblastoma"])
        generic = await te.explore_async("")
        return a, b, generic

    a, b, generic = asyncio.run(body())

    assert a["scope"]["topics"] == ["cancer", "PHGDH"]
    assert b["scope"]["topics"] == ["glioblastoma"]
    assert generic["scope"]["topics"] == te._DEFAULT_SCOPE["topics"]
    assert len(executed) == 3


def test_a_personalized_feed_does_not_poison_the_shared_default(executed):
    """Signed-in first, signed-out second — the classic leak. The generic feed
    must still be generic."""

    async def body():
        await te.explore_async("", ["cancer", "PHGDH"])
        return await te.explore_async("")

    generic = asyncio.run(body())

    assert generic["scope"]["is_personalized"] is False
    assert generic["scope"]["topics"] == te._DEFAULT_SCOPE["topics"]


def test_the_default_feed_does_not_shadow_a_personalized_one(executed):
    """And the other order: a warm default feed (the pre-warmer guarantees one)
    must not be handed back to a user with interests."""

    async def body():
        await te.explore_async("")
        return await te.explore_async("", ["cancer", "PHGDH"])

    personalized = asyncio.run(body())

    assert personalized["scope"]["topics"] == ["cancer", "PHGDH"]
    assert len(executed) == 2


def test_identical_interest_sets_share_one_entry(executed):
    """Same terms in a different order is the same feed — it should cost one
    fan-out, not two. Nothing user-specific is in the entry, so this is safe."""

    async def body():
        await te.explore_async("", ["cancer", "PHGDH"])
        return await te.explore_async("", ["phgdh", "Cancer"])

    second = asyncio.run(body())

    assert len(executed) == 1                     # served from cache
    assert second["scope"]["topics"] == ["cancer", "PHGDH"]


def test_interests_and_the_same_words_typed_as_a_search_stay_separate(executed, no_llm):
    """'cancer PHGDH' as a SEARCH produces a different feed (extraction +
    routing) than the same two words as interests, so they must not collide."""

    async def body():
        feed = await te.explore_async("", ["cancer", "PHGDH"])
        search = await te.explore_async("cancer PHGDH")
        return feed, search

    feed, search = asyncio.run(body())

    assert len(executed) == 2
    assert feed["tools_called"] == te._DEFAULT_TOOLS
    assert search["tools_called"] == ["search_papers"]
