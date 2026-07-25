"""
sources/clinical_trials.py — ClinicalTrials.gov v2 fetcher.

Port of _reference/ts-sources/sources/clinicalTrials.ts. Same URL, same field
mapping, same drop of studies with no NCT id (the TS `id !== "ct-"` filter).
Trials expose no ranking metric, so signal stays None.
"""

from __future__ import annotations

from urllib.parse import quote

import httpx

from dedupe import dedupe_key
from models import Item

from .base import drop_future_dated, get_json, to_iso


async def fetch_trials(client: httpx.AsyncClient, term: str, cap: int) -> list[Item]:
    url = (
        "https://clinicaltrials.gov/api/v2/studies"
        f"?query.term={quote(term)}&pageSize={cap}&sort=LastUpdatePostDate:desc"
    )
    data = await get_json(client, url)

    items: list[Item] = []
    for s in (data or {}).get("studies") or []:
        proto = s.get("protocolSection") or {}
        ident = proto.get("identificationModule") or {}
        status = proto.get("statusModule") or {}
        desc = proto.get("descriptionModule") or {}

        nct_id = ident.get("nctId") or ""
        if not nct_id:   # drop studies with no NCT id
            continue

        iso_date = to_iso((status.get("startDateStruct") or {}).get("date") or "")
        brief = (desc.get("briefSummary") or "")[:220]
        summary = brief or f"{status.get('overallStatus') or 'Active'} clinical trial."

        items.append(
            Item(
                id=f"clinicaltrials:{nct_id}",
                kind="trial",
                title=ident.get("briefTitle") or "Clinical Trial",
                summary=summary,
                url=f"https://clinicaltrials.gov/study/{nct_id}",
                doi=None,
                source="clinicaltrials",
                date_iso=iso_date,
                signal=None,   # no ranking metric
                dedupe_key=dedupe_key(f"https://clinicaltrials.gov/study/{nct_id}", ident.get("briefTitle") or ""),
                raw=s,
            )
        )
    return drop_future_dated(items)
