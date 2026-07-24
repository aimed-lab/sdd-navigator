"""
Per-source Item-shape tests, driven by recorded fixture responses (no network).

Each source fetcher takes an httpx-like client; we pass a fake client that
returns canned JSON, so these assert the URL→Item field mapping deterministically.

Runnable via pytest or directly (python tests/test_sources.py).
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sources.crossref import fetch_crossref  # noqa: E402
from sources.openalex import fetch_openalex  # noqa: E402
from sources.pubmed import fetch_pubmed  # noqa: E402


# ── Fake httpx client ────────────────────────────────────────────────────────


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    """Routes GETs to canned payloads. `routes` maps a URL substring -> payload;
    a single non-dict payload answers every URL."""

    def __init__(self, routes):
        self._routes = routes

    async def get(self, url, timeout=None):
        if isinstance(self._routes, dict):
            for needle, payload in self._routes.items():
                if needle in url:
                    return _FakeResponse(payload)
            raise AssertionError(f"no fake route for {url}")
        return _FakeResponse(self._routes)


# ── PubMed ───────────────────────────────────────────────────────────────────


def test_pubmed_item_shape():
    client = _FakeClient({
        "esearch": {"esearchresult": {"idlist": ["111", "222"]}},
        "esummary": {"result": {
            "111": {
                "title": "PHGDH in Alzheimer's",
                "source": "Nature",
                "pubdate": "2024 Oct 15",
                "authors": [{"name": "Doe J"}, {"name": "Roe R"}, {"name": "Poe P"}],
            },
            "222": {"title": "   ", "source": "X", "pubdate": "2023", "authors": []},
        }},
    })
    items = asyncio.run(fetch_pubmed(client, "PHGDH Alzheimer's", 10))

    assert len(items) == 1  # blank-title record 222 dropped
    it = items[0]
    assert it.id == "pubmed:111"
    assert it.kind == "paper"
    assert it.source == "pubmed"
    assert it.title == "PHGDH in Alzheimer's"
    assert it.url == "https://pubmed.ncbi.nlm.nih.gov/111/"
    assert it.summary == "Published in Nature. Doe J, Roe R et al."
    assert it.date_iso == "2024-10-15T00:00:00.000Z"
    assert it.signal is None                      # PubMed has no metric
    assert it.dedupe_key == "url:pubmed.ncbi.nlm.nih.gov/111/"
    assert it.raw["source"] == "Nature"


# ── OpenAlex ─────────────────────────────────────────────────────────────────


def test_openalex_item_shape_with_citation_signal():
    client = _FakeClient({"api.openalex.org": {"results": [
        {
            "id": "https://openalex.org/W123",
            "title": "PHGDH serine synthesis",
            "doi": "https://doi.org/10.1/abc",
            "publication_date": "2024-05-01",
            "cited_by_count": 42,
            "primary_location": {"source": {"display_name": "Cell"}},
            "authorships": [
                {"author": {"display_name": "A One"}},
                {"author": {"display_name": "B Two"}},
                {"author": {"display_name": "C Three"}},
            ],
            "referenced_works": ["https://openalex.org/W1", "https://openalex.org/W2"],
        },
        {"title": "", "cited_by_count": 0},  # blank title dropped
    ]}})
    items = asyncio.run(fetch_openalex(client, "PHGDH", 10))

    assert len(items) == 1
    it = items[0]
    assert it.id == "openalex:W123"
    assert it.source == "openalex"
    assert it.title == "PHGDH serine synthesis"
    assert it.url == "https://doi.org/10.1/abc"
    assert it.summary == "Published in Cell. A One, B Two et al."
    assert it.date_iso == "2024-05-01T00:00:00.000Z"
    # REAL citation signal set from cited_by_count
    assert it.signal is not None
    assert it.signal.metric == "citations"
    assert it.signal.value == 42.0
    assert it.dedupe_key == "doi:10.1/abc"
    # referenced_works captured into raw for later citation-graph ranking
    assert it.raw["referenced_works"] == ["https://openalex.org/W1", "https://openalex.org/W2"]


# ── Crossref ─────────────────────────────────────────────────────────────────


def test_crossref_item_shape_and_type_guard():
    client = _FakeClient({"api.crossref.org": {"message": {"items": [
        {
            "title": ["PHGDH review"],
            "type": "journal-article",
            "DOI": "10.5/xyz",
            "URL": "https://doi.org/10.5/xyz",
            "container-title": ["Journal of X"],
            "issued": {"date-parts": [[2024, 3, 7]]},
        },
        {"title": ["A Whole Book"], "type": "book", "DOI": "10.9/b"},   # non-article -> dropped
        {"title": [""], "type": "journal-article"},                     # blank title -> dropped
    ]}}})
    items = asyncio.run(fetch_crossref(client, "PHGDH", 10))

    assert len(items) == 1
    it = items[0]
    assert it.id == "crossref:10.5-xyz"
    assert it.source == "crossref"
    assert it.title == "PHGDH review"
    assert it.summary == "Published in Journal of X."
    assert it.url == "https://doi.org/10.5/xyz"
    assert it.date_iso == "2024-03-07T00:00:00.000Z"
    assert it.signal is None                        # Crossref has no metric
    assert it.dedupe_key == "doi:10.5/xyz"


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
