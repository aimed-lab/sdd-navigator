"""
dedupe.py — deterministic dedupe keys + first-seen-wins merge.

`dedupe_key` is a faithful port of `dedupeKey` from
_reference/ts-sources/discovery.ts. Three branches, checked in order:

    1. DOI extracted from a doi.org URL   -> "doi:<lowercased doi>"
    2. else the normalized hostname+path  -> "url:<lowercased host+path>"
    3. else the lowercased trimmed title  -> "title:<lowercased title>"

The TS uses `new URL(url)`, which THROWS on a string without a scheme/host and
falls through to the title branch. Python's urlparse never throws, so we
reproduce that behavior explicitly: the url branch is taken only when the URL has
both a scheme and a host (matching what `new URL` accepts).

Pure stdlib — no project imports — so it's trivially testable in isolation.
"""

from __future__ import annotations

import re
from typing import Iterable, TypeVar
from urllib.parse import urlparse

# JS: /doi\.org\/(.+)$/i  — matches "doi.org/<rest>" anywhere in the string.
_DOI_RE = re.compile(r"doi\.org/(.+)$", re.IGNORECASE)


def dedupe_key(url: str | None, title: str) -> str:
    """Compute the dedupe key for an item from its url + title (see module doc)."""
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
    """First-seen-wins dedupe over any objects exposing a `.dedupe_key` attribute
    (e.g. models.Item). Order is preserved; the first item for each key survives."""
    seen: set[str] = set()
    out: list[_HasKey] = []
    for item in items:
        key = item.dedupe_key
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out
