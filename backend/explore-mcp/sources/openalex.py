"""
sources/openalex.py — OpenAlex works fetcher.

Port of _reference/ts-sources/sources/openalex.ts. Same URL, same field mapping,
same blank-title drop. Two Explore-specific additions per spec:
  - `signal` is set from `cited_by_count` (metric="citations") — a REAL metric.
  - `referenced_works` is captured into `raw` (the whole work is stored, which
    includes it) for later citation-graph ranking.
"""

from __future__ import annotations

import os
from urllib.parse import quote

import httpx

from dedupe import dedupe_key, normalize_doi
from models import Item, Signal

from .base import filter_quality, get_json, now_iso, to_iso


def _mailto_param() -> str:
    """`&mailto=…` when OPENALEX_EMAIL is set, else "".

    This is OpenAlex's "polite pool": identified traffic gets faster, more
    consistent service and is far less likely to be throttled. Unset -> the
    common pool, which still works.

    Read at CALL time, not import time: server.py imports the tools before it
    calls load_dotenv(), so a module-level read would miss the .env values.
    """
    email = (os.environ.get("OPENALEX_EMAIL") or "").strip()
    return f"&mailto={quote(email)}" if email else ""


# OpenAlex sort for recency-first callers (search_news). Kept as the DEFAULT so
# this function's existing behaviour is unchanged for anyone not passing `sort`.
SORT_RECENT = "publication_date:desc"

# OpenAlex's own relevance ranking is what you get by OMITTING `sort` on a
# `search=` query — there is no "sort=relevance" value. Passing None selects it.
SORT_RELEVANCE = None


async def fetch_openalex(
    client: httpx.AsyncClient,
    term: str,
    cap: int,
    kind: str = "paper",
    sort: str | None = SORT_RECENT,
) -> list[Item]:
    """Fetch OpenAlex works. `kind` tags the resulting Items — default "paper";
    search_news reuses this exact logic with kind="news".

    `sort` selects the OpenAlex ordering:
      * SORT_RECENT (default) — newest first. search_news's contract.
      * SORT_RELEVANCE (None) — OpenAlex relevance; omits the sort param. Used by
        search_papers, because relevance returns a topic's important papers, and
        those actually cite ONE ANOTHER — a recency-sorted set has essentially no
        intra-set citations, so the WINNER graph comes back empty.
    """
    url = f"https://api.openalex.org/works?search={quote(term)}&per-page={cap}"
    if sort:
        url += f"&sort={sort}"
    url += _mailto_param()
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
    return filter_quality(items)
