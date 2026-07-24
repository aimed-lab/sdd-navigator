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

from dedupe import dedupe_key, dedupe_items, merge_items, normalize_doi  # noqa: E402


# ── normalize_doi ────────────────────────────────────────────────────────────


def test_normalize_doi_strips_prefix_and_lowercases():
    assert normalize_doi("https://doi.org/10.1234/AbC") == "10.1234/abc"
    assert normalize_doi("http://dx.doi.org/10.5/XY") == "10.5/xy"
    assert normalize_doi("doi:10.9/Z") == "10.9/z"
    assert normalize_doi("10.1/already") == "10.1/already"
    assert normalize_doi("") is None
    assert normalize_doi(None) is None


# ── Branch 0/1: explicit DOI wins ────────────────────────────────────────────


def test_explicit_doi_beats_url():
    # A PubMed-style URL with a DOI passed explicitly keys on the DOI, not the URL.
    assert dedupe_key("https://pubmed.ncbi.nlm.nih.gov/123/", "T", doi="https://doi.org/10.1/AbC") == "doi:10.1/abc"


def test_explicit_doi_without_url():
    assert dedupe_key(None, "T", doi="10.5/XY") == "doi:10.5/xy"


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


# ── merge_items: cross-source DOI merge ──────────────────────────────────────
# These use real models.Item (needs pydantic); imported locally so the pure
# dedupe_key/normalize_doi tests above still run without it.


def _paper(source, ext, *, doi=None, url=None, title="A paper", summary=None,
           signal=None, refs=None, key=None):
    from models import Item
    raw = {}
    if refs is not None:
        raw["referenced_works"] = refs
    return Item(
        id=f"{source}:{ext}",
        kind="paper",
        title=title,
        summary=summary,
        url=url,
        doi=doi,
        source=source,
        date_iso="2024-01-01T00:00:00.000Z",
        signal=signal,
        dedupe_key=key or (f"doi:{doi}" if doi else f"title:{title.lower()}"),
        raw=raw,
    )


def test_merge_pubmed_and_openalex_same_doi_collapse_and_keep_signal_and_refs():
    from models import Signal
    pubmed = _paper("pubmed", "111", doi="10.1/x", url="https://pubmed.ncbi.nlm.nih.gov/111/",
                    summary="Published in Nature.")
    openalex = _paper("openalex", "W1", doi="10.1/x", url="https://doi.org/10.1/x",
                      summary="Published in Nature. A. Author et al.",
                      signal=Signal(metric="citations", value=42.0, as_of="2024-01-01T00:00:00.000Z"),
                      refs=["https://openalex.org/W9", "https://openalex.org/W8"])

    out = merge_items([pubmed, openalex])   # pubmed seen first
    assert len(out) == 1                     # collapsed to ONE
    m = out[0]
    # OpenAlex signal survives even though PubMed (no signal) was seen first
    assert m.signal is not None and m.signal.metric == "citations" and m.signal.value == 42.0
    # referenced_works preserved from OpenAlex
    assert m.raw["referenced_works"] == ["https://openalex.org/W9", "https://openalex.org/W8"]
    # both contributing sources recorded, in first-seen order
    assert m.raw["sources"] == ["pubmed", "openalex"]
    assert m.doi == "10.1/x"


def test_merge_different_dois_do_not_collapse():
    a = _paper("openalex", "A", doi="10.1/a")
    b = _paper("openalex", "B", doi="10.2/b")
    out = merge_items([a, b])
    assert len(out) == 2
    assert {i.doi for i in out} == {"10.1/a", "10.2/b"}
    # untouched single items gain no raw['sources'] key
    assert all("sources" not in i.raw for i in out)


def test_merge_no_doi_uses_fallback_key():
    # No DOI on either — they still collapse via the old title/url fallback key.
    a = _paper("crossref", "A", doi=None, url=None, title="Same Preprint Title")
    b = _paper("crossref", "B", doi=None, url=None, title="Same Preprint Title")
    assert a.dedupe_key == b.dedupe_key == "title:same preprint title"
    out = merge_items([a, b])
    assert len(out) == 1


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
