"""
test_search_pager — PAGER text cleanup.

PAGER returns HTML entities in NAME/DESCRIPTION (a description of just
"&nbsp;" showed up verbatim on gene set tiles).
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sources.pager import _clean_text  # noqa: E402


def test_nbsp_only_description_becomes_none():
    assert _clean_text("&nbsp;") is None


def test_entities_are_unescaped():
    assert _clean_text("A&amp;B") == "A&B"


def test_whitespace_collapsed_including_non_breaking_space():
    assert _clean_text("  Genes involved&nbsp;in \n GPCR  ") == "Genes involved in GPCR"


def test_empty_and_none_become_none():
    assert _clean_text("") is None
    assert _clean_text(None) is None
    assert _clean_text("   ") is None


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
