"""
sources/openfda.py — FDA-approved drugs for a disease, from openFDA (free).

Two calls, however many drugs come back:
  1. drug/label.json — labels (NDA/BLA only) whose "indications and usage"
     mentions the disease, newest label first. De-duplicated by application
     number.
  2. drug/drugsfda.json — ONE batched lookup of every application number, for
     the approval date (the ORIG submission with status AP), sponsor and
     review priority.
Then rows are collapsed to one per BASE ingredient (generic name lowercased,
biosimilar suffix like "-adcd" stripped), keeping the application with the
EARLIEST original approval, i.e. the originator (Avastin 2004, not the 2022
biosimilar Vegzelma).

A drug with no ORIG+AP submission is dropped rather than shown without a
verifiable approval date. Approvals expose no ranking metric, so signal stays
None. OPENFDA_API_KEY is optional (it only raises the rate limit): when set it
is sent as api_key on both requests, when unset or empty nothing is sent.

openFDA answers 404 (NOT_FOUND) for a search with no matches; that is an empty
result here, not an error.
"""

from __future__ import annotations

import os
import re
from typing import Any
from urllib.parse import quote

import httpx

from dedupe import dedupe_key
from models import Item

from .base import FETCH_TIMEOUT, _log_non_2xx, _raise_for_status_redacted, filter_quality, to_iso

_LABEL = "https://api.fda.gov/drug/label.json"
_DRUGSFDA = "https://api.fda.gov/drug/drugsfda.json"
_LABEL_LIMIT = 25
_APPROVAL_URL = "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo="

_NDA_BLA_RE = re.compile(r"^(?:NDA|BLA)\d+$", re.IGNORECASE)
_BIOSIMILAR_SUFFIX_RE = re.compile(r"-[a-z]{4}$")
_POSSESSIVE_RE = re.compile(r"['’]s\b")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
# Words that say little about WHICH condition: a label's indication text varies
# ("metastatic pancreatic adenocarcinoma" for "pancreatic cancer").
_GENERIC_WORDS = {
    "cancer", "cancers", "disease", "diseases", "disorder", "tumor", "tumour", "tumors",
    "carcinoma", "neoplasm", "the", "of", "and", "in",
}
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# Dropping "cancer" from "pancreatic cancer" would let non-cancer drugs for the
# same organ through (PANCREAZE/ZENPEP treat exocrine pancreatic insufficiency).
# So when a cancer word was dropped, the label must ALSO use some cancer wording.
_CANCER_WORDS = {"cancer", "cancers", "carcinoma", "tumor", "tumour", "tumors", "neoplasm"}
_CANCER_GROUP = (
    "(cancer+OR+carcinoma+OR+adenocarcinoma+OR+tumor+OR+tumors+OR+neoplasm+OR+neoplasms"
    "+OR+malignant+OR+malignancy+OR+metastatic+OR+lymphoma+OR+leukemia+OR+sarcoma+OR+myeloma)"
)


def _indication_clause(disease: str) -> str:
    """The indications_and_usage search clause for `disease`: ALL of its
    meaningful words (AND), not the exact phrase, because a label's wording
    rarely matches the searched phrase ("pancreatic cancer" vs "metastatic
    pancreatic adenocarcinoma"). Lowercased, possessive 's removed, generic
    words (cancer, disease, ...) dropped; if nothing is left (just "cancer"),
    the original phrase is searched instead. If a cancer word was dropped, the
    cancer wording group (_CANCER_GROUP) is one more required term."""
    cleaned = _POSSESSIVE_RE.sub("", disease.lower())
    tokens = [w for w in _NON_ALNUM_RE.split(cleaned) if w]
    words = list(dict.fromkeys(w for w in tokens if w not in _GENERIC_WORDS))   # keep order
    if not words:
        return f'indications_and_usage:"{quote(disease, safe="")}"'
    required = [*words, _CANCER_GROUP] if any(w in _CANCER_WORDS for w in tokens) else words
    if len(required) == 1:
        return f"indications_and_usage:{required[0]}"
    return f"indications_and_usage:({'+AND+'.join(required)})"


def _api_key_param() -> str:
    key = os.environ.get("OPENFDA_API_KEY") or None
    return f"&api_key={quote(key.strip())}" if key and key.strip() else ""


async def _get(client: httpx.AsyncClient, url: str) -> Any:
    resp = await client.get(url, timeout=FETCH_TIMEOUT)
    if resp.status_code == 404:   # openFDA's "no matches"
        return {}
    _log_non_2xx(resp, url)
    _raise_for_status_redacted(resp, url)
    return resp.json()


def _first(values: Any) -> str | None:
    if isinstance(values, list):
        values = values[0] if values else None
    return values.strip() if isinstance(values, str) and values.strip() else None


