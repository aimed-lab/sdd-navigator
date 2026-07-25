"""
sources/grants_gov.py — Grants.gov search2 fetcher.

Port of _reference/ts-sources/sources/grantsGov.ts. POST search2 with the same
body, same field mapping, same drop of hits missing a title or opportunity
number. Grants.gov exposes no ranking metric, so signal stays None.
"""

from __future__ import annotations

import httpx

from dedupe import dedupe_key
from models import Item

from .base import post_json, to_iso

_SEARCH2 = "https://api.grants.gov/v1/api/search2"


async def fetch_grants(client: httpx.AsyncClient, term: str, cap: int) -> list[Item]:
    body = {"keyword": term, "oppStatuses": "forecasted|posted", "rows": cap}
    data = await post_json(client, _SEARCH2, body)

    hits = ((data or {}).get("data") or {}).get("oppHits") or []
    items: list[Item] = []
    for h in hits:
        title = h.get("title")
        number = h.get("number")
        if not title or not number:   # blank-title / missing-number drop
            continue

        opp_id = h.get("id") if h.get("id") is not None else number
        iso_date = to_iso(h.get("openDate") or h.get("postedDate") or "")
        summary = f"{h.get('agencyCode') or '?'} — {h.get('agency') or ''}".strip()
        url = (
            f"https://www.grants.gov/search-results-detail/{h['id']}"
            if h.get("id") is not None
            else "https://www.grants.gov/"
        )

        items.append(
            Item(
                id=f"grants_gov:{opp_id}",
                kind="grant",
                title=title,
                summary=summary,
                url=url,
                doi=None,
                source="grants_gov",
                date_iso=iso_date,
                signal=None,   # no ranking metric
                dedupe_key=dedupe_key(url, title),
                raw=h,
            )
        )
    return items
