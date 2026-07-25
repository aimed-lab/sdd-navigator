"""
sources/github.py — GitHub repository search fetcher.

Port of _reference/ts-sources/sources/github.ts. Same URL, same `stars:>=5`
filter, same field mapping, same blank-title drop (repos with no full_name).
GitHub reports a real popularity metric, so each Item carries a stars Signal.
"""

from __future__ import annotations

import os
from urllib.parse import quote

import httpx

from dedupe import dedupe_key
from models import Item, Signal

from .base import get_json, now_iso, to_iso


async def fetch_github(client: httpx.AsyncClient, term: str, cap: int) -> list[Item]:
    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    q = f"{term} stars:>=5"   # keep the existing minimum-stars filter
    url = (
        f"https://api.github.com/search/repositories?q={quote(q)}"
        f"&sort=stars&order=desc&per_page={cap}"
    )
    data = await get_json(client, url, headers=headers)

    items: list[Item] = []
    for r in (data or {}).get("items") or []:
        full_name = r.get("full_name")
        if not full_name:   # blank-title drop
            continue

        iso_date = to_iso(r.get("pushed_at") or "")
        html_url = r.get("html_url") or f"https://github.com/{full_name}"
        summary = r.get("description") or "Open-source tool on GitHub."

        stars = r.get("stargazers_count")
        signal = (
            Signal(metric="stars", value=float(stars), as_of=now_iso())
            if isinstance(stars, (int, float)) and not isinstance(stars, bool)
            else None
        )

        items.append(
            Item(
                id=f"github:{full_name}",
                kind="tool",
                title=full_name,
                summary=summary,
                url=html_url,
                doi=None,
                source="github",
                date_iso=iso_date,
                signal=signal,   # REAL stars metric; never fabricated
                dedupe_key=dedupe_key(html_url, full_name),
                raw=r,
            )
        )
    return items
