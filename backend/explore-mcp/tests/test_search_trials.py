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

from sources.clinical_trials import fetch_trials  # noqa: E402

_FORBIDDEN = ("email", "transcript", "contact_info")


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payload):
        self._payload = payload

    async def get(self, url, timeout=None, headers=None):
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
