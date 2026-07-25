"""
test_off_domain — the relevance quality gates (port of discovery.ts #3 + the
biomed-anchor requirement for recency-sorted paper/news).
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sources.base import filter_quality, has_biomed_anchor, is_off_domain  # noqa: E402
from models import Item  # noqa: E402


def _item(kind, title, summary=""):
    return Item(id=f"{kind}:x", kind=kind, title=title, summary=summary, source="s",
                date_iso=None, dedupe_key=f"{kind}:{title}", raw={})


# ── is_off_domain: industrial keyword collisions only ────────────────────────


def test_off_domain_drops_industrial_no_biomed():
    # non-biomed term present AND no biomed anchor -> off-domain
    assert is_off_domain("inhibitor of coal oxidation in steel pipelines") is True


def test_off_domain_keeps_when_biomed_anchor_present():
    # "corrosion" but with a biomed anchor ("cell") -> kept (real biomedical work)
    assert is_off_domain("corrosion of the cell membrane protein") is False


def test_off_domain_keeps_when_no_suspicious_term():
    # no non-biomed term at all -> never off-domain (even if not obviously biomedical)
    assert is_off_domain("leadership approaches in group settings") is False


def test_has_biomed_anchor():
    assert has_biomed_anchor("phgdh in cancer metabolism") is True
    assert has_biomed_anchor("leadership approaches in alcoholics anonymous") is False


# ── filter_quality: combined gates ───────────────────────────────────────────


def test_filter_quality_anchor_required_for_paper_and_news():
    items = [
        _item("paper", "PHGDH in cancer metabolism"),          # anchor -> kept
        _item("news", "Drug repurposing for glioblastoma"),    # anchor (drug) -> kept
        _item("paper", "An examination of leadership in Alcoholics Anonymous"),  # no anchor -> dropped
        _item("news", "What is driving energy intake during weight loss"),       # no anchor -> dropped
    ]
    kept = filter_quality(items)
    titles = [i.title for i in kept]
    assert "PHGDH in cancer metabolism" in titles
    assert "Drug repurposing for glioblastoma" in titles
    assert len(kept) == 2  # the two off-topic literature items dropped


def test_filter_quality_does_not_require_anchor_for_other_kinds():
    # tools / grants / trials are NOT subject to the anchor requirement.
    items = [
        _item("tool", "awesome-graphs"),          # no biomed anchor, but a tool -> kept
        _item("grant", "Mathematical Foundations of AI"),  # kept
        _item("trial", "A study protocol"),       # kept
    ]
    kept = filter_quality(items)
    assert len(kept) == 3


def test_filter_quality_off_domain_drops_all_kinds():
    items = [_item("tool", "anti-corrosion steel coating library")]  # industrial + no biomed
    assert filter_quality(items) == []


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
