"""
sources/clinical_trials.py — ClinicalTrials.gov v2 fetcher.

Port of _reference/ts-sources/sources/clinicalTrials.ts. Same URL, same field
mapping, same drop of studies with no NCT id (the TS `id !== "ct-"` filter).
Trials expose no ranking metric, so signal stays None.

FIELDS — the v2 API already returns the full study record for every request
(no `fields=` param is sent), so nothing extra is fetched; the earlier version
of this file just never named the extra fields it was throwing away. `raw` is
now a curated, first-party dict of everything the prior-art brief generator
(tools/prior_art_brief.py) needs — overallStatus, whyStopped (quoted verbatim,
never paraphrased, by the brief generator), phase, interventions, sponsor,
completionDate, enrollment, and whether results were posted — same pattern as
GEO/pager's `raw` (see response.py's module docstring): a handful of small
first-party fields with nowhere else to live, not a 150+-key blob like
OpenAlex's. The full study record is NOT kept in `raw` — nothing reads it and
keeping the whole ~5-15KB record per trial in the cache/response would be pure
waste once the fields actually used are named explicitly.

STATUS FILTER — `status_filter`, when given, is sent as `filter.overallStatus`
(comma-joined for multiple values, e.g. "TERMINATED,WITHDRAWN"), confirmed live
against the v2 API to filter server-side, not fetched-then-discarded client-side.
"""

from __future__ import annotations

from urllib.parse import quote

import httpx

from dedupe import dedupe_key
from models import Item

from .base import filter_quality, get_json, to_iso


def _interventions(arms_module: dict) -> list[dict]:
    out = []
    for iv in (arms_module.get("interventions") or []):
        out.append({"type": iv.get("type"), "name": iv.get("name")})
    return out


async def fetch_trials(
    client: httpx.AsyncClient, term: str, cap: int, status_filter: list[str] | None = None
) -> list[Item]:
    url = (
        "https://clinicaltrials.gov/api/v2/studies"
        f"?query.term={quote(term)}&pageSize={cap}&sort=LastUpdatePostDate:desc"
    )
    if status_filter:
        url += f"&filter.overallStatus={quote(','.join(status_filter))}"
    data = await get_json(client, url)

    items: list[Item] = []
    for s in (data or {}).get("studies") or []:
        proto = s.get("protocolSection") or {}
        ident = proto.get("identificationModule") or {}
        status = proto.get("statusModule") or {}
        desc = proto.get("descriptionModule") or {}
        design = proto.get("designModule") or {}
        arms = proto.get("armsInterventionsModule") or {}
        sponsors = proto.get("sponsorCollaboratorsModule") or {}

        nct_id = ident.get("nctId") or ""
        if not nct_id:   # drop studies with no NCT id
            continue

        iso_date = to_iso((status.get("startDateStruct") or {}).get("date") or "")
        brief = (desc.get("briefSummary") or "")[:220]
        overall_status = status.get("overallStatus") or None
        summary = brief or f"{overall_status or 'Active'} clinical trial."

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
                raw={
                    "nct_id": nct_id,
                    "overall_status": overall_status,
                    # Quoted, never paraphrased — see tools/prior_art_brief.py.
                    "why_stopped": status.get("whyStopped") or None,
                    "phase": (design.get("phases") or [None])[0],
                    "interventions": _interventions(arms),
                    "lead_sponsor": (sponsors.get("leadSponsor") or {}).get("name"),
                    "completion_date": (status.get("completionDateStruct") or {}).get("date"),
                    "enrollment": (design.get("enrollmentInfo") or {}).get("count"),
                    "results_posted": bool(status.get("resultsFirstPostDateStruct")),
                },
            )
        )
    return filter_quality(items)
