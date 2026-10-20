"""
test_chembl_timeout — slow-ChEMBL handling.

ChEMBL gets a 15s request timeout (other sources keep 8s), its mechanism and
activity calls run concurrently, populated results are cached for a day, and a
tool slower than the per-tool cap yields an empty section without sinking the
explore call (its fetch keeps running so it can fill the cache).
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tools.explore as te  # noqa: E402
import tools.search_chembl as sc  # noqa: E402
from cache import TTL_EMPTY, InProcessCache  # noqa: E402
from models import Item  # noqa: E402
from sources.base import FETCH_TIMEOUT  # noqa: E402
from sources.chembl import CHEMBL_TIMEOUT, fetch_chembl  # noqa: E402
from sources.clinical_trials import fetch_trials  # noqa: E402


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


_TARGET = {"targets": [{
    "target_chembl_id": "CHEMBL2189121", "organism": "Homo sapiens", "target_type": "SINGLE PROTEIN",
    "target_components": [{"target_component_synonyms": [
        {"component_synonym": "KRAS", "syn_type": "GENE_SYMBOL"}]}],
}]}
_MECH = {"mechanisms": [{"molecule_chembl_id": "CHEMBL1", "mechanism_of_action": "inhibitor",
                         "action_type": "INHIBITOR", "max_phase": 4}]}
_ACT = {"activities": []}


class _ChemblClient:
    """Records the timeout of every request and how many were in flight at once."""

    def __init__(self, delay: float = 0.0):
        self.delay = delay
        self.timeouts: list[float] = []
        self.in_flight = 0
        self.max_in_flight = 0

    async def get(self, url, timeout=None, headers=None):
        self.timeouts.append(timeout)
        self.in_flight += 1
        self.max_in_flight = max(self.max_in_flight, self.in_flight)
        try:
            await asyncio.sleep(self.delay)
        finally:
            self.in_flight -= 1
        if "target/search" in url:
            return _FakeResponse(_TARGET)
        if "mechanism.json" in url:
            return _FakeResponse(_MECH)
        if "activity.json" in url:
            return _FakeResponse(_ACT)
        return _FakeResponse({"molecules": []})


def test_chembl_requests_use_the_longer_timeout_and_other_sources_do_not():
    assert CHEMBL_TIMEOUT == 15 and FETCH_TIMEOUT == 8
    chembl = _ChemblClient()
    asyncio.run(fetch_chembl(chembl, "KRAS", 10))
    assert chembl.timeouts and all(t == CHEMBL_TIMEOUT for t in chembl.timeouts)

    other = _ChemblClient()
    asyncio.run(fetch_trials(other, "glioblastoma", 10))
    assert other.timeouts == [FETCH_TIMEOUT]


def test_mechanisms_and_activities_run_concurrently():
    client = _ChemblClient(delay=0.05)
    asyncio.run(fetch_chembl(client, "KRAS", 10))
    assert client.max_in_flight >= 2      # mechanism + activity overlapped


def test_populated_chembl_results_are_cached_for_a_day():
    seen = {}

    class _Spy:
        async def get_or_compute(self, key, fn, ttl, stale):
            seen["ttl"], seen["stale"] = ttl, stale
            return []

    original = sc.cache
    sc.cache = _Spy()
    try:
        asyncio.run(sc.search_chembl_async("KRAS", 10))
    finally:
        sc.cache = original
    assert seen["ttl"] == 24 * 60 * 60 and seen["stale"] >= seen["ttl"]


def test_expire_soon_shortens_an_existing_entry():
    async def body():
        c = InProcessCache()
        await c.get_or_compute("k", lambda: _value(), 3600, 7200)
        await c.expire_soon("k")
        return await c._load("k")

    async def _value():
        return {"sections": ["x"]}

    entry = asyncio.run(body())
    assert entry.ttl == TTL_EMPTY and entry.stale_ttl == TTL_EMPTY


def _item(id_):
    return Item(id=id_, kind="resource", title=id_, summary="s", url=f"https://x/{id_}",
                source="internal", dedupe_key=id_)


def test_a_tool_over_the_cap_returns_an_empty_section_and_keeps_running():
    finished = []

    def fake_dispatch(name, query):
        async def slow():
            await asyncio.sleep(0.3)
            finished.append(name)
            return [_item("late")]

        async def fast():
            return [_item("quick")]

        return slow() if name == "search_wiki" else fast()

    original = (te._dispatch, te._TOOL_TIMEOUT)
    te._dispatch, te._TOOL_TIMEOUT = fake_dispatch, 0.05

    async def body():
        sections = await te._execute(["search_wiki", "search_lab_resources"], dict(te._DEFAULT_SCOPE))
        assert finished == []                   # still running when the page was assembled
        await asyncio.sleep(0.4)                # ...but not cancelled
        return sections

    try:
        sections = asyncio.run(body())
    finally:
        te._dispatch, te._TOOL_TIMEOUT = original

    by_tool = {s["tool"]: s for s in sections}
    assert by_tool["search_wiki"]["items"] == [] and by_tool["search_wiki"]["timed_out"] is True
    assert [i["id"] for i in by_tool["search_lab_resources"]["items"]] == ["quick"]
    assert "timed_out" not in by_tool["search_lab_resources"]
    assert finished == ["search_wiki"]          # the shielded fetch completed


def test_preprints_fda_and_the_paired_gene_trial_search_are_all_capped():
    """Every tool path goes through the per-tool cap, including the newer ones:
    preprints, FDA approvals and the gene+disease trial pair (one capped unit)."""
    finished = []

    def slow(name):
        async def run(*a, **k):
            await asyncio.sleep(0.3)
            finished.append(name)
            return []
        return run

    names = ("search_preprints_async", "search_fda_async", "search_trials_with_gene_async")
    originals = {n: getattr(te, n) for n in names}
    originals["cap"] = te._TOOL_TIMEOUT
    for n in names:
        setattr(te, n, slow(n))
    te._TOOL_TIMEOUT = 0.05
    scope = {"topics": [], "genes": ["KRAS"], "diseases": ["pancreatic cancer"], "assets": [], "methods": []}

    async def body():
        sections = await te._execute(["search_preprints", "search_fda", "search_trials"], scope)
        assert finished == []
        await asyncio.sleep(0.4)
        return sections

    try:
        sections = asyncio.run(body())
    finally:
        for n in names:
            setattr(te, n, originals[n])
        te._TOOL_TIMEOUT = originals["cap"]

    assert [s["tool"] for s in sections] == ["search_preprints", "search_fda", "search_trials"]
    assert all(s["items"] == [] and s["timed_out"] is True for s in sections)
    assert sorted(finished) == sorted(names)     # all three kept running to completion


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for fn in fns:
        try:
            fn(); print(f"PASS  {fn.__name__}")
        except Exception as exc:
            failures += 1; print(f"FAIL  {fn.__name__}: {type(exc).__name__}: {exc}")
    print(f"\n{len(fns) - failures}/{len(fns)} passed")
    sys.exit(1 if failures else 0)
