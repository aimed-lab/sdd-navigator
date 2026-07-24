"""
models.py — pydantic models shared across the Explore MCP server.

`Item` is the single normalized result shape every tool returns; `Signal` is an
optional, evidence-backed ranking metric attached to an item.

IMPORTANT — signal integrity:
    A `Signal` represents a REAL metric the source actually reported (an OpenAlex
    citation count, a GitHub star count, a recency measure). A label like
    "most cited" / "trending" may ONLY be rendered when `signal is not None`.
    Never fabricate a signal to make an item look ranked — leave it None when the
    source gives no metric (PubMed and Crossref have none, so their items carry
    signal=None).
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class Signal(BaseModel):
    """An evidence-backed ranking metric for an Item. Presence is meaningful:
    if this is set, the value came from the source, not from us."""

    metric: str          # "citations" | "stars" | "recency"
    value: float
    as_of: str           # ISO timestamp/date the metric was observed


class Item(BaseModel):
    """One normalized result from any source or tool."""

    id: str                          # f"{source}:{external_id}"
    kind: str                        # paper|resource|tool|grant|trial|person|episode
    title: str
    summary: str | None = None
    url: str | None = None
    doi: str | None = None           # normalized DOI key form ("10.xxxx/yyy"), or None
    source: str                      # pubmed|openalex|crossref|internal
    date_iso: str | None = None
    signal: Signal | None = None     # None unless the source reported a real metric
    dedupe_key: str
    raw: dict = Field(default_factory=dict)
