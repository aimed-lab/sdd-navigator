"""
tests/test_response_trim.py — egress trimming of Item.raw.

Two rules, and getting them backwards breaks real pages:
  * external items  -> raw reduced to {prior_signal, sources}
  * internal items  -> raw untouched (the podcast pages read it field by field)

Also pins that trimming never mutates the input, because the cache holds those
same objects and must keep them re-rankable.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from response import (  # noqa: E402
    trim_explore_result,
    trim_item,
    trim_items,
    trim_sections,
)


def _openalex_item() -> dict:
    return {
        "id": "openalex:W1",
        "kind": "paper",
        "title": "A paper",
        "summary": "Published in Nature.",
        "url": "https://doi.org/10.1/x",
        "doi": "10.1/x",
        "source": "openalex",
        "date_iso": "2024-01-01T00:00:00.000Z",
        "signal": {"metric": "network_rank", "value": 12.0, "as_of": "now"},
        "raw": {
            "referenced_works": [f"https://openalex.org/W{i}" for i in range(200)],
            "abstract_inverted_index": {"the": [0, 5, 9]},
            "authorships": [{"author": {"display_name": "X"}} for _ in range(40)],
            "counts_by_year": [{"year": y} for y in range(2000, 2025)],
            "prior_signal": {"metric": "citations", "value": 5193.0, "as_of": "now"},
            "sources": ["openalex", "pubmed"],
        },
    }


def _episode_item() -> dict:
    return {
        "id": "internal:abc",
        "kind": "episode",
        "title": "Foundation Models",
        "source": "internal",
        "raw": {
            "slug": "foundation-models-in-biomedicine",
            "episode_number": 64,
            "description": "…",
            "summary": ["a", "b"],
            "concepts": [{"title": "Foundation Models", "bullets": ["x"]}],
            "tags": ["ai"],
            "episode_url": "https://…",
            "image_url": "https://cdn/…jpg",
        },
    }


# ── external items ────────────────────────────────────────────────────────────


def test_external_raw_is_reduced_to_the_ui_keys():
    out = trim_item(_openalex_item())
    assert set(out["raw"]) == {"prior_signal", "sources"}
    assert out["raw"]["prior_signal"]["value"] == 5193.0
    assert out["raw"]["sources"] == ["openalex", "pubmed"]


def test_referenced_works_is_dropped():
    out = trim_item(_openalex_item())
    assert "referenced_works" not in out["raw"]


def test_top_level_display_fields_survive():
    """Everything a card renders lives at the top level and must be untouched."""
    src = _openalex_item()
    out = trim_item(src)
    for field in ("id", "kind", "title", "summary", "url", "doi",
                  "source", "date_iso", "signal"):
        assert out[field] == src[field], field


def test_external_item_without_prior_signal_gets_an_empty_raw():
    item = _openalex_item()
    del item["raw"]["prior_signal"]
    del item["raw"]["sources"]
    assert trim_item(item)["raw"] == {}


# ── internal items ────────────────────────────────────────────────────────────


def test_internal_raw_passes_through_untouched():
    """The podcast grid + detail pages read these straight out of raw."""
    src = _episode_item()
    out = trim_item(src)
    assert out["raw"] == src["raw"]
    for key in ("slug", "episode_number", "description", "summary",
                "concepts", "tags", "episode_url", "image_url"):
        assert key in out["raw"], key


# ── purity ────────────────────────────────────────────────────────────────────


def test_trimming_does_not_mutate_the_input():
    """The cache holds these objects; trimming them in place would destroy the
    citation graph for every later request."""
    src = _openalex_item()
    before = len(src["raw"]["referenced_works"])
    trim_item(src)
    assert len(src["raw"]["referenced_works"]) == before
    assert "referenced_works" in src["raw"]


# ── shapes ────────────────────────────────────────────────────────────────────


def test_items_without_raw_are_safe():
    assert trim_item({"id": "x", "source": "openalex"}) == {"id": "x", "source": "openalex"}
    assert trim_item({"id": "x", "source": "openalex", "raw": {}})["raw"] == {}


def test_trim_items_and_sections():
    items = trim_items([_openalex_item(), _episode_item()])
    assert set(items[0]["raw"]) == {"prior_signal", "sources"}
    assert "concepts" in items[1]["raw"]

    sections = trim_sections([
        {"tool": "search_papers", "kind": "paper", "items": [_openalex_item()]},
        {"tool": "search_wiki", "kind": "episode", "items": [_episode_item()]},
    ])
    assert "referenced_works" not in sections[0]["items"][0]["raw"]
    assert "concepts" in sections[1]["items"][0]["raw"]


def test_trim_explore_result_preserves_envelope():
    result = {
        "input": "egfr",
        "scope": {"topics": ["egfr"]},
        "tools_called": ["search_papers"],
        "reasoning": "because",
        "sections": [{"tool": "search_papers", "kind": "paper",
                      "items": [_openalex_item()]}],
    }
    out = trim_explore_result(result)
    for key in ("input", "scope", "tools_called", "reasoning"):
        assert out[key] == result[key]
    assert "referenced_works" not in out["sections"][0]["items"][0]["raw"]
    # original untouched
    assert "referenced_works" in result["sections"][0]["items"][0]["raw"]


def test_malformed_shapes_pass_through():
    assert trim_explore_result({"no": "sections"}) == {"no": "sections"}
    assert trim_sections([{"tool": "x"}]) == [{"tool": "x"}]


def test_payload_shrinks_substantially():
    import json
    before = len(json.dumps(_openalex_item()))
    after = len(json.dumps(trim_item(_openalex_item())))
    assert after < before * 0.15, f"only shrank {before}->{after}"
