"""
sources/openalex.py — OpenAlex works fetcher.

Port of _reference/ts-sources/sources/openalex.ts. Same URL, same field mapping,
same blank-title drop. Two Explore-specific additions per spec:
  - `signal` is set from `cited_by_count` (metric="citations") — a REAL metric.
  - `referenced_works` is captured into `raw` (the whole work is stored, which
    includes it) for later citation-graph ranking.
"""

from __future__ import annotations

from urllib.parse import quote

import httpx

from dedupe import dedupe_key, normalize_doi
from models import Item, Signal

from .base import drop_future_dated, get_json, now_iso, to_iso


async def fetch_openalex(
    client: httpx.AsyncClient, term: str, cap: int, kind: str = "paper"
) -> list[Item]:
    """Fetch OpenAlex works (recency-sorted). `kind` tags the resulting Items —
    default "paper"; search_news reuses this exact logic with kind="news"."""
    url = (
        f"https://api.openalex.org/works?search={quote(term)}"
        f"&per-page={cap}&sort=publication_date:desc"
    )
    data = await get_json(client, url)

    items: list[Item] = []
    for w in (data or {}).get("results") or []:
        title = w.get("title")
        if not title:   # blank-title drop (TS: filter(w => w.title))
            continue

        iso_date = to_iso(w.get("publication_date") or "")

        venue = ((w.get("primary_location") or {}).get("source") or {}).get("display_name")
        authorships = w.get("authorships") or []
        authors = ", ".join(
            name
            for name in ((a.get("author") or {}).get("display_name") for a in authorships[:2])
            if name
        )
        desc_parts = [
            f"Published in {venue}." if venue else "Indexed in OpenAlex.",
            (f"{authors}{' et al.' if len(authorships) > 2 else ''}" if authors else ""),
        ]
        summary = " ".join(p for p in desc_parts if p)

        oa_id = w.get("id") or ""
        external_id = oa_id.split("/")[-1] if oa_id else "unknown"
        doi = normalize_doi(w.get("doi"))  # OpenAlex doi is a full https://doi.org/... URL
        url_val = (
            w.get("doi")
            or (w.get("primary_location") or {}).get("landing_page_url")
            or oa_id
            or "https://openalex.org"
        )

        # REAL ranking metric — only set when the source reports it. Never fabricated.
        cited = w.get("cited_by_count")
        signal = (
            Signal(metric="citations", value=float(cited), as_of=now_iso())
            if isinstance(cited, (int, float)) and not isinstance(cited, bool)
            else None
        )

        items.append(
            Item(
                id=f"openalex:{external_id}",
                kind=kind,
                title=title,
                summary=summary,
                url=url_val,
                doi=doi,
                source="openalex",
                date_iso=iso_date,
                signal=signal,
                dedupe_key=dedupe_key(url_val, title, doi),
                # raw stores the whole work, so referenced_works travels with it for
                # later citation-graph ranking.
                raw=w,
            )
        )
    return drop_future_dated(items)
