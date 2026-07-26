"""
tests/test_prewarm.py — landing-feed pre-warm config + loop behaviour.

The live "first request is a cache hit" property is verified against the running
server; these cover the config surface and the failure/cancel paths.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

import prewarm  # noqa: E402
from cache import TTL_DEFAULT_FEED  # noqa: E402


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for var in ("PREWARM_ENABLED", "PREWARM_INTERVAL_SEC"):
        monkeypatch.delenv(var, raising=False)
    yield
    asyncio.run(prewarm.stop())


def test_enabled_by_default():
    assert prewarm.enabled() is True


@pytest.mark.parametrize("value,expected", [
    ("0", False), ("false", False), ("no", False), ("off", False),
    ("1", True), ("true", True), ("yes", True), ("ON", True),
    ("", True),           # blank -> default
])
def test_enabled_flag_parsing(monkeypatch, value, expected):
    monkeypatch.setenv("PREWARM_ENABLED", value)
    assert prewarm.enabled() is expected


def test_default_interval_is_inside_the_fresh_ttl():
    """A refresh slower than the fresh window lets the feed go stale — the whole
    point is that it never does."""
    assert prewarm.interval_seconds() < TTL_DEFAULT_FEED


def test_interval_is_configurable(monkeypatch):
    monkeypatch.setenv("PREWARM_INTERVAL_SEC", "120")
    assert prewarm.interval_seconds() == 120


def test_oversized_interval_is_clamped_below_the_ttl(monkeypatch):
    monkeypatch.setenv("PREWARM_INTERVAL_SEC", "99999")
    assert prewarm.interval_seconds() <= TTL_DEFAULT_FEED * 0.9


@pytest.mark.parametrize("bad", ["abc", "-5", "0"])
def test_invalid_interval_falls_back_to_the_default(monkeypatch, bad):
    monkeypatch.setenv("PREWARM_INTERVAL_SEC", bad)
    assert prewarm.interval_seconds() == min(8 * 60, TTL_DEFAULT_FEED * 0.9)


def test_disabled_start_is_a_no_op(monkeypatch):
    monkeypatch.setenv("PREWARM_ENABLED", "0")
    calls = 0

    async def body():
        nonlocal calls
        await prewarm.start()

    asyncio.run(body())
    assert prewarm.status()["running"] is False
    assert calls == 0


def test_start_awaits_the_first_warm(monkeypatch):
    """Startup must BLOCK on the first warm — otherwise the very first request
    can still race ahead of it and pay the cold path."""
    order: list[str] = []

    async def fake_warm():
        await asyncio.sleep(0.02)
        order.append("warmed")

    monkeypatch.setattr(prewarm, "_warm_once", fake_warm)
    monkeypatch.setenv("PREWARM_INTERVAL_SEC", "3600")

    async def body():
        await prewarm.start()
        order.append("start returned")
        await prewarm.stop()

    asyncio.run(body())
    assert order == ["warmed", "start returned"]


def test_warm_failure_is_recorded_and_does_not_raise(monkeypatch):
    async def boom(_input_text):
        raise RuntimeError("upstream down")

    async def body():
        # _warm_once imports explore_async lazily from the module, so patch it there
        import tools.explore as te
        monkeypatch.setattr(te, "explore_async", boom)
        await prewarm._warm_once()   # must NOT raise

    asyncio.run(body())
    st = prewarm.status()
    assert st["failures"] >= 1
    assert "upstream down" in (st["last_error"] or "")


def test_stop_cancels_the_loop(monkeypatch):
    async def fast_warm():
        return None

    monkeypatch.setattr(prewarm, "_warm_once", fast_warm)
    monkeypatch.setenv("PREWARM_INTERVAL_SEC", "3600")

    async def body():
        await prewarm.start()
        assert prewarm.status()["running"] is True
        await prewarm.stop()
        assert prewarm.status()["running"] is False

    asyncio.run(body())
