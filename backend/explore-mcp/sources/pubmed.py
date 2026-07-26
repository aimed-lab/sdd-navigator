"""
sources/pubmed.py — PubMed E-utilities fetcher.

Port of _reference/ts-sources/sources/pubmed.ts. Two-step: esearch for the id
list, then esummary for metadata. Same URLs, same field mapping, same blank-title
drop. PubMed exposes no ranking metric, so every Item's `signal` stays None.

Auth: NCBI_API_KEY (optional) is appended as `api_key` to both E-utilities
calls, raising the shared rate limit from 3 req/sec to 10 req/sec. Unset ->
unauthenticated requests, which still work (at the lower limit).
"""

from __future__ import annotations

import os
from urllib.parse import quote

import httpx

from dedupe import dedupe_key, normalize_doi
from models import Item

from .base import filter_quality, get_json, to_iso


def _extract_doi(rec: dict) -> str | None:
    """PubMed esummary exposes the DOI in the `articleids` array (idtype 'doi'),
    with `elocationid` as a fallback. Returns the normalized DOI, or None."""
    for aid in rec.get("articleids") or []:
        if (aid.get("idtype") or "").lower() == "doi":
            doi = normalize_doi(aid.get("value"))
            if doi and doi.startswith("10."):
                return doi
    doi = normalize_doi(rec.get("elocationid"))
    return doi if doi and doi.startswith("10.") else None

_ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
_ESUMMARY = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"


def _api_key_param() -> str:
    """`&api_key=…` when NCBI_API_KEY is set, else "".

    Read at CALL time, not import time: server.py imports the tools before it
    calls load_dotenv(), so a module-level read would miss the .env values.
    """
    key = (os.environ.get("NCBI_API_KEY") or "").strip()
    return f"&api_key={quote(key)}" if key else ""


async def fetch_pubmed(client: httpx.AsyncClient, term: str, cap: int) -> list[Item]:
    auth = _api_key_param()   # applies to BOTH E-utilities calls below

    search_url = (
        f"{_ESEARCH}?db=pubmed&term={quote(term)}&retmax={cap}&sort=date&retmode=json{auth}"
    )
    search_data = await get_json(client, search_url)
    ids = ((search_data or {}).get("esearchresult") or {}).get("idlist") or []
    if not ids:
        return []

    summary_url = f"{_ESUMMARY}?db=pubmed&id={','.join(ids)}&retmode=json{auth}"
    summary_data = await get_json(client, summary_url)
    result = (summary_data or {}).get("result") or {}

    items: list[Item] = []
    for pmid in ids:
        rec = result.get(pmid)
        if not rec:
            continue
        title = rec.get("title") or ""
        if not title.strip():   # blank-title drop (TS: trimmed length > 0)
            continue

        iso_date = to_iso(rec.get("pubdate") or "")
        authors = rec.get("authors") or []
        author_str = ", ".join(a.get("name", "") for a in authors[:2])
        if len(authors) > 2:
            author_str += " et al."

        url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
        summary = f"Published in {rec.get('source') or 'Unknown Journal'}. {author_str}".strip()
        doi = _extract_doi(rec)  # enables cross-source collapse with OpenAlex/Crossref

        items.append(
            Item(
                id=f"pubmed:{pmid}",
                kind="paper",
                title=title,
                summary=summary,
                url=url,
                doi=doi,
                source="pubmed",
                date_iso=iso_date,
                signal=None,  # PubMed gives no ranking metric
                dedupe_key=dedupe_key(url, title, doi),
                raw=rec,
            )
        )
    return filter_quality(items)
