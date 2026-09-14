"""
sources/grants_gov.py — Grants.gov search2 fetcher.

Port of _reference/ts-sources/sources/grantsGov.ts. POST search2 with the same
body, same field mapping, same drop of hits missing a title or opportunity
number. Grants.gov exposes no ranking metric, so signal stays None.
"""

from __future__ import annotations

import re

import httpx

from dedupe import dedupe_key
from models import Item

from .base import filter_quality, post_json, to_iso

_SEARCH2 = "https://api.grants.gov/v1/api/search2"

# CAREER-STAGE / ACTIVITY-CODE SCOPE. Confirmed live against the search2
# API's own `searchParams` echo: grants.gov exposes `eligibilities` (who may
# APPLY — individuals, non-profits, state governments...) and
# `fundingInstruments`/`fundingCategories`/`agencies`, but NOTHING for an
# NIH-style ACTIVITY CODE (K99/R00/K23/K01 vs. R01/U01/R21) — that
# vocabulary is NIH-internal, not part of grants.gov's own cross-agency
# schema, so there is no request parameter to send for it. The one place an
# activity code reliably shows up is inside the opportunity TITLE, in
# parentheses (e.g. "Science Track Award for Research Transition (START)
# Program (R03, Clinical Trial Optional)") — so this is a POST-FETCH
# content filter, not a request parameter, same reasoning as any other
# "the API doesn't expose a structured field for this" case.
_NIH_ACTIVITY_CODE_RE = re.compile(r"\b([A-Z]\d{2})\b")


def _title_activity_codes(title: str) -> set[str]:
    return set(_NIH_ACTIVITY_CODE_RE.findall(title.upper()))


async def fetch_grants(
    client: httpx.AsyncClient,
    term: str,
    cap: int,
    activity_codes: tuple[str, ...] | None = None,
) -> list[Item]:
    body = {"keyword": term, "oppStatuses": "forecasted|posted", "rows": cap}
    data = await post_json(client, _SEARCH2, body)

    hits = ((data or {}).get("data") or {}).get("oppHits") or []
    allowed = {c.upper() for c in activity_codes} if activity_codes else None

    items: list[Item] = []
    for h in hits:
        title = h.get("title")
        number = h.get("number")
        if not title or not number:   # blank-title / missing-number drop
            continue

        if allowed is not None:
            # Drop only when the title POSITIVELY names a mechanism and NONE
            # of the named ones are allowed (e.g. a title says "(R01, R21)"
            # while the caller wants K99/K23/K01 — that opportunity really
            # isn't open to this audience). A title naming NO mechanism at
            # all — most grants.gov titles, including notices, foundation-
            # adjacent announcements, and non-NIH agencies — is left in
            # rather than guessed at; the point is to remove opportunities
            # we can POSITIVELY identify as wrong-stage, not to require
            # every result prove itself right-stage against a vocabulary
            # that's NIH-specific to begin with.
            codes = _title_activity_codes(title)
            if codes and codes.isdisjoint(allowed):
                continue

        opp_id = h.get("id") if h.get("id") is not None else number
        iso_date = to_iso(h.get("openDate") or h.get("postedDate") or "")
        summary = f"{h.get('agencyCode') or '?'} — {h.get('agency') or ''}".strip()
        url = (
            f"https://www.grants.gov/search-results-detail/{h['id']}"
            if h.get("id") is not None
            else "https://www.grants.gov/"
        )

        items.append(
            Item(
                id=f"grants_gov:{opp_id}",
                kind="grant",
                title=title,
                summary=summary,
                url=url,
                doi=None,
                source="grants_gov",
                date_iso=iso_date,
                signal=None,   # no ranking metric
                dedupe_key=dedupe_key(url, title),
                raw=h,
            )
        )
    # filter_quality applies the off-domain guard; grants are exempt from the
    # future-date drop (forecasted awards are legitimately future-dated) and from
    # the biomed-anchor requirement (curated funding, not recency-sorted literature).
    return filter_quality(items)
