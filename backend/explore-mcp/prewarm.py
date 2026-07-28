"""
prewarm.py — keep the landing feed permanently warm, off the startup path.

The blank-input landing feed is what every first-time visitor hits. Cold, it
costs ~9s and a fan-out across six upstream APIs. This runs explore("") on
server startup and then on an interval SHORTER than the feed's fresh TTL
(10 min), so the entry never ages out of `fresh` and no user ever pays for the
cold path — or triggers the upstream fan-out themselves.

Runs on the SERVER'S event loop (wired through the Starlette lifespan in
server.py), which matters: the cache's per-key asyncio.Locks bind to the loop
that creates them, so pre-warming from a separate thread/loop would break
single-flight.

LIVENESS vs READINESS. The server used to AWAIT the first warm before ASGI
startup completed, which meant /health was unreachable for ~9s (unbounded, if
an upstream was slow) — long enough for an orchestrator's liveness probe to
kill and restart the container, forever. That's fixed by splitting the two
questions:
  * liveness (/health in server.py) — "is the process up" — never touches
    this module at all, so it's always instant.
  * readiness (`is_ready()` / `ready_info()` below, exposed as /ready) —
    "has the first warm finished" — starts False, flips to True once the
    FIRST warm attempt (bounded by PREWARM_TIMEOUT_SEC) finishes, whether it
    succeeded, failed, or timed out. See _first_warm_and_ready for why
    "finishes" always wins over "succeeds".
The warm itself now runs as a background task kicked off from start(), which
returns immediately — startup no longer waits on it.

Config:
  PREWARM_ENABLED       "1"/"true"/"yes" (default on). Set to 0 to disable
                        locally so a dev server doesn't hit upstream on boot.
                        When disabled, the service is marked ready immediately
                        (nothing to wait for).
  PREWARM_INTERVAL_SEC  seconds between refreshes (default 480 = 8 min, inside
                        the 10-minute fresh window).
  PREWARM_TIMEOUT_SEC   max seconds any single warm attempt may run before
                        it's treated as failed (default 20s — comfortably
                        above the ~9s observed cold cost, but bounded: this
                        used to be unbounded).
"""

from __future__ import annotations

import asyncio
import logging
import os
import time

from cache import TTL_DEFAULT_FEED

logger = logging.getLogger(__name__)

_DEFAULT_INTERVAL = 8 * 60     # 8 min — comfortably inside TTL_DEFAULT_FEED (10 min)
_DEFAULT_WARM_TIMEOUT = 20.0   # seconds — generous over the ~9s observed cold cost

_task: asyncio.Task | None = None
_state: dict = {"runs": 0, "failures": 0, "timeouts": 0, "last_ok": None, "last_error": None}

# Readiness — separate from _task/_state above, and from liveness entirely.
_ready = False
_warm_started_at: float | None = None   # monotonic seconds; set when the FIRST warm begins


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


def warm_timeout_seconds() -> float:
    raw = (os.environ.get("PREWARM_TIMEOUT_SEC") or "").strip()
    try:
        value = float(raw) if raw else _DEFAULT_WARM_TIMEOUT
    except ValueError:
        value = _DEFAULT_WARM_TIMEOUT
    return value if value > 0 else _DEFAULT_WARM_TIMEOUT


def is_ready() -> bool:
    return _ready


async def _warm_once() -> None:
    # Imported lazily: tools.explore pulls in the whole tool graph, and this
    # module is imported by server.py before load_dotenv() has run.
    from tools.explore import explore_async

    logger.info("prewarm: warm started")
    started = time.perf_counter()
    try:
        await explore_async("")          # blank input == the landing feed
        duration = round(time.perf_counter() - started, 3)
        _state["runs"] += 1
        _state["last_ok"] = time.time()
        _state["last_seconds"] = duration
        logger.info("prewarm: warm completed in %.3fs", duration)
    except Exception as exc:            # never let a warm failure kill the loop
        _state["failures"] += 1
        _state["last_error"] = f"{type(exc).__name__}: {exc}"
        logger.warning(
            "prewarm: warm failed after %.3fs: %s",
            time.perf_counter() - started, _state["last_error"],
        )


async def _warm_once_bounded() -> None:
    """_warm_once(), but no single attempt may run forever.

    Was unbounded — a hung upstream (not erroring, just never returning)
    used to be able to wedge a warm attempt indefinitely. PREWARM_TIMEOUT_SEC
    bounds every attempt, first warm and recurring refreshes alike."""
    timeout = warm_timeout_seconds()
    try:
        await asyncio.wait_for(_warm_once(), timeout=timeout)
    except asyncio.TimeoutError:
        _state["failures"] += 1
        _state["timeouts"] += 1
        _state["last_error"] = f"TimeoutError: warm exceeded {timeout}s"
        logger.warning("prewarm: warm timed out after %.1fs", timeout)


async def _first_warm_and_ready() -> None:
    """Run the bounded first warm, then mark the service ready NO MATTER WHAT.

    IMPORTANT, do not "fix" this to only mark ready on success. Availability
    beats warmth: a service that never becomes ready because one upstream API
    was down (or slow) at boot is WORSE than one that starts serving a cold
    cache. If we gated readiness on warm succeeding, a single flaky upstream
    at deploy time would keep this container out of rotation forever (every
    orchestrator restarts a container that never turns ready, and the retry
    hits the same down upstream, forever). Ready-regardless is the point.
    """
    global _ready, _warm_started_at
    _warm_started_at = time.monotonic()
    try:
        await _warm_once_bounded()
    finally:
        _ready = True
        logger.info(
            "prewarm: service marked READY (warm_ok=%s, failures=%d)",
            _state.get("last_ok") is not None, _state["failures"],
        )


async def _loop_after_first() -> None:
    """The recurring half — the first warm already ran in _first_warm_and_ready."""
    while True:
        try:
            await asyncio.sleep(interval_seconds())
        except asyncio.CancelledError:
            raise
        await _warm_once_bounded()


async def _run() -> None:
    await _first_warm_and_ready()
    await _loop_after_first()


async def start() -> None:
    """Kick off the pre-warm and return immediately — startup never blocks on it.

    Liveness (/health) has never depended on this module; readiness (/ready)
    now starts False and flips True once the first warm attempt finishes (see
    _first_warm_and_ready). Called from the lifespan hook in server.py, but
    unlike before, awaiting this call no longer means awaiting a warm feed —
    it only means the background task has been scheduled.
    """
    global _task, _ready
    if not enabled():
        _state["last_error"] = "disabled via PREWARM_ENABLED"
        _ready = True     # nothing to wait for — ready immediately
        logger.info("prewarm: disabled via PREWARM_ENABLED; service marked READY immediately")
        return
    if _task is not None and not _task.done():
        return

    _ready = False
    _task = asyncio.create_task(_run())


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
        "timeout_seconds": warm_timeout_seconds(),
        "running": _task is not None and not _task.done(),
        "ready": _ready,
        **_state,
    }


def ready_info() -> dict:
    """Body for /ready: enough to diagnose a stuck deploy from the endpoint
    alone — whether a warm actually ran (as opposed to being skipped via
    PREWARM_ENABLED=false), and (while still warming) how long the first
    attempt has been running."""
    running_for = None
    if _warm_started_at is not None and not _ready:
        running_for = round(time.monotonic() - _warm_started_at, 3)
    return {
        "ready": _ready,
        "warm_attempted": _state["runs"] > 0 or _state["failures"] > 0,
        "running_for_seconds": running_for,
        "timeout_seconds": warm_timeout_seconds(),
        **_state,
    }
