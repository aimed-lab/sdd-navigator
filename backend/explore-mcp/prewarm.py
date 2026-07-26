"""
prewarm.py — keep the landing feed permanently warm.

The blank-input landing feed is what every first-time visitor hits. Cold, it
costs ~9s and a fan-out across six upstream APIs. This runs explore("") on
server startup and then on an interval SHORTER than the feed's fresh TTL
(10 min), so the entry never ages out of `fresh` and no user ever pays for the
cold path — or triggers the upstream fan-out themselves.

Runs on the SERVER'S event loop (wired through the Starlette lifespan in
server.py), which matters: the cache's per-key asyncio.Locks bind to the loop
that creates them, so pre-warming from a separate thread/loop would break
single-flight.

Config:
  PREWARM_ENABLED       "1"/"true"/"yes" (default on). Set to 0 to disable
                        locally so a dev server doesn't hit upstream on boot.
  PREWARM_INTERVAL_SEC  seconds between refreshes (default 480 = 8 min, inside
                        the 10-minute fresh window).
"""

from __future__ import annotations

import asyncio
import os
import time

from cache import TTL_DEFAULT_FEED

_DEFAULT_INTERVAL = 8 * 60   # 8 min — comfortably inside TTL_DEFAULT_FEED (10 min)

_task: asyncio.Task | None = None
_state: dict = {"runs": 0, "failures": 0, "last_ok": None, "last_error": None}


def _flag(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def enabled() -> bool:
    return _flag("PREWARM_ENABLED", True)


def interval_seconds() -> float:
    raw = (os.environ.get("PREWARM_INTERVAL_SEC") or "").strip()
    try:
        value = float(raw) if raw else _DEFAULT_INTERVAL
    except ValueError:
        value = _DEFAULT_INTERVAL
    if value <= 0:
        value = _DEFAULT_INTERVAL
    # A refresh slower than the fresh TTL would let the feed go stale between
    # runs, which defeats the point — clamp and carry on rather than fail.
    return min(value, TTL_DEFAULT_FEED * 0.9)


async def _warm_once() -> None:
    # Imported lazily: tools.explore pulls in the whole tool graph, and this
    # module is imported by server.py before load_dotenv() has run.
    from tools.explore import explore_async

    started = time.perf_counter()
    try:
        await explore_async("")          # blank input == the landing feed
        _state["runs"] += 1
        _state["last_ok"] = time.time()
        _state["last_seconds"] = round(time.perf_counter() - started, 3)
    except Exception as exc:            # never let a warm failure kill the loop
        _state["failures"] += 1
        _state["last_error"] = f"{type(exc).__name__}: {exc}"


async def _loop() -> None:
    while True:
        await _warm_once()
        try:
            await asyncio.sleep(interval_seconds())
        except asyncio.CancelledError:
            raise


async def start() -> None:
    """Populate the cache now, then keep it warm. Called from the lifespan hook.

    The FIRST warm is awaited, so by the time the server accepts traffic the
    landing feed is already a cache hit — that's the property being promised,
    and it can't be guaranteed if the first run is merely scheduled.
    """
    global _task
    if not enabled():
        _state["last_error"] = "disabled via PREWARM_ENABLED"
        return
    if _task is not None and not _task.done():
        return

    await _warm_once()                   # block startup until the feed is warm
    _task = asyncio.create_task(_loop_after_first())


async def _loop_after_first() -> None:
    """The recurring half — the first warm already ran in start()."""
    while True:
        try:
            await asyncio.sleep(interval_seconds())
        except asyncio.CancelledError:
            raise
        await _warm_once()


async def stop() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except (asyncio.CancelledError, Exception):
        pass
    _task = None


def status() -> dict:
    return {
        "enabled": enabled(),
        "interval_seconds": interval_seconds() if enabled() else None,
        "running": _task is not None and not _task.done(),
        **_state,
    }
