"""
dedupe.py — DOI-aware dedupe keys + a deterministic cross-source merge.

`dedupe_key` is a DOI-first port of `dedupeKey` from
_reference/ts-sources/discovery.ts. Branches, checked in order:

    1. an explicit normalized DOI        -> "doi:<doi>"
    2. a DOI extracted from a doi.org URL -> "doi:<doi>"
    3. else the normalized hostname+path  -> "url:<lowercased host+path>"
    4. else the lowercased trimmed title  -> "title:<lowercased title>"

Branch 1 is what makes cross-source collapse work: PubMed (which keys on its URL
alone by default) now also exposes a DOI, so a PubMed paper and its OpenAlex /
Crossref twin share "doi:10.xxxx/yyy" and merge into one item. Branches 3–4 keep
the old fallbacks for DOI-less items (many preprints, grants).

`merge_items` collapses items that share a key by MERGING (not first-seen-drop):
it keeps the richest item but preserves the citations signal and referenced_works
from whichever source had them, and records the contributing sources in
raw["sources"]. The merge is deterministic given a stable input order.
"""

from __future__ import annotations

import re
from typing import Iterable, TypeVar
from urllib.parse import urlparse

# JS: /doi\.org\/(.+)$/i  — matches "doi.org/<rest>" anywhere in the string.
_DOI_RE = re.compile(r"doi\.org/(.+)$", re.IGNORECASE)
# Optional leading "doi:" and an optional doi.org URL prefix, each independent —
# so "doi:10.9/z", "https://doi.org/10.9/z" and a bare "10.9/z" all normalize alike.
_DOI_PREFIX = re.compile(r"^\s*(?:doi:\s*)?(?:(?:https?://)?(?:dx\.)?doi\.org/)?", re.IGNORECASE)


def normalize_doi(raw: str | None) -> str | None:
    """Normalize a DOI to its bare key form: strip any doi: / https://doi.org/
    prefix and lowercase, so '10.1234/AbC' and 'https://doi.org/10.1234/abc' both
    become '10.1234/abc'. Returns None for empty input."""
    if not raw:
        return None
    s = _DOI_PREFIX.sub("", str(raw)).strip().lower()
    return s or None


def dedupe_key(url: str | None, title: str, doi: str | None = None) -> str:
    """Compute the dedupe key for an item from its doi (preferred), url, and title."""
    ndoi = normalize_doi(doi)
    if ndoi:
        return f"doi:{ndoi}"
    if url:
        m = _DOI_RE.search(url)
        if m:
            return f"doi:{m.group(1).lower()}"
        parsed = urlparse(url)
        # `new URL(url)` in JS requires an absolute URL (scheme + host); mirror that.
        if parsed.scheme and parsed.hostname:
            pathname = parsed.path or "/"   # JS pathname is "/" (not "") for a bare host
            return f"url:{(parsed.hostname + pathname).lower()}"
    return f"title:{title.strip().lower()}"


_HasKey = TypeVar("_HasKey")


def dedupe_items(items: Iterable[_HasKey]) -> list[_HasKey]:
    """First-seen-wins dedupe over any objects exposing a `.dedupe_key` attribute.
    Order is preserved; the first item for each key survives. (Kept for callers
    that want drop semantics; search_papers uses `merge_items` instead.)"""
    seen: set[str] = set()
    out: list[_HasKey] = []
    for item in items:
        key = item.dedupe_key
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


# ── Cross-source merge ────────────────────────────────────────────────────────


def _refs_of(item) -> list | None:
    raw = getattr(item, "raw", None)
    if isinstance(raw, dict):
        refs = raw.get("referenced_works")
        if refs:  # non-empty
            return refs
    return None


def _richness(item) -> tuple[int, int, int, int]:
    """Deterministic 'how complete is this item' score used to pick the merge base.
    Prefers an item that carries a signal, then referenced_works, then a fuller
    summary, then a larger raw payload."""
    has_signal = 1 if getattr(item, "signal", None) is not None else 0
    has_refs = 1 if _refs_of(item) is not None else 0
    summary_len = len(getattr(item, "summary", None) or "")
    raw = getattr(item, "raw", None)
    raw_len = len(raw) if isinstance(raw, dict) else 0
    return (has_signal, has_refs, summary_len, raw_len)


def _merge_group(group: list) -> object:
    """Merge >1 items sharing a dedupe_key into one. Base = richest (ties -> first
    seen). Blank fields are filled from the others; the citations signal and
    referenced_works are preserved from whichever item had them; contributing
    sources are recorded (in first-seen order) in raw['sources']."""
    base = group[0]
    for item in group[1:]:
        if _richness(item) > _richness(base):
            base = item

    title = base.title
    summary = base.summary
    url = base.url
    doi = base.doi
    date_iso = base.date_iso
    signal = base.signal
    refs = _refs_of(base)

    for item in group:
        if item is base:
            continue
        if not summary and item.summary:
            summary = item.summary
        if not url and item.url:
            url = item.url
        if not doi and item.doi:
            doi = item.doi
        if not date_iso and item.date_iso:
            date_iso = item.date_iso
        if not title and item.title:
            title = item.title
        if signal is None and item.signal is not None:   # preserve any source's signal
            signal = item.signal
        if refs is None:
            refs = _refs_of(item)                          # preserve any source's referenced_works

    sources: list[str] = []
    for item in group:                                     # first-seen order, unique
        if item.source not in sources:
            sources.append(item.source)

    new_raw = dict(base.raw) if isinstance(base.raw, dict) else {}
    if refs is not None:
        new_raw["referenced_works"] = refs
    new_raw["sources"] = sources

    # base.model_copy keeps id/kind/source/dedupe_key; overlay the merged fields.
    return base.model_copy(update={
        "title": title,
        "summary": summary,
        "url": url,
        "doi": doi,
        "date_iso": date_iso,
        "signal": signal,
        "raw": new_raw,
    })


def merge_items(items: Iterable) -> list:
    """Collapse items sharing a `.dedupe_key`, merging colliding ones (see
    `_merge_group`). Single-source items pass through unchanged. Output order
    follows first appearance of each key — deterministic for a stable input."""
    order: list[str] = []
    groups: dict[str, list] = {}
    for item in items:
        key = item.dedupe_key
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(item)

    out = []
    for key in order:
        group = groups[key]
        out.append(group[0] if len(group) == 1 else _merge_group(group))
    return out
