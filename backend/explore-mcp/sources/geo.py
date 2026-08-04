"""
sources/geo.py — NCBI GEO (Gene Expression Omnibus) dataset fetcher.

Same E-utilities machinery as sources/pubmed.py (esearch for the id list, then
esummary for metadata), against db=gds instead of db=pubmed. GEO exposes no
ranking metric, so every Item's `signal` stays None — same as PubMed.

WHY db=gds MIXES entry types: an unrestricted `db=gds` search returns four
different record shapes under one uid space — GSE (a Series: the actual
dataset submission), GDS (a curated DataSet, NCBI's older hand-curated
subset), GPL (a Platform, i.e. an instrument/array definition — NOT a
dataset), and GSM (an individual Sample within a series — NOT a dataset
either, and the numerically largest slice of hits for a gene-symbol query,
confirmed live: a "PHGDH glioblastoma" search returned 6 GSM sample rows
out of 8 total hits). Returning GSM/GPL rows as "datasets" would be wrong —
a sample is not something a scientist can browse to. The esearch `term` is
therefore always ANDed with `(gse[Entry Type] OR gds[Entry Type])`, which
NCBI resolves server-side, so no client-side filtering or overfetching is
needed to drop samples/platforms.

Auth: same NCBI_API_KEY as pubmed.py, read the same way (call-time, not
import-time — see pubmed.py's _api_key_param docstring for why).

Fields captured per esummary gds record (verified live, 2026-08-04):
  accession, title, summary, taxon (organism), n_samples, gdstype
  (GEO's own free-text experiment-type facet — e.g. "Expression profiling by
  high throughput sequencing", "Expression profiling by array", "Genome
  binding/occupancy profiling by high throughput sequencing" for ChIP-seq —
  passed through verbatim as `experiment_type` rather than normalized into a
  fixed enum, since GEO submitters don't consistently pick from a closed
  RNA-seq/microarray/ChIP-seq/scRNA-seq set and inventing that mapping would
  misclassify records), gpl (platform accession number, without the "GPL"
  prefix), pdat (submission date, "YYYY/MM/DD"), pubmedids (linked PMIDs —
  captured in `raw` even though no caller consumes them yet, per the
  dataset-to-paper linking this fetcher exists to enable).
"""

from __future__ import annotations

import os
from urllib.parse import quote

import httpx

from dedupe import dedupe_key
from models import Item

from .base import filter_quality, get_json, to_iso

_ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
_ESUMMARY = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"

# Restrict to actual datasets (Series + curated DataSets); excludes GSM
# (individual samples) and GPL (platform/array definitions) — see module
# docstring. Appended to the caller's term with AND.
_ENTRY_TYPE_FILTER = "(gse[Entry Type] OR gds[Entry Type])"


def _api_key_param() -> str:
    """`&api_key=…` when NCBI_API_KEY is set, else "". Read at call time — see
    pubmed.py's identical helper for why (module-import-vs-load_dotenv ordering)."""
    key = (os.environ.get("NCBI_API_KEY") or "").strip()
    return f"&api_key={quote(key)}" if key else ""


def _geo_url(accession: str) -> str:
    return f"https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={accession}"


async def fetch_geo(client: httpx.AsyncClient, term: str, cap: int) -> list[Item]:
    auth = _api_key_param()   # applies to BOTH E-utilities calls below

    full_term = f"({term}) AND {_ENTRY_TYPE_FILTER}" if term.strip() else _ENTRY_TYPE_FILTER
    search_url = (
        f"{_ESEARCH}?db=gds&term={quote(full_term)}&retmax={cap}&retmode=json{auth}"
    )
    search_data = await get_json(client, search_url)
    ids = ((search_data or {}).get("esearchresult") or {}).get("idlist") or []
    if not ids:
        return []

    summary_url = f"{_ESUMMARY}?db=gds&id={','.join(ids)}&retmode=json{auth}"
    summary_data = await get_json(client, summary_url)
    result = (summary_data or {}).get("result") or {}

    items: list[Item] = []
    for uid in ids:
        rec = result.get(uid)
        if not rec:
            continue
        title = rec.get("title") or ""
        if not title.strip():   # blank-title drop, same rule as pubmed.py
            continue

        accession = rec.get("accession") or ""
        if not accession:
            continue

        entry_type = rec.get("entrytype") or ""
        if entry_type not in ("GSE", "GDS"):
            # Belt-and-suspenders: the entry-type filter is in the esearch
            # term already, but never trust an upstream filter to be the
            # only gate — a GSM/GPL slipping through must not be labeled a
            # dataset.
            continue

        organism = rec.get("taxon") or None
        n_samples = rec.get("n_samples")
        experiment_type = rec.get("gdstype") or None
        platform = rec.get("gpl") or None
        if platform:
            platform = f"GPL{platform}"
        pubmed_ids = [str(p) for p in (rec.get("pubmedids") or [])]

        # pdat comes as "YYYY/MM/DD" (confirmed live) — to_iso's ISO branch
        # needs dashes (fromisoformat rejects slashes), so normalize first
        # rather than let every GEO record silently fall back to the epoch.
        iso_date = to_iso((rec.get("pdat") or "").replace("/", "-"))
        url = _geo_url(accession)
        summary = rec.get("summary") or ""

        items.append(
            Item(
                id=f"geo:{accession}",
                kind="dataset",
                title=title,
                summary=summary,
                url=url,
                doi=None,
                source="geo",
                date_iso=iso_date,
                signal=None,  # GEO gives no ranking metric — same as PubMed
                dedupe_key=dedupe_key(url, title),
                raw={
                    "accession": accession,
                    "entry_type": entry_type,
                    "organism": organism,
                    "sample_count": n_samples,
                    "experiment_type": experiment_type,
                    "platform": platform,
                    "pubmed_ids": pubmed_ids,   # linked papers — not consumed yet
                },
            )
        )
    return filter_quality(items)
