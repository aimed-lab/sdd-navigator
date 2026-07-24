"""
Tests for dedupe.dedupe_key (all three branches) and dedupe_items (first-seen-wins).

Runnable two ways:
    python -m pytest backend/explore-mcp/tests/test_dedupe.py
    python backend/explore-mcp/tests/test_dedupe.py      # no pytest needed
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass

# Make the explore-mcp package root importable whether run via pytest or directly.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dedupe import dedupe_key, dedupe_items  # noqa: E402


# ── Branch 1: DOI extracted from a doi.org URL ───────────────────────────────


def test_doi_branch_basic():
    assert dedupe_key("https://doi.org/10.1234/abc.def", "Title") == "doi:10.1234/abc.def"


def test_doi_branch_is_lowercased():
    assert dedupe_key("https://doi.org/10.1234/AbC.DEF", "Title") == "doi:10.1234/abc.def"


def test_doi_branch_matches_dx_and_wins_over_url():
    # doi.org appears mid-URL (dx.doi.org) — DOI branch still wins over the url branch.
    assert dedupe_key("https://dx.doi.org/10.5/XY", "Title") == "doi:10.5/xy"


# ── Branch 2: normalized hostname + path (absolute URL, no DOI) ──────────────


def test_url_branch_host_and_path():
    assert (
        dedupe_key("https://pubmed.ncbi.nlm.nih.gov/12345/", "Title")
        == "url:pubmed.ncbi.nlm.nih.gov/12345/"
    )


def test_url_branch_lowercases_and_drops_query():
    # Query string is excluded (JS uses hostname + pathname only); host+path lowercased.
    assert dedupe_key("https://Example.COM/Path/To?q=1", "Title") == "url:example.com/path/to"


def test_url_branch_bare_host_gets_root_path():
    assert dedupe_key("https://openalex.org", "Title") == "url:openalex.org/"


# ── Branch 3: fallback to lowercased trimmed title ───────────────────────────


def test_title_branch_when_url_missing():
    assert dedupe_key("", "  Hello World  ") == "title:hello world"
    assert dedupe_key(None, "Hello World") == "title:hello world"


def test_title_branch_when_url_not_absolute():
    # No scheme/host -> `new URL` would throw -> title branch.
    assert dedupe_key("not-a-url/path", "Fallback Title") == "title:fallback title"


# ── dedupe_items: first-seen-wins ────────────────────────────────────────────


@dataclass
class _Stub:
    dedupe_key: str
    tag: str


def test_dedupe_items_first_seen_wins_and_preserves_order():
    items = [
        _Stub("doi:10.1/a", "first"),
        _Stub("url:x.com/y", "second"),
        _Stub("doi:10.1/a", "duplicate-should-be-dropped"),
        _Stub("title:z", "third"),
    ]
    out = dedupe_items(items)
    assert [s.tag for s in out] == ["first", "second", "third"]
    # the surviving doi item is the FIRST one, not the later duplicate
    assert out[0].tag == "first"


# ── Direct-run harness (no pytest) ───────────────────────────────────────────

if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS  {fn.__name__}")
        except AssertionError as exc:
            failures += 1
            print(f"FAIL  {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failures}/{len(fns)} passed")
    sys.exit(1 if failures else 0)
