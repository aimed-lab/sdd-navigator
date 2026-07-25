"""
sources/base.py — shared helpers for the source fetchers.

Port of _reference/ts-sources/sources/shared.ts: the per-request fetch timeout
and the two date helpers (`to_iso`, `fmt_date`). Bodies match the TS behavior.

FETCH_TIMEOUT is 8 (seconds) — the TS used AbortSignal.timeout(8000).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import httpx

FETCH_TIMEOUT = 8  # seconds — matches the TS FETCH_TIMEOUT_MS = 8000

_EPOCH_ISO = "1970-01-01T00:00:00.000Z"
_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

# PubMed-style "2024 Oct" / "2024 Oct 15"
_PUBMED_DATE_RE = re.compile(r"(\d{4})\s+([A-Za-z]{3})(?:\s+(\d{1,2}))?")


def _iso(dt: datetime) -> str:
    """Render a UTC datetime the way JS Date.toISOString() does ('….000Z')."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _try_parse(date_str: str) -> datetime | None:
    """Best-effort parse of the formats the sources actually emit:
    ISO dates/datetimes ('2024-10-15', full ISO) and bare years ('2024').
    Returns None when nothing matches (caller then tries the PubMed regex)."""
    s = date_str.strip()
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    if re.fullmatch(r"\d{4}", s):   # year only — JS new Date('2024') is valid (UTC Jan 1)
        return datetime(int(s), 1, 1, tzinfo=timezone.utc)
    return None


def to_iso(date_str: str | None) -> str:
    """Port of toISO(): parse a source date to a UTC ISO string, falling back to
    the epoch when unparseable. Handles ISO dates and PubMed 'YYYY Mon [DD]'."""
    if not date_str:
        return _EPOCH_ISO
    d = _try_parse(date_str)
    if d is not None:
        return _iso(d)
    m = _PUBMED_DATE_RE.search(date_str)
    if m:
        month = _MONTHS.get(m.group(2).lower())
        if month:
            day = int(m.group(3)) if m.group(3) else 1
            try:
                return _iso(datetime(int(m.group(1)), month, day, tzinfo=timezone.utc))
            except ValueError:
                pass
    return _EPOCH_ISO


def fmt_date(iso_str: str) -> str:
    """Port of fmtDate(): human 'Mon D, YYYY', or 'Recent' when invalid / pre-2000."""
    try:
        d = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return "Recent"
    if d.year < 2000:
        return "Recent"
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def now_iso() -> str:
    """Current instant as a UTC ISO string — used for Signal.as_of (observation time)."""
    return _iso(datetime.now(timezone.utc))


# ── Future-date quality filter (port of discovery.ts passesQualityFilter #2) ──

FUTURE_DATE_TOLERANCE_DAYS = 60  # discovery.ts: FUTURE_DATE_TOLERANCE_MS = 60 * 86_400_000


def is_future_dated(date_iso: str | None, *, now: datetime | None = None) -> bool:
    """True iff `date_iso` is a VALID date more than 60 days ahead of now — a bogus
    placeholder date. Missing or unparseable dates return False (a missing date is
    not a future date), matching the TS `!isNaN(t) && t - Date.now() > tol` guard."""
    if not date_iso:
        return False
    try:
        d = datetime.fromisoformat(date_iso.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return False
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    return (d - now).total_seconds() > FUTURE_DATE_TOLERANCE_DAYS * 86_400


def drop_future_dated(items: list) -> list:
    """Drop Items whose date_iso is >60 days in the future (bogus placeholder dates
    from the sources). GRANTS ARE EXEMPT — Grants.gov forecasted opportunities are
    legitimately future-dated (discovery.ts exempts type "grant"). Items with no /
    unparseable date pass through. Applied in every source fetcher's normalization
    (a future date is wrong everywhere; it's just most visible in recency-sorted
    news)."""
    now = datetime.now(timezone.utc)
    return [
        it for it in items
        if getattr(it, "kind", None) == "grant" or not is_future_dated(getattr(it, "date_iso", None), now=now)
    ]


async def get_json(client: httpx.AsyncClient, url: str, headers: dict | None = None) -> Any:
    """GET `url` with the shared timeout and raise on non-2xx (mirrors the TS
    `if (!res.ok) throw`). Returns the parsed JSON body. Optional per-request
    headers (only passed through when set, to stay compatible with simple fakes)."""
    kwargs: dict[str, Any] = {"timeout": FETCH_TIMEOUT}
    if headers:
        kwargs["headers"] = headers
    resp = await client.get(url, **kwargs)
    resp.raise_for_status()
    return resp.json()


async def post_json(
    client: httpx.AsyncClient, url: str, json_body: Any, headers: dict | None = None
) -> Any:
    """POST `json_body` to `url` with the shared timeout and raise on non-2xx."""
    kwargs: dict[str, Any] = {"timeout": FETCH_TIMEOUT, "json": json_body}
    if headers:
        kwargs["headers"] = headers
    resp = await client.post(url, **kwargs)
    resp.raise_for_status()
    return resp.json()
