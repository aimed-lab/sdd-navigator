"""
tests/test_cache.py — single-flight, stale-while-revalidate, TTL expiry.

The single-flight test is the important one: it is what stands between a cold
cache and a burst of upstream calls (GitHub's search bucket is 30 req/MINUTE).

Async bodies run via asyncio.run() inside sync test functions, matching the
convention in the other test modules here (no pytest-asyncio dependency).
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from cache import Cache, InProcessCache, normalize_key  # noqa: E402


# ── key normalization ─────────────────────────────────────────────────────────


def test_key_is_order_and_case_insensitive():
    a = normalize_key("papers", "EGFR glioblastoma")
    b = normalize_key("papers", "glioblastoma egfr")
    assert a == b == "papers:egfr|glioblastoma"


def test_namespace_keeps_callers_apart():
    assert normalize_key("papers", "egfr") != normalize_key("trials", "egfr")


def test_key_accepts_a_term_list_and_flattens_it():
    assert normalize_key("x", ["EGFR glioblastoma", "TP53"]) == "x:egfr|glioblastoma|tp53"


def test_blank_terms_are_dropped():
    assert normalize_key("x", "  ") == "x:"


# ── single-flight ─────────────────────────────────────────────────────────────


def test_single_flight_20_concurrent_misses_compute_once():
    """THE critical test: 20 concurrent requests for the same missing key must
    produce exactly ONE upstream call."""
    async def body():
        c = InProcessCache()
        calls = 0

        async def compute():
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.05)      # a real upstream call takes time
            return "computed"

        results = await asyncio.gather(*[
            c.get_or_compute("k", compute, ttl_seconds=60) for _ in range(20)
        ])

        assert calls == 1, f"compute_fn ran {calls} times, expected exactly 1"
        assert results == ["computed"] * 20, "not every caller got the value"
        assert c.stats.misses == 1
        assert c.stats.coalesced == 19, "19 callers should have waited on the first"
        assert c.stats.as_dict()["upstream_calls"] == 1

    asyncio.run(body())


def test_single_flight_is_per_key_not_global():
    """Different keys must still run concurrently — the lock must not serialise
    unrelated work."""
    async def body():
        c = InProcessCache()
        calls: list[str] = []

        def make(name):
            async def _fn():
                calls.append(name)
                await asyncio.sleep(0.05)
                return name
            return _fn

        out = await asyncio.gather(*[
            c.get_or_compute(f"k{i}", make(f"k{i}"), ttl_seconds=60) for i in range(5)
        ])

        assert sorted(out) == ["k0", "k1", "k2", "k3", "k4"]
        assert len(calls) == 5, "each distinct key should compute once"

    asyncio.run(body())


def test_fresh_hit_does_not_call_upstream():
    async def body():
        c = InProcessCache()
        calls = 0

        async def compute():
            nonlocal calls
            calls += 1
            return calls

        assert await c.get_or_compute("k", compute, ttl_seconds=60) == 1
        assert await c.get_or_compute("k", compute, ttl_seconds=60) == 1
        assert await c.get_or_compute("k", compute, ttl_seconds=60) == 1
        assert calls == 1
        assert c.stats.hits == 2 and c.stats.misses == 1

    asyncio.run(body())


# ── stale-while-revalidate ────────────────────────────────────────────────────


def test_stale_returns_immediately_and_schedules_a_refresh():
    async def body():
        c = InProcessCache()
        calls = 0

        async def compute():
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.05)
            return f"v{calls}"

        # Populate, then let it go stale (fresh 0.05s, usable to 10s).
        assert await c.get_or_compute("k", compute, 0.05, 10) == "v1"
        await asyncio.sleep(0.08)

        # The stale read must return the OLD value without waiting for upstream.
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        value = await c.get_or_compute("k", compute, 0.05, 10)
        elapsed = loop.time() - t0

        assert value == "v1", "stale read should serve the old value"
        assert elapsed < 0.03, f"stale read waited {elapsed:.3f}s on upstream"
        assert c.stats.stale_hits == 1
        assert c.stats.refreshes == 1

        # The background refresh then replaces the value.
        await c.drain()
        assert calls == 2
        assert await c.get_or_compute("k", compute, 60, 120) == "v2"

    asyncio.run(body())


def test_concurrent_stale_reads_schedule_only_one_refresh():
    """A burst against a stale key must not become a burst upstream."""
    async def body():
        c = InProcessCache()
        calls = 0

        async def compute():
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.05)
            return calls

        await c.get_or_compute("k", compute, 0.05, 10)   # calls == 1
        await asyncio.sleep(0.08)

        out = await asyncio.gather(*[
            c.get_or_compute("k", compute, 0.05, 10) for _ in range(10)
        ])
        assert out == [1] * 10, "all stale readers should get the old value"
        await c.drain()
        assert calls == 2, f"expected 1 background refresh, got {calls - 1}"

    asyncio.run(body())


# ── TTL expiry ────────────────────────────────────────────────────────────────


def test_past_stale_ttl_is_a_miss_and_recomputes_inline():
    async def body():
        c = InProcessCache()
        calls = 0

        async def compute():
            nonlocal calls
            calls += 1
            return f"v{calls}"

        assert await c.get_or_compute("k", compute, 0.02, 0.05) == "v1"
        await asyncio.sleep(0.08)          # past stale_ttl -> hard miss
        assert await c.get_or_compute("k", compute, 0.02, 0.05) == "v2"
        assert calls == 2
        assert c.stats.misses == 2 and c.stats.stale_hits == 0

    asyncio.run(body())


def test_stale_ttl_defaults_to_ttl_when_omitted():
    """Without a stale window, expiry is a plain miss — no stale serving."""
    async def body():
        c = InProcessCache()
        calls = 0

        async def compute():
            nonlocal calls
            calls += 1
            return calls

        await c.get_or_compute("k", compute, ttl_seconds=0.02)
        await asyncio.sleep(0.05)
        await c.get_or_compute("k", compute, ttl_seconds=0.02)
        assert calls == 2
        assert c.stats.stale_hits == 0

    asyncio.run(body())


# ── failure handling ──────────────────────────────────────────────────────────


def test_compute_failure_on_a_cold_key_propagates():
    async def body():
        c = InProcessCache()

        async def boom():
            raise RuntimeError("upstream down")

        with pytest.raises(RuntimeError):
            await c.get_or_compute("k", boom, ttl_seconds=60)
        assert c.stats.errors == 1

    asyncio.run(body())


def test_failed_refresh_keeps_serving_the_stale_value():
    """An upstream outage must not empty the cache."""
    async def body():
        c = InProcessCache()
        ok = True

        async def compute():
            if not ok:
                raise RuntimeError("upstream down")
            return "good"

        assert await c.get_or_compute("k", compute, 0.02, 10) == "good"
        ok = False
        await asyncio.sleep(0.05)

        assert await c.get_or_compute("k", compute, 0.02, 10) == "good"
        await c.drain()
        # still served from the stale entry; the refresh failed silently
        assert await c.get_or_compute("k", compute, 0.02, 10) == "good"

    asyncio.run(body())


# ── interface shape ───────────────────────────────────────────────────────────


def test_inprocess_is_a_cache_so_redis_can_swap_in():
    assert issubclass(InProcessCache, Cache)
    # policy lives on the base class; only storage is abstract
    for primitive in ("_load", "_store", "clear"):
        assert getattr(Cache, primitive).__isabstractmethod__
    assert not getattr(Cache.get_or_compute, "__isabstractmethod__", False)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS  {fn.__name__}")
        except AssertionError as exc:
            failures += 1
            print(f"FAIL  {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failures}/{len(fns)} passed")
    sys.exit(1 if failures else 0)
