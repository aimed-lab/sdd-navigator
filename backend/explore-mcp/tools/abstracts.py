"""
tools/abstracts.py — fill in real abstracts for page candidates that only have
a metadata blurb ("Published in <journal>. <authors>"), before page_notes'
80-character filter runs.

NOTHING EXISTING FETCHES ABSTRACTS: sources/pubmed.py uses esearch+esummary
(no abstract field) and sources/openalex.py doesn't select
abstract_inverted_index. So the fetch + parse here is new, built on the
existing helpers: sources.base.FETCH_TIMEOUT's _raise_for_status_redacted (key
redaction in errors), sources.pubmed._api_key_param / sources.openalex.
_api_key_param (NCBI_API_KEY / OPENALEX_API_KEY auth), and sources.base.
get_json for the OpenAlex JSON call. PubMed efetch returns XML, which get_json
can't parse, so that one call uses client.get directly.

BEST-EFFORT: every failure is swallowed and logged; enrich_abstracts() never
raises, so a page build can't fail because of this step.
"""

from __future__ import annotations

import asyncio
import logging
import re
import xml.etree.ElementTree as ET
from urllib.parse import quote

import httpx

from sources.base import _raise_for_status_redacted, get_json
from sources.openalex import _api_key_param as _openalex_key
from sources.pubmed import _api_key_param as _ncbi_key

logger = logging.getLogger(__name__)

ENRICH_LIMIT = 40
ENRICH_TIMEOUT = 10.0  # seconds, per call
MIN_ABSTRACT_CHARS = 80

_EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
_OPENALEX_WORKS = "https://api.openalex.org/works"

# Papers from PubMed/OpenAlex/Crossref carry a synthesized "Published in <venue>.
# <authors>" blurb as `summary` (can exceed 80 chars). Other kinds' synthesized
# fallbacks ("Active clinical trial.", "... record for CHEMBL1") are short
# enough for the length check alone.
_PLACEHOLDER_PREFIXES = ("published in ", "indexed in ")


def has_abstract(item: dict) -> bool:
    """True when item['summary'] is real descriptive text, not a metadata
    placeholder, and long enough to support a claim."""
    s = (item.get("summary") or "").strip()
    if len(s) < MIN_ABSTRACT_CHARS:
        return False
    low = s.lower()
    return not (low.startswith(_PLACEHOLDER_PREFIXES) and item.get("kind") == "paper")


def _pmid(item: dict) -> str | None:
    iid = item.get("id") or ""
    return iid.split(":", 1)[1] if iid.startswith("pubmed:") else None


def _oa_id(item: dict) -> str | None:
    iid = item.get("id") or ""
    return iid.split(":", 1)[1] if iid.startswith("openalex:") else None


def rebuild_inverted_index(inv: dict | None) -> str:
    """OpenAlex abstract_inverted_index {word: [positions]} -> plain text."""
    if not isinstance(inv, dict) or not inv:
        return ""
    slots: dict[int, str] = {}
    for word, positions in inv.items():
        for p in positions or []:
            if isinstance(p, int):
                slots[p] = word
    return " ".join(slots[i] for i in sorted(slots))


def parse_efetch(xml_text: str) -> dict[str, str]:
    """PubMed efetch XML -> {pmid: abstract text} (labelled sections joined)."""
    out: dict[str, str] = {}
    root = ET.fromstring(xml_text)
    for art in root.iter("PubmedArticle"):
        pmid = art.findtext("./MedlineCitation/PMID")
        parts = []
        for at in art.findall(".//Abstract/AbstractText"):
            text = "".join(at.itertext()).strip()
            if not text:
                continue
            label = at.get("Label")
            parts.append(f"{label}: {text}" if label else text)
        if pmid and parts:
            out[pmid.strip()] = " ".join(parts)
    return out


async def _efetch(client: httpx.AsyncClient, pmids: list[str]) -> dict[str, str]:
    url = f"{_EFETCH}?db=pubmed&id={','.join(pmids)}&retmode=xml{_ncbi_key()}"
    resp = await client.get(url, timeout=ENRICH_TIMEOUT)
    _raise_for_status_redacted(resp, url)
    return parse_efetch(resp.text)


async def _openalex(client: httpx.AsyncClient, field: str, values: list[str]) -> dict[str, str]:
    """One batched works call: filter=<field>:v1|v2|..., select id + abstract
    only. Returns {lookup key: abstract}. Key is the W-id tail for field
    'openalex', the normalized DOI for field 'doi'."""
    url = (
        f"{_OPENALEX_WORKS}?filter={field}:{'|'.join(quote(v, safe='') for v in values)}"
        f"&per-page={len(values)}&select=id,doi,abstract_inverted_index{_openalex_key()}"
    )
    # get_json uses the shared 8s timeout, inside the 10s budget.
    data = await asyncio.wait_for(get_json(client, url), timeout=ENRICH_TIMEOUT)
    out: dict[str, str] = {}
    for w in (data or {}).get("results") or []:
        text = rebuild_inverted_index(w.get("abstract_inverted_index"))
        if not text:
            continue
        if field == "openalex":
            out[(w.get("id") or "").split("/")[-1]] = text
        else:
            doi = (w.get("doi") or "").replace("https://doi.org/", "").lower()
            out[doi] = text
    return out


async def enrich_abstracts(candidates: list[dict]) -> dict:
    """Mutates `candidates` in place: for the first ENRICH_LIMIT candidates
    (already in ranking order) with no real abstract, fetch one from PubMed
    (items with a PMID) or OpenAlex (OpenAlex id, else DOI) and set `summary`.

    Returns stats {before, after, attempted, filled, errors}. Never raises."""
    stats = {"before": sum(1 for c in candidates if has_abstract(c)), "after": 0,
             "attempted": 0, "filled": 0, "errors": []}
    try:
        todo = [c for c in candidates if not has_abstract(c)][:ENRICH_LIMIT]
        stats["attempted"] = len(todo)

        pm = {c_id: c for c in todo if (c_id := _pmid(c))}
        oa = {c_id: c for c in todo if not _pmid(c) and (c_id := _oa_id(c))}
        doi = {c["doi"].lower(): c for c in todo if not _pmid(c) and not _oa_id(c) and c.get("doi")}

        async with httpx.AsyncClient() as client:
            jobs = []
            if pm:
                jobs.append(("pubmed", pm, _efetch(client, list(pm))))
            if oa:
                jobs.append(("openalex", oa, _openalex(client, "openalex", list(oa))))
            if doi:
                jobs.append(("doi", doi, _openalex(client, "doi", list(doi))))
            results = await asyncio.gather(*(j[2] for j in jobs), return_exceptions=True)

        for (name, group, _), res in zip(jobs, results):
            if isinstance(res, BaseException):
                logger.warning("abstract enrichment (%s) failed: %s", name, res)
                stats["errors"].append(f"{name}: {type(res).__name__}")
                continue
            for key, text in res.items():
                item = group.get(key)
                if item is not None and len(text) >= MIN_ABSTRACT_CHARS:
                    item["summary"] = text
                    stats["filled"] += 1
    except Exception as e:  # never fail a page build over this
        logger.exception("abstract enrichment failed")
        stats["errors"].append(f"unexpected: {type(e).__name__}")
    stats["after"] = sum(1 for c in candidates if has_abstract(c))
    return stats
