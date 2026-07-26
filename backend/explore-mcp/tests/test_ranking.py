"""
tests/test_ranking.py — WINNER citation-graph ranking (ranking.py).

Covers the hand-built 5-paper graph (centrality must differ from citation-count
order), the guard rails (too-few-edges fallback, node cap, failure fallback), and
the graph-construction constraints the spike pinned down (edges only between
in-set papers, deduped pairs, string-only node ids).
"""

from __future__ import annotations

import pytest

from models import Item, Signal
from ranking import (
    MIN_EDGES,
    NETWORK_RANK_METRIC,
    _build_edges,
    _work_index,
    graph_stats,
    rank_papers_winner,
    relevance_seed_ids,
)


def _paper(work: str, *, title: str = "", cites: list[str] | None = None,
           citations: float | None = None, summary: str = "") -> Item:
    """An OpenAlex-shaped paper item. `cites` are OpenAlex work ids."""
    raw: dict = {"id": f"https://openalex.org/{work}"}
    if cites is not None:
        raw["referenced_works"] = [f"https://openalex.org/{c}" for c in cites]
    return Item(
        id=f"openalex:{work}",
        kind="paper",
        title=title or f"Paper {work}",
        summary=summary,
        url=f"https://openalex.org/{work}",
        source="openalex",
        date_iso="2024-01-01T00:00:00.000Z",
        signal=(Signal(metric="citations", value=citations, as_of="2024-01-01T00:00:00.000Z")
                if citations is not None else None),
        dedupe_key=f"url:openalex.org/{work}",
        raw=raw,
    )


# ── the 5-paper hand-built graph ──────────────────────────────────────────────
#
# W3 is the HUB: every other paper cites it, so it is the most central to the
# seed set. But W5 carries the largest raw citation count (999) while sitting on
# the rim, citing only W4. A citation-count sort puts W5 first; WINNER must not.
#
#   W1 ─┐
#   W2 ─┼─> W3   (W1, W2, W4 all cite W3;  W3 cites W1)
#   W4 ─┘
#   W5 ──> W4    (rim: high citation count, low centrality)
def _five_paper_graph() -> list[Item]:
    return [
        _paper("W5", cites=["W4"], citations=999.0),   # most-cited, least central
        _paper("W3", cites=["W1"], citations=10.0),    # hub
        _paper("W1", cites=["W3"], citations=5.0),
        _paper("W2", cites=["W3"], citations=4.0),
        _paper("W4", cites=["W3", "W1"], citations=3.0),
    ]


def test_hub_outranks_the_most_cited_paper():
    items = _five_paper_graph()
    seeds = {"openalex:W1", "openalex:W2", "openalex:W4"}

    out = rank_papers_winner(items, seeds)
    order = [i.id for i in out]

    # Citation order would be W5 (999) first; centrality must not agree.
    citation_order = [i.id for i in sorted(
        items, key=lambda i: i.signal.value, reverse=True)]
    assert citation_order[0] == "openalex:W5"
    assert order != citation_order, "WINNER order is identical to citation order"

    # The hub every seed cites ranks above the high-citation rim paper.
    assert order.index("openalex:W3") < order.index("openalex:W5")


def test_connected_papers_get_a_network_rank_signal():
    items = _five_paper_graph()
    out = rank_papers_winner(items, {"openalex:W1", "openalex:W2"})

    ranked = [i for i in out if i.signal and i.signal.metric == NETWORK_RANK_METRIC]
    assert ranked, "no network_rank signal attached"
    # Scores are descending across the ranked block.
    values = [i.signal.value for i in ranked]
    assert values == sorted(values, reverse=True)
    assert all(v > 0 for v in values)


def test_prior_citation_signal_is_preserved_in_raw():
    items = _five_paper_graph()
    out = rank_papers_winner(items, {"openalex:W1"})
    hub = next(i for i in out if i.id == "openalex:W3")

    assert hub.signal.metric == NETWORK_RANK_METRIC
    assert hub.raw["prior_signal"]["metric"] == "citations"
    assert hub.raw["prior_signal"]["value"] == 10.0


# ── guard rails ───────────────────────────────────────────────────────────────


def test_too_few_edges_falls_back_and_attaches_no_signal():
    """A recency-style set that barely cites itself must keep the existing order
    and must NOT be labelled network-ranked."""
    items = [
        _paper("W1", cites=["W999"], citations=50.0),   # cites outside the set
        _paper("W2", cites=[], citations=40.0),
        _paper("W3", cites=["W888"], citations=30.0),
    ]
    out = rank_papers_winner(items, {"openalex:W1"})

    assert [i.id for i in out] == [i.id for i in items], "order changed on a sparse graph"
    assert all(
        i.signal is None or i.signal.metric != NETWORK_RANK_METRIC for i in out
    ), "network_rank attached despite too few edges"


