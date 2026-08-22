"""
test_search_chembl — ChEMBL fetcher Item-shape test from fixtures.

Asserts kind/source, signal is None, target-search resolution (including the
zero-match case), mechanism vs. activity curated `raw` shapes, that no
forbidden field (the un-curated full record) leaks into output, that molecule
names are resolved via ONE batch `/molecule.json?molecule_chembl_id__in=...`
request (not one call per compound), and the id-only fallback when ChEMBL has
no `pref_name` for a molecule.
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
    """Routes by URL substring — four ChEMBL endpoints, four fixtures. Also
    counts molecule.json calls so tests can assert exactly one batch call is
    made, never one per compound."""

    def __init__(self, target_payload, mechanism_payload, activity_payload, molecule_payload=None):
        self._target_payload = target_payload
        self._mechanism_payload = mechanism_payload
        self._activity_payload = activity_payload
        self._molecule_payload = molecule_payload if molecule_payload is not None else {"molecules": []}
        self.molecule_call_count = 0
        self.molecule_urls: list[str] = []

    async def get(self, url, timeout=None, headers=None):
        if "target/search" in url:
            return _FakeResponse(self._target_payload)
        if "mechanism.json" in url:
            return _FakeResponse(self._mechanism_payload)
        if "activity.json" in url:
            return _FakeResponse(self._activity_payload)
        if "molecule.json" in url:
            self.molecule_call_count += 1
            self.molecule_urls.append(url)
            return _FakeResponse(self._molecule_payload)
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


_MOLECULES = {
    "molecules": [
        {"molecule_chembl_id": "CHEMBL123", "pref_name": "SOTORASIB"},
        {"molecule_chembl_id": "CHEMBL456", "pref_name": None},   # no name -> id fallback
    ]
}


def test_chembl_item_shape_and_no_signal():
    client = _FakeClient(_TARGET_HIT, _MECHANISMS, _ACTIVITIES, _MOLECULES)
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
    # Resolved name is primary display text; id never lost from raw.
    assert mech.raw["pref_name"] == "SOTORASIB"
    assert mech.title.startswith("SOTORASIB")
    assert mech.raw["molecule_chembl_id"] == "CHEMBL123"

    assert act.id == "chembl:activity:CHEMBL456:0"
    assert act.kind == "compound"
    assert act.signal is None
    assert act.raw["standard_type"] == "IC50"
    assert act.raw["standard_value"] == "12.5"
    assert act.raw["standard_units"] == "nM"
    assert act.raw["pchembl_value"] == "7.9"
    assert len(act.raw["assay_description"]) == 220   # sliced, same as trials' briefSummary
    # No pref_name for this molecule -> id-only fallback, never a fabricated name.
    assert act.raw["pref_name"] is None
    assert act.title.startswith("CHEMBL456")
    assert act.raw["molecule_chembl_id"] == "CHEMBL456"

    # Exactly one batch molecule lookup for both distinct ids, not one per item.
    assert client.molecule_call_count == 1
    assert "CHEMBL123" in client.molecule_urls[0]
    assert "CHEMBL456" in client.molecule_urls[0]

    _assert_no_forbidden(items)


def test_chembl_missing_pref_name_falls_back_to_id_everywhere():
    """A molecule ChEMBL has no record for at all (absent from the molecule.json
    response, not just a null pref_name) must fall back the same way — id-only
    title, raw.pref_name None, never a fabricated name."""
    client = _FakeClient(_TARGET_HIT, _MECHANISMS, _ACTIVITIES, {"molecules": []})
    items = asyncio.run(fetch_chembl(client, "KRAS", 10))

    for it in items:
        assert it.raw["pref_name"] is None
        assert it.title.startswith(it.raw["molecule_chembl_id"])

    assert client.molecule_call_count == 1


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
