"""
test_future_date — the FUTURE_DATE_TOLERANCE filter (port of discovery.ts #2).

Confirms: >60-day-future dates dropped for non-grant kinds; grants exempt;
missing/unparseable/past dates pass through.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sources.base import drop_future_dated, is_future_dated  # noqa: E402
from models import Item  # noqa: E402


def _iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


_NOW = datetime.now(timezone.utc)
_FAR_FUTURE = _iso(_NOW + timedelta(days=365))     # ~1 year ahead
_SOON = _iso(_NOW + timedelta(days=30))            # within tolerance
_PAST = _iso(_NOW - timedelta(days=100))


def _item(kind, date_iso):
    return Item(id=f"{kind}:x", kind=kind, title="t", source="s",
                date_iso=date_iso, dedupe_key=f"{kind}:x", raw={})


def test_is_future_dated_boundaries():
    assert is_future_dated(_FAR_FUTURE) is True
    assert is_future_dated(_SOON) is False          # 30d < 60d tolerance
    assert is_future_dated(_PAST) is False
    assert is_future_dated(None) is False           # missing -> not future
    assert is_future_dated("not-a-date") is False   # unparseable -> not future
    assert is_future_dated("1970-01-01T00:00:00.000Z") is False


def test_drop_future_dated_filters_nongrant_kinds():
    items = [
        _item("news", _FAR_FUTURE),   # dropped
        _item("paper", _FAR_FUTURE),  # dropped
        _item("trial", _FAR_FUTURE),  # dropped
        _item("tool", _FAR_FUTURE),   # dropped
        _item("news", _SOON),         # kept (within tolerance)
        _item("paper", _PAST),        # kept
        _item("episode", None),       # kept (no date)
    ]
    out = drop_future_dated(items)
    kept = [(it.kind, it.date_iso) for it in out]
    assert (_item("news", _SOON).kind, _SOON) in kept
    assert all(not (it.date_iso == _FAR_FUTURE and it.kind != "grant") for it in out)
    assert len(out) == 3  # news(_SOON), paper(_PAST), episode(None)


def test_grants_are_exempt():
    # A far-future GRANT is legitimate (forecasted) and must survive.
    items = [_item("grant", _FAR_FUTURE), _item("paper", _FAR_FUTURE)]
    out = drop_future_dated(items)
    assert [it.kind for it in out] == ["grant"]


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
