"""
tools/search_trials.py — search ClinicalTrials.gov for studies.

Wraps sources.clinical_trials.fetch_trials. kind="trial", source="clinicaltrials",
signal=None (no ranking metric). The source call is isolated — a failure degrades
to an empty list rather than raising.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import STALE_SOURCE, TTL_SOURCE, cache, normalize_key
from models import Item
from sources.clinical_trials import fetch_trials

logger = logging.getLogger(__name__)

# NOTE: ClinicalTrials.gov's CDN 403s a custom User-Agent (and even a browser-like
# one), but allows httpx's default UA. So we do NOT override User-Agent here; we
# only ask for JSON explicitly.
_HEADERS = {"Accept": "application/json"}


async def search_trials_async(
    query: str, limit: int = 20, status_filter: list[str] | None = None,
    condition_only: bool = False, extra_term: str | None = None,
) -> list[Item]:
    """Cached + single-flighted (see _fetch). `status_filter` (e.g.
    ["TERMINATED", "WITHDRAWN"]) is part of the cache key — a status-filtered
    search and an unfiltered one for the same term are different results and
    must not share a cache entry. `condition_only` (query.cond instead of
    query.term) is keyed the same way, as is `extra_term` (query.cond +
    query.term together)."""
    status_key = ",".join(status_filter) if status_filter else ""
    mode_key = "cond" if condition_only else "term"
    if condition_only and extra_term:
        mode_key += f"+{extra_term.strip().lower()}"
    key = normalize_key(f"trials:{limit}:{status_key}:{mode_key}", query)
    return await cache.get_or_compute(
        key, lambda: _fetch(query, limit, status_filter, condition_only, extra_term), TTL_SOURCE, STALE_SOURCE
    )


async def _fetch(
    query: str, limit: int, status_filter: list[str] | None = None, condition_only: bool = False,
    extra_term: str | None = None,
) -> list[Item]:
    try:
        async with httpx.AsyncClient(headers=_HEADERS) as client:
            return await fetch_trials(client, query, limit, status_filter, condition_only, extra_term)
    except Exception:
        logger.exception("search_trials: clinicaltrials.gov fetch failed for query=%r", query)
        return []   # per-source isolation


def merge_trials(gene_matched: list[Item], condition_only: list[Item], limit: int) -> list[Item]:
    """Gene-matched trials first, then the condition-only ones to fill up to
    `limit`, de-duplicated by NCT id. An empty gene-matched list gives just the
    condition-only list."""
    seen: set[str] = set()
    merged: list[Item] = []
    for it in [*gene_matched, *condition_only]:
        nct = (it.raw or {}).get("nct_id") or it.id
        if nct in seen:
            continue
        seen.add(nct)
        merged.append(it)
        if len(merged) >= limit:
            break
    return merged


async def search_trials_with_gene_async(
    condition: str, gene: str, limit: int = 20, status_filter: list[str] | None = None
) -> list[Item]:
    """For a scope with BOTH a disease and a gene: (a) condition + gene as
    term and (b) condition only, in parallel, merged by merge_trials(). The
    status filter applies to both."""
    gene_matched, condition_only = await asyncio.gather(
        search_trials_async(condition, limit, status_filter, condition_only=True, extra_term=gene),
        search_trials_async(condition, limit, status_filter, condition_only=True),
    )
    return merge_trials(gene_matched, condition_only, limit)


def search_trials(query: str, limit: int = 20, status_filter: list[str] | None = None) -> list[Item]:
    """Search ClinicalTrials.gov for clinical studies relevant to `query`.
    Returns up to `limit` Items (kind="trial"). `status_filter`, when given, is
    forwarded to the v2 API's `filter.overallStatus` (e.g. ["TERMINATED",
    "WITHDRAWN"]) — filtered server-side, not fetched-then-discarded here."""
    return asyncio.run(search_trials_async(query, limit, status_filter))