def _approval(submissions: list[dict]) -> tuple[str, str | None] | None:
    """(YYYYMMDD, review_priority) of the original approval, or None."""
    for s in submissions or []:
        if s.get("submission_type") == "ORIG" and s.get("submission_status") == "AP":
            date = str(s.get("submission_status_date") or "")
            if re.fullmatch(r"\d{8}", date):
                return date, s.get("review_priority") or None
    return None


def _base_ingredient(generic: str) -> str:
    """"Bevacizumab-ADCD" -> "bevacizumab" (biosimilars carry a 4-letter suffix)."""
    return _BIOSIMILAR_SUFFIX_RE.sub("", generic.strip().lower())


def _pretty_date(yyyymmdd: str) -> str:
    return f"{_MONTHS[int(yyyymmdd[4:6]) - 1]} {int(yyyymmdd[6:8])}, {yyyymmdd[:4]}"


def _indication_text(label: dict) -> str | None:
    """A short 'indications and usage' text from a label already fetched, or None."""
    text = " ".join(str(x) for x in (label.get("indications_and_usage") or []) if x)
    text = re.sub(r"^\s*\d*\s*INDICATIONS?\s*(AND|&)\s*USAGE:?\s*", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    return (text[:300].rstrip() + "…") if len(text) > 300 else (text or None)


async def fetch_fda_approvals(client: httpx.AsyncClient, disease: str, cap: int) -> list[Item]:
    disease = (disease or "").replace('"', " ").strip()
    if not disease:
        return []
    key = _api_key_param()

    label_url = (
        f"{_LABEL}?limit={_LABEL_LIMIT}&sort=effective_time:desc"
        f"&search={_indication_clause(disease)}"
        "+AND+(openfda.application_number:NDA*+OR+openfda.application_number:BLA*)"
        f"{key}"
    )
    labels = ((await _get(client, label_url)) or {}).get("results") or []

    # One candidate per application number (the newest label wins that number).
    candidates: list[dict] = []
    seen_app: set[str] = set()
    for r in labels:
        of = r.get("openfda") or {}
        app = next(
            (a.strip().upper() for a in (of.get("application_number") or []) if _NDA_BLA_RE.match(a.strip())),
            None,
        )
        generic = _first(of.get("generic_name"))
        if not app or not generic or app in seen_app:
            continue
        seen_app.add(app)
        candidates.append({
            "indication": _indication_text(r),
            "app": app,
            "generic": generic.lower(),
            "brand": _first(of.get("brand_name")),
            "manufacturer": _first(of.get("manufacturer_name")),
        })
    if not candidates:
        return []

    apps = [c["app"] for c in candidates]
    fda_url = (
        f"{_DRUGSFDA}?limit={len(apps)}"
        f"&search=application_number:({'+OR+'.join(apps)})"
        f"{key}"
    )
    records = {
        (rec.get("application_number") or "").upper(): rec
        for rec in ((await _get(client, fda_url)) or {}).get("results") or []
    }

    items: list[Item] = []
    for c in candidates:
        rec = records.get(c["app"]) or {}
        approved = _approval(rec.get("submissions") or [])
        if not approved:
            continue
        date, priority = approved
        sponsor = (rec.get("sponsor_name") or "").strip() or c["manufacturer"]
        brand = c["brand"] or c["generic"]
        url = _APPROVAL_URL + re.sub(r"\D", "", c["app"])
        title = f"{brand} ({c['generic']})"
        approved_text = f"FDA approved {_pretty_date(date)}"
        items.append(
            Item(
                id=f"openfda:{c['app']}",
                kind="approval",
                title=title,
                summary=f"{sponsor} · {approved_text}" if sponsor else approved_text,
                url=url,
                doi=None,
                source="openfda",
                date_iso=to_iso(f"{date[:4]}-{date[4:6]}-{date[6:8]}"),
                signal=None,   # no ranking metric
                dedupe_key=dedupe_key(url, title),
                raw={
                    "brand": brand,
                    "generic": c["generic"],
                    "sponsor": sponsor,
                    "application_number": c["app"],
                    "approval_date": date,
                    "review_priority": priority,
                    # From the label already fetched above; no extra request.
                    "indication": c["indication"],
                },
            )
        )

    # One row per base ingredient: the earliest original approval (the originator).
    originators: dict[str, Item] = {}
    for it in items:
        ingredient = _base_ingredient(it.raw["generic"])
        kept = originators.get(ingredient)
        if kept is None or it.raw["approval_date"] < kept.raw["approval_date"]:
            originators[ingredient] = it

    rows = sorted(originators.values(), key=lambda it: it.raw["approval_date"], reverse=True)
    return filter_quality(rows)[:cap]
