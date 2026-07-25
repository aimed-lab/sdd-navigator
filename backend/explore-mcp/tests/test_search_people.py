"""
test_search_people — two-source people search from recorded Supabase responses.

Asserts platform users (source="platform") and lab_resources persons
(source="internal") both appear as kind="person", are NOT deduped against each
other, and that `email` (users) and `contact_info` (lab_resources) never leak.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tools.search_people as sp  # noqa: E402
import tools.search_lab_resources as slr  # noqa: E402

_FORBIDDEN = ("email", "contact_info", "SECRET")

# Public users (is_public=true). Includes email to prove it is stripped.
_USERS = [
    {
        "id": "u1",
        "name": "Dr. Ada Cancer-Researcher",
        "title": "Professor",
        "affiliation": "Oncology Dept",
        "research_focus": "cancer metabolism",
        "profile_slug": "ada-cr",
        "orcid_url": "https://orcid.org/0000-1",
        "email": "ada@example.edu-SECRET",
    },
    {
        "id": "u2",
        "name": "Bob Unrelated",
        "title": "Postdoc",
        "affiliation": "Physics",
        "research_focus": "optics",
        "profile_slug": "bob-u",
        "orcid_url": None,
        "email": "bob@example.edu-SECRET",
    },
]

# lab_resources category='person'. Includes contact_info to prove it is stripped.
_LAB_PERSON = [
    {
        "id": "lp1",
        "category": "person",
        "fields": {"name": "Dr. Grace Hopper", "role": "PI", "lab": "Cancer Genomics"},
        "contact_info": "grace@example.edu-SECRET",
        "created_at": "2026-07-20T00:00:00+00:00",
    },
]


def _assert_no_forbidden(items):
    for it in items:
        blob = json.dumps(it.model_dump(), default=str)
        for field in _FORBIDDEN:
            assert field not in blob, f"{field} leaked in {it.id}"


def _install():
    o1, o2 = sp.sb_get, slr.sb_get
    sp.sb_get = lambda table, params=None: list(_USERS)          # users query
    slr.sb_get = lambda table, params=None: list(_LAB_PERSON)    # lab_resources query
    return o1, o2


def test_people_merge_two_sources_no_leak():
    o1, o2 = _install()
    try:
        people = sp.search_people("cancer", limit=20)
    finally:
        sp.sb_get, slr.sb_get = o1, o2

    by_id = {it.id: it for it in people}
    # platform user (matched on research_focus "cancer metabolism")
    assert "platform:u1" in by_id
    p = by_id["platform:u1"]
    assert p.kind == "person"
    assert p.source == "platform"
    assert p.url == "/researchers/ada-cr"
    assert p.title == "Dr. Ada Cancer-Researcher"
    # Bob doesn't match "cancer"
    assert "platform:u2" not in by_id

    # lab_resources person (matched on lab "Cancer Genomics"), re-tagged as person
    assert "internal:lp1" in by_id
    r = by_id["internal:lp1"]
    assert r.kind == "person"
    assert r.source == "internal"
    assert r.title == "Dr. Grace Hopper"

    # two distinct sources both present — not deduped
    assert {it.source for it in people} == {"platform", "internal"}
    _assert_no_forbidden(people)


def test_people_empty_query_returns_both_and_no_email():
    o1, o2 = _install()
    try:
        people = sp.search_people("", limit=20)
    finally:
        sp.sb_get, slr.sb_get = o1, o2
    # empty query -> all public users + all lab persons
    ids = {it.id for it in people}
    assert {"platform:u1", "platform:u2", "internal:lp1"} <= ids
    _assert_no_forbidden(people)


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
