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

# CLINICAL/HEALTH-SERVICES SCOPE — an explicit, opt-in narrowing of the
# search, NOT the default. A bare keyword topic ("COPD HIV comorbidity")
# searches PubMed's title/abstract/MeSH text as free text, which cannot
# distinguish a health-services/implementation paper from a molecular
# mechanism paper that happens to share the same disease vocabulary — an
# earlier attempt at fixing this by OR-ing in free-text words like
# "intervention"/"behavioral" barely moved the result set (279 -> 204 hits
# on a live test, same top-ranked results) because PubMed's free-text
# search matches ANY indexed field, including an incidental mention deep in
# an unrelated abstract. What actually works is FIELD-RESTRICTED
# qualifiers: MeSH Major Topic ([majr], the article's INDEXED primary
# subject, not an incidental term) plus publication-type ([pt]) tags —
# verified live on the same query: 279 -> 37 hits, and the survivors read
# as genuine health-services/clinical-epidemiology work (e.g. "Survival
# analysis of COVID-19 patients...", "Lung function and atherosclerosis: a
# cross-sectional study of multimorbidity...") rather than the molecular
# pharmacology paper this scope exists to exclude.
#
# This deliberately does NOT try to also exclude bench-science papers by
# name (no "NOT gene[majr]" clause) — that's a losing game against an
# open-ended vocabulary of every possible molecular target. Requiring a
# POSITIVE clinical/health-services signal, rather than trying to blocklist
# every basic-science one, is the more robust shape of filter.
_CLINICAL_SCOPE_FILTER = (
    '("health services research"[majr] OR "health policy"[majr] OR '
    '"delivery of health care"[majr] OR "program evaluation"[majr] OR '
    '"patient care management"[majr] OR "behavior therapy"[majr] OR '
    '"randomized controlled trial"[pt] OR "comparative study"[pt] OR '
    '"observational study"[pt] OR "practice guideline"[pt] OR '
    '"clinical trial"[pt])'
)


def _api_key_param() -> str:
    """`&api_key=…` when NCBI_API_KEY is set, else "".

    Read at CALL time, not import time: server.py imports the tools before it
    calls load_dotenv(), so a module-level read would miss the .env values.
    """
    key = (os.environ.get("NCBI_API_KEY") or "").strip()
    return f"&api_key={quote(key)}" if key else ""


async def fetch_pubmed(
    client: httpx.AsyncClient,
    term: str,
    cap: int,
    since_year: int | None = None,
    clinical_scope: bool = False,
) -> list[Item]:
    auth = _api_key_param()   # applies to BOTH E-utilities calls below

    scoped_term = f"({term}) AND {_CLINICAL_SCOPE_FILTER}" if clinical_scope else term
    search_url = (
        f"{_ESEARCH}?db=pubmed&term={quote(scoped_term)}&retmax={cap}&sort=date&retmode=json{auth}"
    )
    if since_year is not None:
        # datetype=pdat scopes mindate/maxdate to publication date (not the
        # E-utilities default, entry date). maxdate is a fixed far-future cap
        # so this is a genuine "since Y" filter, not a bounded window.
        search_url += f"&datetype=pdat&mindate={since_year}/01/01&maxdate=3000/01/01"
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

        # DATE BUG FIX: `pubdate` is the PRINT/issue date, which PubMed very
        # often reports at year-only or month-only granularity for a recent
        # article (e.g. "2026", "2026 Dec") — to_iso() then defaults the
        # missing month/day to 1, so every such record collapses onto the
        # exact same "YYYY-01-01T00:00:00.000Z" instant. For a narrow,
        # currently-active topic this isn't a rare edge case: verified live
        # against a real query ("COPD HIV comorbidity"), 8 of the top 20
        # results (40%) had a coarse pubdate — enough to make a recency sort
        # look arbitrary, exactly the reported symptom.
        #
        # `epubdate` (the date the article actually went live online) is a
        # SEPARATE field ESummary already returns, and empirically carries
        # full day precision far more often — same live sample, 17/20 had a
        # full epubdate, including 6 of the 8 coarse-pubdate cases. It's not
        # always the "official" publication date (a journal's print issue
        # date can differ from when it appeared online), but for a RECENCY
        # sort it's arguably the more honest field anyway — it's when the
        # work actually became available, not the calendar date newspaper of
        # record. Falling back to `pubdate` only when `epubdate` is itself
        # absent (e.g. very old records, or a journal that doesn't report
        # one) rather than fabricating a day PubMed never gave us.
        iso_date = to_iso(rec.get("epubdate") or rec.get("pubdate") or "")
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
