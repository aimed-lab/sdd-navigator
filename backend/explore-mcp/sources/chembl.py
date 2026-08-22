"""
sources/chembl.py — ChEMBL bioactivity/mechanism-of-action fetcher.

GENE-ONLY, not a free-text search: the caller supplies a gene SYMBOL, which is
resolved to a `target_chembl_id` via ChEMBL's own target search
(`/target/search?q=<gene>`), and everything downstream is fetched by that
resolved id, not by keyword matching against arbitrary text. Two record kinds
come back for that target, both surfaced as `kind="compound"` items:

  MECHANISM — `/mechanism.json?target_chembl_id=...` — drug mechanism-of-action
  records: which molecule, what it does to the target (`action_type`), how far
  along it is (`max_phase`), and (when present) the specific resistance/
  sensitizing mutation the mechanism targets (`variant_sequence.mutation`,
  e.g. "G12C" for a KRAS G12C inhibitor).

  ACTIVITY — `/activity.json?target_chembl_id=...&pchembl_value__isnull=false`
  — quantified bioactivity assay results (potency, assay description). The
  `pchembl_value__isnull=false` filter is load-bearing, not cosmetic: without
  it ChEMBL also returns qualitative "Active"/"Inactive" rows with a null
  potency value, which are not useful signal and would dilute a capped result
  set — filtered server-side, not fetched-then-discarded here.

CURATION AT FETCH TIME (the thing that's bitten every source before this one):
`raw` is a curated, first-party dict of NAMED fields only —
mechanism_of_action, max_phase, action_type, mutation, pubmed_ids (from
mechanism_refs, PubMed refs only) for a mechanism item; pchembl_value,
standard_type, standard_value, standard_units, assay_description,
molecule_chembl_id for an activity item. The full ChEMBL record (which carries
many more fields no caller reads) is never stored.

NO OFF-DOMAIN / QUALITY FILTER: `filter_quality` (sources/base.py) exists for
free-text searches susceptible to keyword-collision junk (OpenAlex, news,
GEO). ChEMBL here is a RESOLVED gene-target lookup — the query is a controlled
identifier (`target_chembl_id`), not a string ChEMBL matches against
title/summary text — so there is no keyword-collision failure mode to guard
against, and `filter_quality`/`drop_future_dated` are not applied. (Mechanism
records don't carry a date at all; activity records carry only a
`document_year`, which is a publication year, not a "when did this happen"
date that could be a bogus future placeholder.)

CAP: `cap` is split across the two record kinds (half mechanism, half
activity, at least 1 each) so a single gene with a huge mechanism table
doesn't starve activity results or vice versa; the combined list is then
truncated to `cap` total, same contract as every other fetcher's `cap` param.
"""

from __future__ import annotations

from urllib.parse import quote

import httpx

from dedupe import dedupe_key
from models import Item

from .base import get_json, to_iso

_TARGET_SEARCH = "https://www.ebi.ac.uk/chembl/api/data/target/search"
_MECHANISM = "https://www.ebi.ac.uk/chembl/api/data/mechanism.json"
_ACTIVITY = "https://www.ebi.ac.uk/chembl/api/data/activity.json"


def _molecule_url(molecule_chembl_id: str) -> str:
    return f"https://www.ebi.ac.uk/chembl/explore/compound/{molecule_chembl_id}"


async def _resolve_target(client: httpx.AsyncClient, gene_symbol: str) -> str | None:
    """Gene symbol -> target_chembl_id via ChEMBL's target search. Zero-match
    (unknown gene, ChEMBL has no target record for it) returns None — handled
    by the caller as an empty result, same pattern as every other source's
    empty-result handling."""
    url = f"{_TARGET_SEARCH}?q={quote(gene_symbol)}&format=json"
    data = await get_json(client, url)
    targets = (data or {}).get("targets") or []
    if not targets:
        return None
    target_id = targets[0].get("target_chembl_id")
    return target_id or None


def _pubmed_refs(mechanism_refs: list[dict]) -> list[str]:
    return [
        str(ref.get("ref_id"))
        for ref in (mechanism_refs or [])
        if (ref.get("ref_type") or "").upper() == "PUBMED" and ref.get("ref_id")
    ]


