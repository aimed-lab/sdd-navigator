"""
tools/search_opentargets.py — search Open Targets for target-disease evidence
against a gene target.

Wraps sources.opentargets.fetch_opentargets. kind="target", source="opentargets",
signal=None (no ranking metric — association score is not a citation/star
count). GENE-PRIMARY, DISEASE-FALLBACK — see fetch_opentargets's own docstring: `query`
is tried first as a gene/protein SYMBOL (Open Targets' own `search`), and
only falls back to resolving it as a disease name when that first resolution
fails. The source call is isolated — a failure degrades to an empty list rather than
raising, same pattern as search_chembl.py/search_trials.py/search_datasets.py.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import STALE_SOURCE, TTL_SOURCE, cache, normalize_key
from models import Item
from sources.opentargets import fetch_opentargets

logger = logging.getLogger(__name__)


async def search_opentargets_async(query: str, limit: int = 20, disease: str | None = None) -> list[Item]:
    """Cached + single-flighted (see _fetch). `query` is expected to be a gene
    symbol (e.g. "PHGDH") — see tools/explore.py's _QUERY_SLICES for how the
    orchestrator composes this tool's query. `disease` is the SEPARATE
    disease term from scope, threaded alongside `query` (not concatenated
    into it) so sources/opentargets.py can filter to that specific
    gene-disease pair — see that module's fetch_opentargets docstring and
    tools/explore.py's _execute (search_opentargets is special-cased there,
    same as search_papers/search_trials, to pass this second value through).
    Included in the cache key so a gene queried with vs. without a disease
    scope never collide."""
    key = normalize_key(f"opentargets:{limit}:{disease or ''}", query)
    return await cache.get_or_compute(
        key, lambda: _fetch(query, limit, disease), TTL_SOURCE, STALE_SOURCE
    )


async def _fetch(query: str, limit: int, disease: str | None = None) -> list[Item]:
    try:
        async with httpx.AsyncClient() as client:
            return await fetch_opentargets(client, query, limit, disease=disease)
    except Exception:
        logger.exception("search_opentargets: Open Targets fetch failed for query=%r", query)
        return []   # per-source isolation


def search_opentargets(query: str, limit: int = 20, disease: str | None = None) -> list[Item]:
    """Search Open Targets for target-disease evidence (score + evidence-type
    breakdown) and tractability against a gene target. `query` should be a
    gene symbol, e.g. "PHGDH". Returns up to `limit` Items (kind="target")."""
    return asyncio.run(search_opentargets_async(query, limit, disease))
