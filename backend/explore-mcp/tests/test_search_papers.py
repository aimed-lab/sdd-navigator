"""
search_papers batch-isolation test: a failing source must NOT sink the others.

We stub the three source fetchers on the search_papers module — one raises, two
return items — and assert the merged result still contains the survivors, deduped
and sorted (signal desc, then date desc).

Runnable via pytest or directly (python tests/test_search_papers.py).
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tools.search_papers as sp  # noqa: E402
from models import Item, Signal  # noqa: E402


def _item(source, ext, *, signal=None, date="2024-01-01T00:00:00.000Z", key=None):
    return Item(
        id=f"{source}:{ext}",
        kind="paper",
        title=f"{source} {ext}",
        summary=None,
        url=f"https://example.org/{source}/{ext}",
        source=source,
        date_iso=date,
        signal=signal,
        dedupe_key=key or f"url:example.org/{source}/{ext}",
    )


def test_failing_source_does_not_sink_batch():
    async def ok_pubmed(client, q, limit, **kw):
        return [_item("pubmed", "1", date="2024-06-01T00:00:00.000Z")]

    async def boom_openalex(client, q, limit, **kw):
        raise RuntimeError("OpenAlex is down")

    async def ok_crossref(client, q, limit, **kw):
        return [_item("crossref", "1", date="2024-02-01T00:00:00.000Z")]

    orig = (sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref)
    sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref = ok_pubmed, boom_openalex, ok_crossref
    try:
        items = asyncio.run(sp.search_papers_async("anything", limit=10))
    finally:
        sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref = orig

    # OpenAlex raised, but the two healthy sources still returned.
    sources = sorted(it.source for it in items)
    assert sources == ["crossref", "pubmed"]
    # sorted by date desc among signal-less items -> pubmed (Jun) before crossref (Feb).
    assert [it.source for it in items] == ["pubmed", "crossref"]


def test_rank_interleave_does_not_let_signal_dominate_source():
    # Two cited papers (ranked by citations desc) and two uncited (ranked by date
    # desc). Rank-interleaving must put rank-0 of each group at the very top, so
    # the newest uncited paper and the top-cited paper both appear near the top —
    # NOT all cited papers first.
    async def ok_openalex(client, q, limit, **kw):
        return [
            _item("openalex", "hi", signal=Signal(metric="citations", value=100.0,
                  as_of="2024-01-01T00:00:00.000Z"), date="2020-01-01T00:00:00.000Z"),
            _item("openalex", "lo", signal=Signal(metric="citations", value=5.0,
                  as_of="2024-01-01T00:00:00.000Z"), date="2019-01-01T00:00:00.000Z"),
        ]

    async def ok_pubmed(client, q, limit, **kw):
        return [
            _item("pubmed", "new", date="2025-01-01T00:00:00.000Z"),
            _item("pubmed", "old", date="2018-01-01T00:00:00.000Z"),
        ]

    async def ok_crossref(client, q, limit, **kw):
        return []

    orig = (sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref)
    sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref = ok_pubmed, ok_openalex, ok_crossref
    try:
        items = asyncio.run(sp.search_papers_async("anything", limit=10))
    finally:
        sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref = orig

    ids = [it.id for it in items]
    # rank 0: newest-uncited (2025) vs top-cited (2020) -> tie broken by date desc.
    # rank 1: 2nd-cited (2019) vs 2nd-newest-uncited (2018) -> tie broken by date desc.
    assert ids == ["pubmed:new", "openalex:hi", "openalex:lo", "pubmed:old"]
    # intra-group order preserved: top-cited before lesser-cited; newest before oldest.
    assert ids.index("openalex:hi") < ids.index("openalex:lo")
    assert ids.index("pubmed:new") < ids.index("pubmed:old")


def test_search_papers_requests_the_relevance_sort():
    """search_papers must ask OpenAlex for RELEVANCE, not recency — a
    recency-sorted set has ~zero intra-set citations, so the WINNER graph comes
    back empty and the ranking silently degrades to a no-op."""
    from sources.openalex import SORT_RELEVANCE

    captured = {}

    async def none_pubmed(client, q, limit, **kw):
        return []

    async def spy_openalex(client, q, limit, **kw):
        captured["sort"] = kw.get("sort", "NOT PASSED")
        return []

    async def none_crossref(client, q, limit, **kw):
        return []

    orig = (sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref)
    sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref = (
        none_pubmed, spy_openalex, none_crossref)
    try:
        asyncio.run(sp.search_papers_async("EGFR glioblastoma", limit=5))
    finally:
        sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref = orig

    assert captured["sort"] is SORT_RELEVANCE


def test_since_year_is_threaded_to_every_source():
    """search_papers_async(query, limit, since_year) must pass since_year to
    all three source fetchers — the date-filtering fix this test file is
    otherwise silent about."""
    captured = {}

    async def spy_pubmed(client, q, limit, **kw):
        captured["pubmed"] = kw.get("since_year", "NOT PASSED")
        return []

    async def spy_openalex(client, q, limit, **kw):
        captured["openalex"] = kw.get("since_year", "NOT PASSED")
        return []

    async def spy_crossref(client, q, limit, **kw):
        captured["crossref"] = kw.get("since_year", "NOT PASSED")
        return []

    orig = (sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref)
    sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref = spy_pubmed, spy_openalex, spy_crossref
    try:
        asyncio.run(sp.search_papers_async("anything", limit=10, since_year=2024))
    finally:
        sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref = orig

    assert captured == {"pubmed": 2024, "openalex": 2024, "crossref": 2024}


def test_since_year_none_is_unchanged_behavior():
    """Omitting since_year must send None through to every source (today's
    behavior, byte-for-byte) rather than some other default."""
    captured = {}

    async def spy_pubmed(client, q, limit, **kw):
        captured["pubmed"] = kw.get("since_year", "NOT PASSED")
        return []

    async def spy_openalex(client, q, limit, **kw):
        captured["openalex"] = kw.get("since_year", "NOT PASSED")
        return []

    async def spy_crossref(client, q, limit, **kw):
        captured["crossref"] = kw.get("since_year", "NOT PASSED")
        return []

    orig = (sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref)
    sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref = spy_pubmed, spy_openalex, spy_crossref
    try:
        asyncio.run(sp.search_papers_async("anything", limit=10))
    finally:
        sp.fetch_pubmed, sp.fetch_openalex, sp.fetch_crossref = orig

    assert captured == {"pubmed": None, "openalex": None, "crossref": None}


def test_multi_selected_uses_ranked_pool_not_capped_date_order():
    """_multi_selected must draw each sub-query's contribution from
    _ranked_pool (WINNER's own order, uncapped) — NOT from
    search_papers_async's return value, which is already date-sorted and
    capped to limit_per_query by _order_and_cap. Regression test for the
    diagnosed bug: round-robin was drawing from 10-item, WINNER-blind,
    date-ordered lists instead of each sub-query's real ranked pool.

    Stub _ranked_pool with an 11th-ranked item that would NOT survive
    search_papers_async's cap-to-10-by-date; assert it's still selectable
    by round-robin, and assert search_papers_async is never called at all
    for a multi-query fan-out.
    """
    gene_a_pool = [_item("openalex", f"a{i}", date="2020-01-01T00:00:00.000Z")
                   for i in range(11)]  # WINNER/rank order: a0 (best) .. a10 (11th)
    gene_b_pool = [_item("openalex", "b0", date="2020-01-01T00:00:00.000Z")]

    calls = {"ranked_pool": [], "search_papers_async": 0}

    async def fake_ranked_pool(query, limit, since_year):
        calls["ranked_pool"].append(query)
        return gene_a_pool if query == "geneA" else gene_b_pool

    async def fail_search_papers_async(*a, **kw):
        calls["search_papers_async"] += 1
        raise AssertionError("_multi_selected must not call search_papers_async")

    orig_ranked_pool = sp._ranked_pool
    orig_search_papers_async = sp.search_papers_async
    sp._ranked_pool = fake_ranked_pool
    sp.search_papers_async = fail_search_papers_async
    try:
        selected = asyncio.run(
            sp._multi_selected(["geneA", "geneB"], limit_per_query=10, final_limit=12,
                                since_year=None)
        )
    finally:
        sp._ranked_pool = orig_ranked_pool
        sp.search_papers_async = orig_search_papers_async

    assert calls["search_papers_async"] == 0
    assert sorted(calls["ranked_pool"]) == ["geneA", "geneB"]
    ids = {it.id for it in selected}
    # geneA's 11th-best (a10) is only reachable if round-robin drew from the
    # UNCAPPED 11-item pool, not a date-capped-to-10 one — final_limit=12
    # with round-robin (a-then-b alternating) reaches a10 on geneA's 11th turn.
    assert "openalex:a10" in ids


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS  {fn.__name__}")
        except AssertionError as exc:
            failures += 1
            print(f"FAIL  {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failures}/{len(fns)} passed")
    sys.exit(1 if failures else 0)
