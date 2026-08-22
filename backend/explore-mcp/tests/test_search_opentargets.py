"""
test_search_opentargets — Open Targets fetcher Item-shape test from fixtures.

Asserts kind/source, signal is None, gene-target resolution (including the
zero-match case), the disease-fallback path when gene resolution misses,
one-item-per-association curated `raw` shape, evidence/tractability
curation, and that no forbidden field leaks into output.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sources.opentargets import fetch_opentargets  # noqa: E402

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
    """Routes by the GraphQL `query` string's leading operation name — one
    POST endpoint, distinguished by body content, same technique the real
    Open Targets API sees (a single /graphql URL for every query)."""

    def __init__(self, search_responses: dict[str, dict], target_payload=None, disease_payload=None):
        # search_responses: {"target"|"disease": payload} keyed by entityNames
        self._search_responses = search_responses
        self._target_payload = target_payload
        self._disease_payload = disease_payload
        self.post_count = 0

    async def post(self, url, json=None, timeout=None, headers=None):
        self.post_count += 1
        body = json or {}
        query = body.get("query", "")
        variables = body.get("variables", {})
        if "EntitySearch" in query:
            entity = (variables.get("entityNames") or [None])[0]
            return _FakeResponse({"data": self._search_responses.get(entity, {"search": {"hits": []}})})
        if "TargetDiseases" in query:
            return _FakeResponse({"data": {"target": self._target_payload}})
        if "DiseaseTargets" in query:
            return _FakeResponse({"data": {"disease": self._disease_payload}})
        raise AssertionError(f"unexpected GraphQL query: {query[:50]}")


def _assert_no_forbidden(items):
    for it in items:
        blob = json.dumps(it.model_dump(), default=str)
        for field in _FORBIDDEN:
            assert field not in blob


_TARGET_HIT = {"search": {"hits": [{"id": "ENSG00000092621", "name": "PHGDH", "entity": "target"}]}}
_TARGET_MISS = {"search": {"hits": []}}
_DISEASE_HIT = {"search": {"hits": [{"id": "EFO_0000616", "name": "glioblastoma", "entity": "disease"}]}}

_TARGET_PAYLOAD = {
    "id": "ENSG00000092621",
    "approvedSymbol": "PHGDH",
    "approvedName": "phosphoglycerate dehydrogenase",
    "biotype": "protein_coding",
    "tractability": [
        {"label": "Approved Drug", "modality": "SM", "value": True},
        {"label": "Discovery Precedence", "modality": "SM", "value": False},
    ],
    "associatedDiseases": {
        "count": 2,
        "rows": [
            {
                "score": 0.512345,
                "disease": {"id": "EFO_0000616", "name": "glioblastoma"},
                "datatypeScores": [
                    {"id": "genetic_association", "score": 0.3},
                    {"id": "literature", "score": 0.7},
                ],
            },
            {
                "score": 0.211,
                "disease": {"id": "EFO_0000311", "name": "breast carcinoma"},
                "datatypeScores": [{"id": "animal_model", "score": 0.4}],
            },
        ],
    },
}

_DISEASE_PAYLOAD = {
    "id": "EFO_0000616",
    "name": "glioblastoma",
    "associatedTargets": {
        "count": 1,
        "rows": [
            {
                "score": 0.65,
                "target": {"id": "ENSG00000141510", "approvedSymbol": "TP53", "approvedName": "tumor protein p53"},
                "datatypeScores": [{"id": "genetic_association", "score": 0.5}],
            }
        ],
    },
}


def test_opentargets_gene_path_item_shape_and_no_signal():
    client = _FakeClient({"target": _TARGET_HIT}, target_payload=_TARGET_PAYLOAD)
    items = asyncio.run(fetch_opentargets(client, "PHGDH", 10))

    assert len(items) == 2
    first, second = items[0], items[1]

    assert first.kind == "target"
    assert first.source == "opentargets"
    assert first.signal is None
    assert first.raw["target_ensembl_id"] == "ENSG00000092621"
    assert first.raw["target_symbol"] == "PHGDH"
    assert first.raw["disease_name"] == "glioblastoma"
    assert abs(first.raw["score"] - 0.512345) < 1e-9
    assert first.raw["evidence"] == [
        {"type": "genetic_association", "score": 0.3},
        {"type": "literature", "score": 0.7},
    ]
    # Only value=true tractability rows survive.
    assert first.raw["tractability"] == [{"label": "Approved Drug", "modality": "SM", "value": True}]
    assert "PHGDH" in first.title and "glioblastoma" in first.title

    assert second.raw["disease_name"] == "breast carcinoma"

    _assert_no_forbidden(items)


def test_opentargets_disease_fallback_when_gene_resolution_misses():
    client = _FakeClient(
        {"target": _TARGET_MISS, "disease": _DISEASE_HIT},
        disease_payload=_DISEASE_PAYLOAD,
    )
    items = asyncio.run(fetch_opentargets(client, "glioblastoma", 10))

    assert len(items) == 1
    item = items[0]
    assert item.kind == "target"
    assert item.raw["target_symbol"] == "TP53"
    assert item.raw["disease_name"] == "glioblastoma"
    # No target-level tractability is fetched on the reverse path.
    assert item.raw["tractability"] == []
    assert item.raw["evidence"] == [{"type": "genetic_association", "score": 0.5}]


def test_opentargets_no_match_returns_empty():
    client = _FakeClient({"target": _TARGET_MISS, "disease": _TARGET_MISS})
    items = asyncio.run(fetch_opentargets(client, "NOTAGENEORDISEASE", 10))
    assert items == []


def test_opentargets_blank_query_returns_empty_without_any_request():
    class _ExplodingClient:
        async def post(self, *a, **k):
            raise AssertionError("should never be called for a blank query")

    items = asyncio.run(fetch_opentargets(_ExplodingClient(), "  ", 10))
    assert items == []


def test_opentargets_cap_limits_items():
    client = _FakeClient({"target": _TARGET_HIT}, target_payload=_TARGET_PAYLOAD)
    items = asyncio.run(fetch_opentargets(client, "PHGDH", 1))
    assert len(items) == 1


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
