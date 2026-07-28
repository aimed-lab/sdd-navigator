"""
cache.py — async cache with single-flight and stale-while-revalidate.

Three behaviours, and the middle one is the point:

  FRESH  (age < ttl)                -> return cached value, no upstream call.
  STALE  (ttl <= age < stale_ttl)   -> return the cached value IMMEDIATELY and
                                       kick off ONE background refresh. The user
                                       never waits on upstream, and upstream
                                       never sees a burst.
  MISS   (absent, or age >= stale_ttl) -> compute. SINGLE-FLIGHT: if N requests
                                       hit the same missing key at once, exactly
                                       ONE runs compute_fn; the other N-1 await
                                       that same result.

Single-flight is load-bearing, not a nicety. GitHub's SEARCH bucket — which
search_tools draws on — is 30 requests per MINUTE authenticated (measured; the
familiar 5000/hr figure is the CORE bucket and does not apply). Without
single-flight, one cold-cache burst of 20 identical concurrent requests would
consume two thirds of a minute's entire budget on one query.

REDIS SWAP POINT
────────────────
`Cache` is the abstract interface; `InProcessCache` is the single-instance
implementation. To move to Redis, subclass `Cache` and implement `_load` /
`_store` against Redis — `get_or_compute` itself needs no change, because all
the fresh/stale/miss policy lives there and only the storage primitives are
abstract. Callers depend on `Cache`, never on `InProcessCache`, so swapping is
a one-line change at the module-level singleton at the bottom of this file.

Note for the Redis implementation: the single-flight lock here is per-process
(asyncio). With multiple instances behind Redis you'd want a short-lived
distributed lock (SET NX PX) so single-flight holds across processes too; with
one instance, the asyncio lock is exactly right.
"""

from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Iterable

logger = logging.getLogger(__name__)


# ── key normalization ─────────────────────────────────────────────────────────
#
# Port of the cache-key pattern from _reference/ts-sources/discovery.ts:211
#     const cacheKey = activeTerms.map(t => t.toLowerCase()).sort().join("|");
# Lowercase each term, sort, join with "|" — so "EGFR glioblastoma" and
# "glioblastoma egfr" are the same cache entry.


def normalize_key(namespace: str, terms: str | Iterable[str]) -> str:
    """Build a normalized cache key: lowercased, whitespace-split, sorted terms.

    `namespace` keeps different callers apart ("papers", "explore", "scope", …)
    so two tools asking the same question never collide.
    """
    if isinstance(terms, str):
        parts: list[str] = terms.split()
    else:
        parts = [p for term in terms for p in str(term).split()]
    normalized = sorted(p.lower() for p in parts if p.strip())
    return f"{namespace}:{'|'.join(normalized)}"


# ── entry ─────────────────────────────────────────────────────────────────────


@dataclass
class _Entry:
    value: Any
    stored_at: float          # monotonic seconds — immune to wall-clock jumps
    ttl: float
    stale_ttl: float

    def age(self, now: float) -> float:
        return now - self.stored_at

    def is_fresh(self, now: float) -> bool:
        return self.age(now) < self.ttl

    def is_usable(self, now: float) -> bool:
        """Fresh OR stale-but-servable. Past this, the entry is a MISS."""
        return self.age(now) < self.stale_ttl


@dataclass
class CacheStats:
    hits: int = 0            # served fresh
    stale_hits: int = 0      # served stale, refresh scheduled
    misses: int = 0          # computed inline
    coalesced: int = 0       # waited on another caller's in-flight compute
    refreshes: int = 0       # background revalidations started
    errors: int = 0          # compute_fn raised

    def as_dict(self) -> dict:
        return {
            "hits": self.hits,
            "stale_hits": self.stale_hits,
            "misses": self.misses,
            "coalesced": self.coalesced,
            "refreshes": self.refreshes,
            "errors": self.errors,
            "upstream_calls": self.misses + self.refreshes,
        }


# ── interface ─────────────────────────────────────────────────────────────────


