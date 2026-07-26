"""
ranking.py — WINNER network ranking over the paper citation graph.

Ranks a result set by how CENTRAL each paper is to the citation graph the set
forms among itself, rather than by raw citation count. Papers = nodes, citations
= edges (from `referenced_works`, captured in `raw` by sources/openalex.py and
preserved across merges by dedupe.py).

Uses `winner.run_winner` (the no-p-value pipeline). The p-value pipeline is
deliberately NOT used in v1: it requires a `global_degree` map — each candidate's
degree in the WHOLE corpus — which has no analogue for a paper subgraph, and
without it every expansion candidate scores p=1.0 and is dropped.

Constraints this module works around (all observed, not assumed):
  1. WINNER is UNDIRECTED — build_adjacency writes adj[i,j] = adj[j,i]. Citation
     direction is lost, so "A cites B" and "B cites A" rank identically.
  2. Only edges whose BOTH endpoints are in the node list survive, so references
     to papers outside the result set contribute nothing and are dropped here.
  3. Duplicate edges are last-write-wins (not summed), so pairs are deduped here.
  4. Adjacency is a dense float64 (N, N) — O(N^2) memory. Hence MAX_NODES.
  5. Node ids are pandas index keys: they must all be the same type. Everything
     is stringified through `_node_id`; int and str ids are never mixed.

Signal integrity (see models.py): a `network_rank` signal is attached ONLY to
papers that are actually connected in the graph (score > 0). An isolated paper
keeps whatever signal it already had, so nothing is ever labelled
"network-ranked" on the basis of an empty graph.
"""

from __future__ import annotations

import re
from typing import Iterable, Sequence

from models import Item, Signal
from sources.base import now_iso

# `winner` (and pandas) are optional at import time: the ranking must degrade to
# the existing sort if the package isn't installed, never break the server.
try:  # pragma: no cover - import-guard
    import pandas as pd
    from winner import run_winner

    _WINNER_AVAILABLE = True
    _WINNER_IMPORT_ERROR: str | None = None
except Exception as exc:  # pragma: no cover - import-guard
    _WINNER_AVAILABLE = False
    _WINNER_IMPORT_ERROR = str(exc)


NETWORK_RANK_METRIC = "network_rank"

# Below this many usable edges the result set barely cites itself and WINNER adds
# nothing over the existing sort — we fall back and attach NO signal rather than
# present a meaningless "network-ranked" order. Recency-heavy queries land here.
MIN_EDGES = 5

# Dense O(N^2) adjacency: 2000 nodes ~ 32 MB, which is the practical ceiling for
# an interactive request. Larger sets are truncated to the top MAX_NODES by the
# caller's existing order (already best-first) and the tail is left untouched.
MAX_NODES = 2000

_OPENALEX_WORK_RE = re.compile(r"(W\d+)\s*$", re.IGNORECASE)
_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = {"in", "of", "the", "a", "and", "for", "on", "to", "with", "by"}


# ── ids ───────────────────────────────────────────────────────────────────────


def _node_id(item: Item) -> str:
    """The node id for an item — always its stable Item.id, always a str."""
    return str(item.id)


def _openalex_work_id(value: object) -> str | None:
    """Extract an OpenAlex work id ('W2741809807') from a work URL, a bare id, or
    our own 'openalex:W…' item id. Returns None when there isn't one."""
    if not isinstance(value, str) or not value:
        return None
    m = _OPENALEX_WORK_RE.search(value.strip())
    return m.group(1).upper() if m else None


def _work_index(items: Sequence[Item]) -> dict[str, str]:
    """Map OpenAlex work id -> our node id, so a `referenced_works` URL can be
    resolved back to an item in this result set.

    An item exposes a work id via its own `openalex:W…` id or via `raw["id"]`
    (the full OpenAlex work URL) — the latter also covers merged items whose
    surviving id came from PubMed/Crossref but which carry OpenAlex raw."""
    index: dict[str, str] = {}
    for item in items:
        node = _node_id(item)
        candidates = (
            item.id if str(item.id).startswith("openalex:") else None,
            (item.raw or {}).get("id"),
        )
        for candidate in candidates:
            work = _openalex_work_id(candidate)
            if work and work not in index:
                index[work] = node
    return index


# ── graph ─────────────────────────────────────────────────────────────────────


def _build_edges(items: Sequence[Item], index: dict[str, str]) -> list[tuple[str, str]]:
    """Citation edges between papers IN this result set, deduped and undirected.

    Each paper's `referenced_works` are its outbound citations; a reference is
    kept only when it resolves to another node here (constraint 2). Pairs are
    normalised (sorted) and de-duplicated so a mutual citation or a repeated
    reference can't overwrite an edge weight (constraint 3)."""
    seen: set[tuple[str, str]] = set()
    edges: list[tuple[str, str]] = []

    for item in items:
        src = _node_id(item)
        refs = (item.raw or {}).get("referenced_works")
        if not isinstance(refs, (list, tuple)):
            continue
        for ref in refs:
            work = _openalex_work_id(ref)
            if not work:
                continue
            dst = index.get(work)
            if not dst or dst == src:      # outside the set, or a self-loop
                continue
            pair = (src, dst) if src < dst else (dst, src)
            if pair in seen:
                continue
            seen.add(pair)
            edges.append(pair)

    return edges


