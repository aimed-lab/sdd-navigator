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
    async def ok_pubmed(client, q, limit):
        return [_item("pubmed", "1", date="2024-06-01T00:00:00.000Z")]

    async def boom_openalex(client, q, limit):
        raise RuntimeError("OpenAlex is down")

    async def ok_crossref(client, q, limit):
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
    async def ok_openalex(client, q, limit):
        return [
            _item("openalex", "hi", signal=Signal(metric="citations", value=100.0,
                  as_of="2024-01-01T00:00:00.000Z"), date="2020-01-01T00:00:00.000Z"),
            _item("openalex", "lo", signal=Signal(metric="citations", value=5.0,
                  as_of="2024-01-01T00:00:00.000Z"), date="2019-01-01T00:00:00.000Z"),
        ]

    async def ok_pubmed(client, q, limit):
        return [
            _item("pubmed", "new", date="2025-01-01T00:00:00.000Z"),
            _item("pubmed", "old", date="2018-01-01T00:00:00.000Z"),
        ]

    async def ok_crossref(client, q, limit):
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
