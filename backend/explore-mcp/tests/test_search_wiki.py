"""
test_search_wiki — wiki_pages search from a recorded Supabase response.

Asserts kind/source, url derivation (episode_url or /topics/<slug>), search over
title/description/concepts/tags, and that `transcript` NEVER leaks — even though
the recorded rows include one.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tools.search_wiki as sw  # noqa: E402

_ROWS = [
    {
        "id": "w1",
        "slug": "drug-discovery-basics",
        "title": "Drug Discovery Basics",
        "episode_number": 12,
        "description": "An intro to the drug discovery pipeline.",
        "summary": ["point a", "point b"],
        "concepts": [{"title": "Target ID", "bullets": ["find a protein target"]}],
        "tags": ["pipeline", "targets"],
        "episode_url": "https://podcast.example/ep12",
        "image_url": "https://img.example/12.png",
        "transcript": "SECRET FULL TRANSCRIPT " * 50,   # must never leak
    },
    {
        "id": "w2",
        "slug": "crispr-screens",
        "title": "CRISPR Screens",
        "episode_number": 30,
        "description": "How pooled CRISPR screens work.",
        "summary": [],
        "concepts": [{"title": "Pooled screen", "bullets": ["knockout library"]}],
        "tags": ["crispr"],
        "episode_url": None,       # -> url falls back to /topics/<slug>
        "image_url": None,
        "transcript": "ANOTHER SECRET",
    },
]


def _install(rows):
    orig = sw.sb_get
    sw.sb_get = lambda table, params=None: list(rows)
    return orig


def _assert_no_transcript(items):
    for it in items:
        assert "transcript" not in it.raw
        blob = json.dumps(it.model_dump(), default=str)
        assert "transcript" not in blob
        assert "SECRET" not in blob


def test_wiki_search_shape_and_no_transcript():
    orig = _install(_ROWS)
    try:
        hits = sw.search_wiki("drug discovery")   # matches w1 title/description
        all_rows = sw.search_wiki("")              # empty query -> all, newest ep first
    finally:
        sw.sb_get = orig

    assert [it.id for it in hits] == ["internal:w1"]
    it = hits[0]
    assert it.kind == "episode"
    assert it.source == "internal"
    assert it.title == "Drug Discovery Basics"
    assert it.summary == "An intro to the drug discovery pipeline."
    assert it.url == "https://podcast.example/ep12"
    assert it.signal is None
    _assert_no_transcript(hits)

    # empty query returns all, sorted by episode_number desc (30 before 12)
    assert [it.id for it in all_rows] == ["internal:w2", "internal:w1"]
    # episode_url None -> /topics/<slug>
    assert all_rows[0].url == "/topics/crispr-screens"
    _assert_no_transcript(all_rows)


def test_wiki_search_matches_concepts_and_tags():
    orig = _install(_ROWS)
    try:
        by_concept = sw.search_wiki("knockout library")   # inside concepts bullets
        by_tag = sw.search_wiki("crispr")                  # inside tags
    finally:
        sw.sb_get = orig
    assert [it.id for it in by_concept] == ["internal:w2"]
    assert [it.id for it in by_tag] == ["internal:w2"]


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for fn in fns:
        try:
            fn(); print(f"PASS  {fn.__name__}")
        except AssertionError as exc:
            failures += 1; print(f"FAIL  {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failures}/{len(fns)} passed")
    sys.exit(1 if failures else 0)