async def _fetch_mechanisms(client: httpx.AsyncClient, target_chembl_id: str, cap: int) -> list[Item]:
    url = f"{_MECHANISM}?target_chembl_id={quote(target_chembl_id)}&format=json&limit={cap}"
    data = await get_json(client, url)

    items: list[Item] = []
    for i, m in enumerate((data or {}).get("mechanisms") or []):
        molecule_id = m.get("molecule_chembl_id") or ""
        if not molecule_id:
            continue
        action_type = m.get("action_type") or None
        moa = m.get("mechanism_of_action") or None
        mutation = ((m.get("variant_sequence") or {}) or {}).get("mutation") or None

        title = f"{molecule_id} — {action_type or 'mechanism of action'}"
        summary = moa or f"Mechanism-of-action record for {molecule_id}."
        url_out = _molecule_url(molecule_id)

        items.append(
            Item(
                id=f"chembl:mechanism:{molecule_id}:{i}",
                kind="compound",
                title=title,
                summary=summary,
                url=url_out,
                doi=None,
                source="chembl",
                date_iso=None,
                signal=None,   # no ranking metric — ChEMBL records don't cite each other
                dedupe_key=dedupe_key(url_out, title),
                raw={
                    "molecule_chembl_id": molecule_id,
                    "mechanism_of_action": moa,
                    "max_phase": m.get("max_phase"),
                    "action_type": action_type,
                    "mutation": mutation,
                    "pubmed_ids": _pubmed_refs(m.get("mechanism_refs") or []),
                },
            )
        )
    return items


async def _fetch_activities(client: httpx.AsyncClient, target_chembl_id: str, cap: int) -> list[Item]:
    url = (
        f"{_ACTIVITY}?target_chembl_id={quote(target_chembl_id)}"
        f"&pchembl_value__isnull=false&format=json&limit={cap}"
    )
    data = await get_json(client, url)

    items: list[Item] = []
    for i, a in enumerate((data or {}).get("activities") or []):
        molecule_id = a.get("molecule_chembl_id") or ""
        if not molecule_id:
            continue
        standard_type = a.get("standard_type") or None
        assay_desc = (a.get("assay_description") or "")[:220] or None
        pchembl_value = a.get("pchembl_value")

        title = f"{molecule_id} bioactivity" + (f" ({standard_type})" if standard_type else "")
        summary = assay_desc or f"Bioactivity record for {molecule_id}."
        url_out = _molecule_url(molecule_id)
        document_year = a.get("document_year")
        iso_date = to_iso(str(document_year)) if document_year else None

        items.append(
            Item(
                id=f"chembl:activity:{molecule_id}:{i}",
                kind="compound",
                title=title,
                summary=summary,
                url=url_out,
                doi=None,
                source="chembl",
                date_iso=iso_date,
                signal=None,
                dedupe_key=dedupe_key(url_out, title),
                raw={
                    "molecule_chembl_id": molecule_id,
                    "pchembl_value": pchembl_value,
                    "standard_type": standard_type,
                    "standard_value": a.get("standard_value"),
                    "standard_units": a.get("standard_units"),
                    "assay_description": assay_desc,
                },
            )
        )
    return items


async def fetch_chembl(client: httpx.AsyncClient, gene_symbol: str, cap: int) -> list[Item]:
    """Resolve `gene_symbol` to a ChEMBL target, then fetch mechanism-of-action
    and quantified bioactivity records for it. Returns up to `cap` Items
    (kind="compound", source="chembl"), curated `raw` per record kind — see
    module docstring. Empty gene_symbol or a target ChEMBL has no record for
    both return [] gracefully, same as the other sources' empty-result
    handling."""
    gene_symbol = (gene_symbol or "").strip()
    if not gene_symbol:
        return []

    target_chembl_id = await _resolve_target(client, gene_symbol)
    if not target_chembl_id:
        return []

    mech_cap = max(1, cap // 2)
    act_cap = max(1, cap - mech_cap)

    mechanisms = await _fetch_mechanisms(client, target_chembl_id, mech_cap)
    activities = await _fetch_activities(client, target_chembl_id, act_cap)

    return (mechanisms + activities)[:cap]