# ── seeds ─────────────────────────────────────────────────────────────────────


def _tokens(text: str) -> set[str]:
    return {t for t in _TOKEN_RE.findall((text or "").lower()) if t not in _STOPWORDS}


def relevance_seed_ids(items: Sequence[Item], query: str, top_n: int = 10) -> set[str]:
    """Pick the `top_n` items whose title+summary best match `query` as WINNER
    seeds ("S"); everything else is an expansion candidate ("E").

    Scored by query-token overlap, title weighted double (a title hit is a
    stronger topical signal than an abstract hit), ties broken by the item's
    existing position — which is already the best-first order from _rank_merge."""
    q = _tokens(query)
    if not q or not items:
        # No usable query — seed with the head of the existing ranking instead.
        return {_node_id(i) for i in items[:top_n]}

    scored: list[tuple[float, int, str]] = []
    for pos, item in enumerate(items):
        title_hits = len(q & _tokens(item.title))
        summary_hits = len(q & _tokens(item.summary or ""))
        scored.append((-(title_hits * 2 + summary_hits), pos, _node_id(item)))

    scored.sort()
    return {node for _, _, node in scored[:top_n]}


# ── ranking ───────────────────────────────────────────────────────────────────


def _apply_scores(
    items: Sequence[Item],
    scores: dict[str, float],
) -> list[Item]:
    """Attach network_rank to CONNECTED papers and order them by score desc;
    unconnected papers keep their original signal and their original relative
    order, after the ranked ones."""
    as_of = now_iso()
    ranked: list[tuple[float, int, Item]] = []
    unranked: list[Item] = []

    for pos, item in enumerate(items):
        score = scores.get(_node_id(item), 0.0)
        if score > 0:
            raw = dict(item.raw or {})
            # Keep the metric we're replacing so the citation count isn't lost.
            if item.signal is not None:
                raw["prior_signal"] = item.signal.model_dump()
            ranked.append((
                -score,
                pos,
                item.model_copy(update={
                    "signal": Signal(metric=NETWORK_RANK_METRIC, value=float(score), as_of=as_of),
                    "raw": raw,
                }),
            ))
        else:
            unranked.append(item)

    ranked.sort(key=lambda t: (t[0], t[1]))
    return [item for _, _, item in ranked] + unranked


def rank_papers_winner(items: list[Item], seed_ids: set[str]) -> list[Item]:
    """Re-rank `items` by WINNER centrality over their own citation graph.

    Returns a NEW list. Falls back to `items` unchanged — with no network_rank
    signal attached — whenever the ranking would not be meaningful:
      * the winner package isn't importable
      * fewer than MIN_EDGES usable citation edges (the set barely cites itself)
      * run_winner raises for any reason

    `seed_ids` are node ids (Item.id) marked "S"; everything else is "E".
    """
    if not _WINNER_AVAILABLE or len(items) < 2:
        return items

    try:
        # Constraint 4: cap the graph. `items` arrives best-first, so the head is
        # the top of the existing ranking; the tail passes through untouched.
        head = items[:MAX_NODES]
        tail = items[MAX_NODES:]

        index = _work_index(head)
        edges = _build_edges(head, index)

        # Guard rail: too sparse to mean anything -> existing sort, no signal.
        if len(edges) < MIN_EDGES:
            return items

        nodes = [_node_id(i) for i in head]
        genes = pd.DataFrame({
            "gene": nodes,
            "seed_or_expand": ["S" if n in seed_ids else "E" for n in nodes],
        })
        interactions = pd.DataFrame({
            "gene1": [a for a, _ in edges],
            "gene2": [b for _, b in edges],
            "weight": [1.0] * len(edges),
        })

        result = run_winner(genes, interactions)
        scores = {
            name: float(score)
            for name, score in zip(result.gene_names, result.winner_score)
        }

        return _apply_scores(head, scores) + tail

    except Exception:
        # WINNER must never break the feed.
        return items


def graph_stats(items: Sequence[Item]) -> dict:
    """Edge/node counts for the citation graph `items` would form. Diagnostic
    only — used by tests and by the CLI probe, not by the request path."""
    head = list(items)[:MAX_NODES]
    index = _work_index(head)
    edges = _build_edges(head, index)
    connected = {n for pair in edges for n in pair}
    return {
        "nodes": len(head),
        "edges": len(edges),
        "connected_nodes": len(connected),
        "indexable_works": len(index),
        "winner_available": _WINNER_AVAILABLE,
        "winner_import_error": _WINNER_IMPORT_ERROR,
        "meets_min_edges": len(edges) >= MIN_EDGES,
    }
