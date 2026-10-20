"""
test_page_agent — the living-page agent against today's explore_async output
(preprint and approval sections, per-tool timed_out sections).
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tools.page_agent as pa  # noqa: E402
from tools.abstracts import has_abstract  # noqa: E402


def _item(i, kind, summary="Short.", **extra):
    return {"id": i, "kind": kind, "title": f"T {i}", "summary": summary,
            "url": f"https://x/{i}", "source": "s", "date_iso": None, **extra}


_AUTHORS = "Smith J, Jones K, Lee A, Park B, Chen C, Garcia D, Miller E, Brown F, Davis G, Wilson H"


def _explore_result():
    return {
        "tools_called": ["search_papers", "search_preprints", "search_fda", "search_chembl"],
        "sections": [
            {"tool": "search_papers", "kind": "paper", "items": [_item("pubmed:1", "paper")]},
            {"tool": "search_preprints", "kind": "preprint", "items": [
                _item("europepmc:PPR1", "preprint", f"bioRxiv · {_AUTHORS}",
                      doi="10.1101/x", raw={"server": "bioRxiv", "authors": _AUTHORS})]},
            {"tool": "search_fda", "kind": "approval", "items": [_item("openfda:A1", "approval")]},
            {"tool": "search_chembl", "kind": "compound", "items": [], "timed_out": True},
        ],
    }


def test_flatten_reports_timed_out_sections_and_keeps_new_kinds():
    items, failed, timed_out, found = pa._flatten_candidates(_explore_result(), 60)
    assert {i["kind"] for i in items} == {"paper", "preprint", "approval"}
    assert failed == []
    assert timed_out == ["search_chembl"]
    assert found == 3


def test_run_page_agent_warns_on_timed_out_source(monkeypatch):
    async def fake_explore(text):
        return _explore_result()

    async def fake_enrich(c):
        return {}

    monkeypatch.setattr(pa, "explore_async", fake_explore)
    monkeypatch.setattr(pa, "enrich_abstracts", fake_enrich)
    monkeypatch.setattr(pa, "build_page_notes", lambda g, c: None)
    out = asyncio.run(pa.run_page_agent_async("EGFR in lung cancer"))
    assert out["search_failed"] is False
    assert out["candidates_found"] == 3
    assert any("timed out" in w and "search_chembl" in w for w in out["warnings"])
    assert {u["kind"] for u in out["unfiled_items"] + out["project_level_items"]} >= {"preprint"}


def test_preprint_author_blurb_is_not_an_abstract():
    p = _item("europepmc:PPR1", "preprint", f"bioRxiv · {_AUTHORS}",
              raw={"server": "bioRxiv", "authors": _AUTHORS})
    assert len(p["summary"]) >= 80
    assert not has_abstract(p)
    p["summary"] = "We show that EGFR signalling " * 5
    assert has_abstract(p)


def test_refresh_returns_only_new_items_filed_under_existing_notes(monkeypatch):
    result = _explore_result()
    result["sections"][0]["items"] = [
        _item("pubmed:1", "paper", "EGFR inhibitor resistance in lung adenocarcinoma " * 3),
        _item("pubmed:2", "paper", "EGFR inhibitor resistance mechanisms osimertinib " * 3),
    ]

    async def fake_explore(text):
        return result

    async def fake_enrich(c):
        return {}

    monkeypatch.setattr(pa, "explore_async", fake_explore)
    monkeypatch.setattr(pa, "enrich_abstracts", fake_enrich)
    notes = [{"slug": "egfr-resistance", "title": "EGFR inhibitor resistance",
              "body": "Resistance to EGFR inhibitors such as osimertinib in lung adenocarcinoma."}]
    out = asyncio.run(pa.run_page_refresh_async("EGFR", ["pubmed:1"], notes))
    ids = [i["item_id"] for i in out["new_items"]]
    assert "pubmed:1" not in ids and "pubmed:2" in ids
    assert out["search_failed"] is False
    assert all(i["item_id"] != "pubmed:1"
               for items in out["evidence_filings"].values() for i in (f["item"] for f in items))
    assert any("timed out" in w for w in out["warnings"])


def test_refresh_reports_a_failed_search(monkeypatch):
    async def boom(text):
        raise RuntimeError("down")

    monkeypatch.setattr(pa, "explore_async", boom)
    out = asyncio.run(pa.run_page_refresh_async("EGFR", [], []))
    assert out["search_failed"] is True and out["new_items"] == []
