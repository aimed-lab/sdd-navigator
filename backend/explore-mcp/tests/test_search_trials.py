"""
test_search_trials — ClinicalTrials.gov fetcher Item-shape test from a fixture.

Asserts kind/source, signal is None, the no-NCT-id drop, briefSummary slicing,
and that no forbidden field appears in output.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import Item  # noqa: E402
from sources.clinical_trials import fetch_trials  # noqa: E402
from tools.search_trials import merge_trials  # noqa: E402

_FORBIDDEN = ("email", "transcript", "contact_info")


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        # Real httpx.Response always has this; sources/base.py's get_json now
        # reads it directly (no getattr fallback), so an unfaithful double
        # fails loudly rather than silently reporting 200.
        self.status_code = status_code

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payload):
        self._payload = payload
        self.urls: list[str] = []

    async def get(self, url, timeout=None, headers=None):
        self.urls.append(url)
        return _FakeResponse(self._payload)


def _assert_no_forbidden(items):
    for it in items:
        blob = json.dumps(it.model_dump(), default=str)
        for field in _FORBIDDEN:
            assert field not in blob


def test_trials_item_shape_and_no_signal():
    client = _FakeClient({"studies": [
        {
            "protocolSection": {
                "identificationModule": {"nctId": "NCT01234567", "briefTitle": "Study of X in Glioblastoma"},
                "statusModule": {"startDateStruct": {"date": "2025-03-01"}, "overallStatus": "RECRUITING"},
                "descriptionModule": {"briefSummary": "A" * 300},   # long -> sliced to 220
            }
        },
        {   # no nctId -> dropped
            "protocolSection": {"identificationModule": {"briefTitle": "No NCT"}}
        },
    ]})
    items = asyncio.run(fetch_trials(client, "glioblastoma", 10))

    assert len(items) == 1
    it = items[0]
    assert it.id == "clinicaltrials:NCT01234567"
    assert it.kind == "trial"
    assert it.source == "clinicaltrials"
    assert it.title == "Study of X in Glioblastoma"
    assert len(it.summary) == 220              # briefSummary sliced to 220
    assert it.url == "https://clinicaltrials.gov/study/NCT01234567"
    assert it.date_iso == "2025-03-01T00:00:00.000Z"
    assert it.signal is None
    _assert_no_forbidden(items)


def test_trials_empty_summary_falls_back_to_status():
    client = _FakeClient({"studies": [
        {"protocolSection": {
            "identificationModule": {"nctId": "NCT99", "briefTitle": "T"},
            "statusModule": {"overallStatus": "COMPLETED"},
        }}
    ]})
    items = asyncio.run(fetch_trials(client, "x", 10))
    assert items[0].summary == "COMPLETED clinical trial."


def test_trials_condition_only_uses_query_cond_else_query_term():
    cond = _FakeClient({"studies": []})
    asyncio.run(fetch_trials(cond, "glioblastoma", 10, ["RECRUITING"], condition_only=True))
    assert "query.cond=glioblastoma" in cond.urls[0]
    assert "query.term" not in cond.urls[0]
    assert "sort=LastUpdatePostDate:desc" in cond.urls[0]
    assert "filter.overallStatus=RECRUITING" in cond.urls[0]

    term = _FakeClient({"studies": []})
    asyncio.run(fetch_trials(term, "glioblastoma", 10))
    assert "query.term=glioblastoma" in term.urls[0]
    assert "query.cond" not in term.urls[0]


def test_trials_extra_term_sends_both_cond_and_term():
    c = _FakeClient({"studies": []})
    asyncio.run(fetch_trials(c, "pancreatic cancer", 10, ["RECRUITING"], condition_only=True, extra_term="KRAS"))
    assert "query.cond=pancreatic%20cancer" in c.urls[0]
    assert "query.term=KRAS" in c.urls[0]
    assert "filter.overallStatus=RECRUITING" in c.urls[0]

    # extra_term is ignored without condition_only (the term is already query.term)
    t = _FakeClient({"studies": []})
    asyncio.run(fetch_trials(t, "KRAS", 10, extra_term="x"))
    assert t.urls[0].count("query.term") == 1 and "query.cond" not in t.urls[0]


def _trial(nct):
    return Item(
        id=f"clinicaltrials:{nct}", kind="trial", title=nct, summary="s",
        url=f"https://clinicaltrials.gov/study/{nct}", source="clinicaltrials",
        dedupe_key=nct, raw={"nct_id": nct},
    )


def test_merge_trials_gene_matched_first_dedupes_and_fills_to_limit():
    gene = [_trial("NCT1"), _trial("NCT2")]
    cond = [_trial("NCT2"), _trial("NCT3"), _trial("NCT4")]
    merged = merge_trials(gene, cond, 4)
    assert [i.raw["nct_id"] for i in merged] == ["NCT1", "NCT2", "NCT3", "NCT4"]
    assert [i.raw["nct_id"] for i in merge_trials(gene, cond, 3)] == ["NCT1", "NCT2", "NCT3"]


def test_merge_trials_falls_back_to_condition_only_when_gene_search_empty():
    cond = [_trial("NCT3"), _trial("NCT4")]
    assert [i.raw["nct_id"] for i in merge_trials([], cond, 10)] == ["NCT3", "NCT4"]


def test_search_trials_with_gene_runs_both_searches_and_merges():
    import tools.search_trials as st

    calls = []

    async def fake(query, limit=20, status_filter=None, condition_only=False, extra_term=None):
        calls.append((query, status_filter, condition_only, extra_term))
        return [_trial("NCT9")] if extra_term else [_trial("NCT8"), _trial("NCT9")]

    original = st.search_trials_async
    st.search_trials_async = fake
    try:
        merged = asyncio.run(st.search_trials_with_gene_async("pancreatic cancer", "KRAS", 10, ["RECRUITING"]))
    finally:
        st.search_trials_async = original
    assert [i.raw["nct_id"] for i in merged] == ["NCT9", "NCT8"]
    # Both searches ran (in parallel, so order is not fixed), both with the status filter.
    assert len(calls) == 2
    assert ("pancreatic cancer", ["RECRUITING"], True, None) in calls
    assert ("pancreatic cancer", ["RECRUITING"], True, "KRAS") in calls


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