def test_edges_below_threshold_is_the_boundary():
    stats = graph_stats(_five_paper_graph())
    assert stats["edges"] < MIN_EDGES or stats["meets_min_edges"]
    # the 5-paper fixture is deliberately above the floor
    assert stats["edges"] >= MIN_EDGES


def test_references_outside_the_result_set_are_dropped():
    items = [
        _paper("W1", cites=["W2", "W404", "W405"]),
        _paper("W2", cites=["W404"]),
    ]
    index = _work_index(items)
    edges = _build_edges(items, index)
    assert edges == [("openalex:W1", "openalex:W2")]


def test_mutual_citations_produce_one_deduped_edge():
    items = [_paper("W1", cites=["W2"]), _paper("W2", cites=["W1"])]
    edges = _build_edges(items, _work_index(items))
    assert len(edges) == 1
    assert edges[0] == ("openalex:W1", "openalex:W2")


def test_repeated_reference_does_not_duplicate_an_edge():
    items = [_paper("W1", cites=["W2", "W2", "W2"]), _paper("W2", cites=[])]
    assert len(_build_edges(items, _work_index(items))) == 1


def test_self_citation_is_ignored():
    items = [_paper("W1", cites=["W1", "W2"]), _paper("W2", cites=[])]
    edges = _build_edges(items, _work_index(items))
    assert edges == [("openalex:W1", "openalex:W2")]


def test_node_ids_are_all_strings():
    """Constraint 5 — int/str ids must never mix in the pandas index."""
    items = _five_paper_graph()
    index = _work_index(items)
    edges = _build_edges(items, index)
    assert all(isinstance(n, str) for pair in edges for n in pair)
    assert all(isinstance(k, str) and isinstance(v, str) for k, v in index.items())


def test_papers_without_referenced_works_survive_unranked():
    """A paper with no refs is isolated: it keeps its own signal and is not
    dropped from the result."""
    items = _five_paper_graph() + [_paper("W9", citations=7.0)]
    out = rank_papers_winner(items, {"openalex:W1"})

    assert len(out) == len(items)
    lonely = next(i for i in out if i.id == "openalex:W9")
    assert lonely.signal.metric == "citations", "isolated paper was mislabelled"


def test_empty_and_single_item_inputs_are_safe():
    assert rank_papers_winner([], set()) == []
    one = [_paper("W1", cites=["W2"])]
    assert rank_papers_winner(one, set()) == one


def test_run_winner_failure_falls_back(monkeypatch):
    """WINNER must never break the feed."""
    import ranking

    def boom(*_a, **_k):
        raise RuntimeError("winner exploded")

    monkeypatch.setattr(ranking, "run_winner", boom)
    items = _five_paper_graph()
    out = ranking.rank_papers_winner(items, {"openalex:W1"})

    assert [i.id for i in out] == [i.id for i in items]
    assert all(i.signal is None or i.signal.metric != NETWORK_RANK_METRIC for i in out)


def test_node_cap_leaves_the_tail_untouched(monkeypatch):
    import ranking

    monkeypatch.setattr(ranking, "MAX_NODES", 5)
    items = _five_paper_graph() + [_paper(f"W1{i}", cites=[]) for i in range(4)]
    out = ranking.rank_papers_winner(items, {"openalex:W1"})

    assert len(out) == len(items)
    assert [i.id for i in out[-4:]] == [i.id for i in items[-4:]], "tail was reordered"


# ── seed selection ────────────────────────────────────────────────────────────


def test_seeds_prefer_title_matches():
    items = [
        _paper("W1", title="Unrelated methods work"),
        _paper("W2", title="EGFR signalling in glioblastoma"),
        _paper("W3", title="A study", summary="mentions glioblastoma once"),
    ]
    seeds = relevance_seed_ids(items, "EGFR glioblastoma", top_n=1)
    assert seeds == {"openalex:W2"}


def test_seeds_fall_back_to_existing_order_without_a_query():
    items = _five_paper_graph()
    seeds = relevance_seed_ids(items, "", top_n=2)
    assert seeds == {items[0].id, items[1].id}


def test_seed_stopwords_do_not_match_everything():
    items = [
        _paper("W1", title="The role of the cell in the pathway"),
        _paper("W2", title="EGFR inhibitors"),
    ]
    seeds = relevance_seed_ids(items, "the of in", top_n=1)
    # query is all stopwords -> falls back to head of existing order, not a
    # spurious match on W1's many "the"/"of"/"in" tokens
    assert seeds == {"openalex:W1"}
