"""
test_search_chembl — ChEMBL fetcher Item-shape test from fixtures.

Asserts kind/source, signal is None, target-search resolution (including the
zero-match case), mechanism vs. activity curated `raw` shapes, and that no
forbidden field (the un-curated full record) leaks into output.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sources.chembl import fetch_chembl  # noqa: E402

_FORBIDDEN = ("email", "transcript", "contact_info")


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    """Routes by URL substring — three ChEMBL endpoints, three fixtures."""

    def __init__(self, target_payload, mechanism_payload, activity_payload):
        self._target_payload = target_payload
        self._mechanism_payload = mechanism_payload
        self._activity_payload = activity_payload

    async def get(self, url, timeout=None, headers=None):
        if "target/search" in url:
            return _FakeResponse(self._target_payload)
        if "mechanism.json" in url:
            return _FakeResponse(self._mechanism_payload)
        if "activity.json" in url:
            return _FakeResponse(self._activity_payload)
        raise AssertionError(f"unexpected URL: {url}")


def _assert_no_forbidden(items):
    for it in items:
        blob = json.dumps(it.model_dump(), default=str)
        for field in _FORBIDDEN:
            assert field not in blob


_TARGET_HIT = {"targets": [{"target_chembl_id": "CHEMBL1862"}]}

_MECHANISMS = {
    "mechanisms": [
        {
            "molecule_chembl_id": "CHEMBL123",
            "action_type": "INHIBITOR",
            "mechanism_of_action": "Inhibits KRAS G12C",
            "max_phase": 3,
            "variant_sequence": {"mutation": "G12C"},
            "mechanism_refs": [
                {"ref_type": "PubMed", "ref_id": "12345"},
                {"ref_type": "Other", "ref_id": "ignored"},
            ],
        }
    ]
}

_ACTIVITIES = {
    "activities": [
        {
            "molecule_chembl_id": "CHEMBL456",
            "standard_type": "IC50",
            "standard_value": "12.5",
            "standard_units": "nM",
            "pchembl_value": "7.9",
            "assay_description": "A" * 300,
            "document_year": 2023,
        }
    ]
}


def test_chembl_item_shape_and_no_signal():
    client = _FakeClient(_TARGET_HIT, _MECHANISMS, _ACTIVITIES)
    items = asyncio.run(fetch_chembl(client, "KRAS", 10))

    assert len(items) == 2
    mech, act = items[0], items[1]

    assert mech.id == "chembl:mechanism:CHEMBL123:0"
    assert mech.kind == "compound"
    assert mech.source == "chembl"
    assert mech.signal is None
    assert mech.raw["mechanism_of_action"] == "Inhibits KRAS G12C"
    assert mech.raw["max_phase"] == 3
    assert mech.raw["action_type"] == "INHIBITOR"
    assert mech.raw["mutation"] == "G12C"
    assert mech.raw["pubmed_ids"] == ["12345"]   # non-PubMed ref dropped

    assert act.id == "chembl:activity:CHEMBL456:0"
    assert act.kind == "compound"
    assert act.signal is None
    assert act.raw["standard_type"] == "IC50"
    assert act.raw["standard_value"] == "12.5"
    assert act.raw["standard_units"] == "nM"
    assert act.raw["pchembl_value"] == "7.9"
    assert len(act.raw["assay_description"]) == 220   # sliced, same as trials' briefSummary

    _assert_no_forbidden(items)


def test_chembl_no_target_match_returns_empty():
    client = _FakeClient({"targets": []}, _MECHANISMS, _ACTIVITIES)
    items = asyncio.run(fetch_chembl(client, "NOTAGENE", 10))
    assert items == []


def test_chembl_blank_gene_returns_empty_without_any_request():
    class _ExplodingClient:
        async def get(self, *a, **k):
            raise AssertionError("should never be called for a blank gene")

    items = asyncio.run(fetch_chembl(_ExplodingClient(), "  ", 10))
    assert items == []


def test_chembl_records_missing_molecule_id_are_dropped():
    client = _FakeClient(
        _TARGET_HIT,
        {"mechanisms": [{"action_type": "INHIBITOR"}]},   # no molecule_chembl_id
        {"activities": [{"standard_type": "IC50"}]},       # no molecule_chembl_id
    )
    items = asyncio.run(fetch_chembl(client, "KRAS", 10))
    assert items == []


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
