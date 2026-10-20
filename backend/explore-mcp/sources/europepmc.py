"""
sources/europepmc.py — Europe PMC preprint fetcher (bioRxiv, medRxiv, Research
Square, ...). Free, no API key.

`SRC:PPR` restricts the search to preprint records; `sort=P_PDATE_D desc` puts
the newest first. Preprints expose no ranking metric (no citation graph worth
trusting this early), so signal stays None.

`raw` is a small first-party dict (server, authors, doi) — response.py lists
"europepmc" in _INTERNAL_SOURCES so it reaches the frontend untrimmed.
"""

from __future__ import annotations

from urllib.parse import quote

import httpx

from dedupe import dedupe_key, normalize_doi
from models import Item

from .base import filter_quality, get_json, to_iso

_SEARCH = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"


async def fetch_preprints(client: httpx.AsyncClient, term: str, cap: int) -> list[Item]:
    query = f"{term} AND SRC:PPR"
    url = (
        f"{_SEARCH}?format=json&resultType=lite&pageSize={cap}"
        f"&sort=P_PDATE_D%20desc&query={quote(query, safe=':')}"
    )
    data = await get_json(client, url)

    items: list[Item] = []
    for r in ((data or {}).get("resultList") or {}).get("result") or []:
        title = (r.get("title") or "").strip()
        if not title:
            continue

        pid = r.get("id") or ""
        doi = normalize_doi(r.get("doi"))
        server = ((r.get("bookOrReportDetails") or {}).get("publisher") or "").strip() or None
        authors = (r.get("authorString") or "").strip() or None
        item_url = f"https://doi.org/{doi}" if doi else f"https://europepmc.org/article/PPR/{pid}"
        summary = " · ".join(p for p in (server, authors) if p) or "Preprint."

        items.append(
            Item(
                id=f"europepmc:{pid or doi}",
                kind="preprint",
                title=title,
                summary=summary,
                url=item_url,
                doi=doi,
                source="europepmc",
                date_iso=to_iso(r.get("firstPublicationDate") or ""),
                signal=None,   # no ranking metric
                dedupe_key=dedupe_key(item_url, title, doi),
                raw={"server": server, "authors": authors, "doi": doi},
            )
        )
    return filter_quality(items)