class Cache(ABC):
    """Storage-agnostic cache. Policy lives in get_or_compute; subclasses only
    provide the two storage primitives (see REDIS SWAP POINT above)."""

    def __init__(self) -> None:
        self.stats = CacheStats()
        # One lock per key — the single-flight primitive. Held only around the
        # compute, never around a cache read.
        self._locks: dict[str, asyncio.Lock] = {}
        # Background refresh tasks, kept referenced so they aren't GC'd mid-flight.
        self._refreshes: set[asyncio.Task] = set()
        # Keys with a refresh SCHEDULED OR RUNNING. Distinct from the lock:
        # asyncio.create_task does not start the coroutine until the loop yields,
        # so a burst of stale readers would all see an unlocked lock and each
        # schedule a refresh. This set is claimed synchronously at schedule time,
        # which is what actually collapses the burst to one upstream call.
        self._refreshing: set[str] = set()

    @abstractmethod
    async def _load(self, key: str) -> _Entry | None: ...

    @abstractmethod
    async def _store(self, key: str, entry: _Entry) -> None: ...

    @abstractmethod
    async def clear(self) -> None: ...

    def _lock_for(self, key: str) -> asyncio.Lock:
        lock = self._locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[key] = lock
        return lock

    async def get_or_compute(
        self,
        key: str,
        compute_fn: Callable[[], Awaitable[Any]],
        ttl_seconds: float,
        stale_ttl_seconds: float | None = None,
    ) -> Any:
        """Return the cached value, serving stale + revalidating when possible,
        and collapsing concurrent misses into a single compute."""
        stale_ttl = stale_ttl_seconds if stale_ttl_seconds is not None else ttl_seconds
        now = time.monotonic()

        entry = await self._load(key)

        # FRESH — no upstream call.
        if entry is not None and entry.is_fresh(now):
            self.stats.hits += 1
            logger.debug("cache hit (fresh): key=%r", key)
            return entry.value

        # STALE — serve immediately, revalidate in the background.
        if entry is not None and entry.is_usable(now):
            self.stats.stale_hits += 1
            logger.debug("cache hit (stale, revalidating): key=%r", key)
            self._schedule_refresh(key, compute_fn, ttl_seconds, stale_ttl)
            return entry.value

        # MISS — single-flight. The first caller computes; the rest wait on the
        # same lock and then find the value already stored.
        lock = self._lock_for(key)
        if lock.locked():
            self.stats.coalesced += 1
            logger.debug("cache miss, coalescing onto in-flight compute: key=%r", key)

        async with lock:
            # Re-check under the lock: whoever held it before us may have just
            # stored a value, in which case we must NOT compute again.
            now = time.monotonic()
            entry = await self._load(key)
            if entry is not None and entry.is_usable(now):
                return entry.value

            self.stats.misses += 1
            logger.debug("cache miss, computing: key=%r", key)
            try:
                value = await compute_fn()
            except Exception:
                self.stats.errors += 1
                # A failed compute must not poison the key. If we still hold a
                # stale value, serve it rather than propagating the failure.
                logger.exception("cache compute_fn failed: key=%r", key)
                if entry is not None:
                    return entry.value
                raise

            await self._store(
                key, _Entry(value=value, stored_at=time.monotonic(),
                            ttl=ttl_seconds, stale_ttl=stale_ttl)
            )
            return value

    def _schedule_refresh(
        self,
        key: str,
        compute_fn: Callable[[], Awaitable[Any]],
        ttl: float,
        stale_ttl: float,
    ) -> None:
        """Start ONE background revalidation for `key`.

        This function is deliberately SYNCHRONOUS: the check-and-claim on
        `_refreshing` happens with no await in between, so it is atomic with
        respect to the event loop. That is what makes a burst of concurrent
        stale reads produce exactly one upstream call.
        """
        if key in self._refreshing:
            return
        lock = self._lock_for(key)
        if lock.locked():        # a miss-path compute is already running
            return
        self._refreshing.add(key)

        async def _refresh() -> None:
            try:
                async with lock:
                    try:
                        value = await compute_fn()
                    except Exception:
                        # Keep serving the stale value; it stays usable until
                        # stale_ttl, and the next request retries.
                        self.stats.errors += 1
                        logger.exception("background cache refresh failed: key=%r", key)
                        return
                    await self._store(
                        key, _Entry(value=value, stored_at=time.monotonic(),
                                    ttl=ttl, stale_ttl=stale_ttl)
                    )
            finally:
                self._refreshing.discard(key)

        self.stats.refreshes += 1
        task = asyncio.create_task(_refresh())
        self._refreshes.add(task)
        task.add_done_callback(self._refreshes.discard)

    async def drain(self) -> None:
        """Await any in-flight background refreshes. For tests and shutdown."""
        while self._refreshes:
            await asyncio.gather(*list(self._refreshes), return_exceptions=True)


class InProcessCache(Cache):
    """Single-instance, in-memory implementation. Correct for one backend
    process; see REDIS SWAP POINT for going multi-instance."""

    def __init__(self) -> None:
        super().__init__()
        self._data: dict[str, _Entry] = {}

    async def _load(self, key: str) -> _Entry | None:
        return self._data.get(key)

    async def _store(self, key: str, entry: _Entry) -> None:
        self._data[key] = entry

    async def clear(self) -> None:
        self._data.clear()
        self._locks.clear()
        self._refreshing.clear()
        self.stats = CacheStats()

    def __len__(self) -> int:
        return len(self._data)


# ── TTL policy ────────────────────────────────────────────────────────────────
#
# Fresh = how long we serve without any upstream call.
# Stale = how long past that we still serve instantly while revalidating behind.

# Default landing feed (blank input) — hit by every visitor, so it must stay warm.
TTL_DEFAULT_FEED = 10 * 60
STALE_DEFAULT_FEED = 30 * 60

# A specific topic search — the same query from different users should be cheap.
TTL_TOPIC = 60 * 60
STALE_TOPIC = 3 * 60 * 60

# Per-source tool results.
TTL_SOURCE = 30 * 60
STALE_SOURCE = 2 * 60 * 60

# search_tools (GitHub) gets a LONGER fresh window: star counts barely move, and
# the real constraint is a 30-req/MINUTE search bucket, not freshness.
TTL_TOOLS = 60 * 60
STALE_TOOLS = 3 * 60 * 60

# Groq scope extraction / routing — deterministic for a given input (temperature
# 0), so identical searches should never re-hit the LLM.
TTL_LLM = 24 * 60 * 60
STALE_LLM = 48 * 60 * 60


# ── module singleton ──────────────────────────────────────────────────────────
# Swap this one line for `RedisCache(...)` to go multi-instance; no caller changes.
cache: Cache = InProcessCache()
