"""
Tests for search_lab_resources over a RECORDED Supabase response (no network).

Covers >=3 categories (person, equipment, drug, animal_model), proving:
  - the per-category jsonb key mapping drives title/summary/search correctly
  - free-text search matches the right category-specific keys
  - contact_info NEVER appears in output (not in raw, title, summary, or anywhere
    in the serialized Item) — even though the recorded rows include it
  - category scoping works, and every Item is kind=resource / source=internal /
    signal=None

Runnable via pytest or directly (python tests/test_search_lab_resources.py).
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tools.search_lab_resources as slr  # noqa: E402

# Recorded Supabase rows. NOTE: these deliberately include contact_info to prove
# it is stripped — the real query never selects it, but the guarantee must hold
# regardless of what a row dict happens to carry.
_ROWS = [
    {
        "id": "r-person",
        "category": "person",
        "fields": {"name": "Dr. Ada Lovelace", "role": "PI", "lab": "Neuro-Oncology Core"},
        "contact_info": "ada@example.edu — SECRET",
        "created_at": "2026-07-21T10:00:00+00:00",
    },
    {
        "id": "r-equip",
        "category": "equipment",
        "fields": {"name": "Confocal Microscope", "use": "live-cell imaging", "location": "Room 412"},
        "contact_info": "call ext. 5555 — SECRET",
        "created_at": "2026-07-22T10:00:00+00:00",
    },
    {
        "id": "r-drug",
        "category": "drug",
        "fields": {"name": "Erlotinib", "target": "EGFR", "pi": "Dr. Turing"},
        "contact_info": "turing@example.edu — SECRET",
        "created_at": "2026-07-20T10:00:00+00:00",
    },
    {
        "id": "r-animal",
        "category": "animal_model",
        "fields": {"model_name": "APP/PS1 mouse", "genetic_alteration": "APP+PSEN1", "pi": "Dr. Hopper"},
        "contact_info": "hopper@example.edu — SECRET",
        "created_at": "2026-07-19T10:00:00+00:00",
    },
]


def _install_fake_rows(rows):
    """Point the module's sb_get at recorded rows; return the original to restore."""
    orig = slr.sb_get
    slr.sb_get = lambda table, params=None: list(rows)
    return orig


def _assert_no_contact_info(items):
    for it in items:
        assert "contact_info" not in it.raw
        blob = json.dumps(it.model_dump(), default=str)
        assert "contact_info" not in blob
        assert "SECRET" not in blob


def test_search_all_categories_maps_titles_and_strips_contact_info():
    orig = _install_fake_rows(_ROWS)
    try:
        items = slr.search_lab_resources("", category=None, limit=20)
    finally:
        slr.sb_get = orig

    assert len(items) == 4
    for it in items:
        assert it.kind == "resource"
        assert it.source == "internal"
        assert it.signal is None
        assert it.url is None
    _assert_no_contact_info(items)

    by_id = {it.id: it for it in items}
    # title comes from the FIRST searchable key of each category's map
    assert by_id["internal:r-person"].title == "Dr. Ada Lovelace"
    assert by_id["internal:r-equip"].title == "Confocal Microscope"
    assert by_id["internal:r-drug"].title == "Erlotinib"
    assert by_id["internal:r-animal"].title == "APP/PS1 mouse"   # animal_model uses model_name
    # summary carries the remaining searchable descriptors
    assert by_id["internal:r-drug"].summary == "target: EGFR; pi: Dr. Turing"
    assert "genetic_alteration: APP+PSEN1" in by_id["internal:r-animal"].summary
    # newest first (equip 07-22 before person 07-21 before drug 07-20 before animal 07-19)
    assert [it.id for it in items] == [
        "internal:r-equip", "internal:r-person", "internal:r-drug", "internal:r-animal",
    ]


def test_search_matches_category_specific_keys():
    orig = _install_fake_rows(_ROWS)
    try:
        # "EGFR" lives in the drug's `target` key — a category-specific searchable field.
        by_target = slr.search_lab_resources("EGFR")
        # "imaging" lives in the equipment's `use` key.
        by_use = slr.search_lab_resources("imaging")
        # a person's `role`
        by_role = slr.search_lab_resources("PI")
        # nothing matches
        none = slr.search_lab_resources("zzz-no-such-term")
    finally:
        slr.sb_get = orig

    assert [it.id for it in by_target] == ["internal:r-drug"]
    assert [it.id for it in by_use] == ["internal:r-equip"]
    assert "internal:r-person" in [it.id for it in by_role]
    assert none == []
    _assert_no_contact_info(by_target + by_use + by_role)


def test_category_scoping():
    orig = _install_fake_rows(_ROWS)
    try:
        only_drug = slr.search_lab_resources("", category="drug")
        only_person = slr.search_lab_resources("", category="person")
    finally:
        slr.sb_get = orig

    assert [it.id for it in only_drug] == ["internal:r-drug"]
    assert [it.id for it in only_person] == ["internal:r-person"]


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
