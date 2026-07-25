"""
server.py — Explore MCP server (streamable-HTTP transport).

Exposes 8 tools to other agents over MCP (external agents such as Pleaser call
these directly to learn about papers, assays/trials, funding, datasets/tools,
internal resources, people, and podcast episodes):

  • search_papers        — live scientific literature (PubMed/OpenAlex/Crossref)
  • search_trials        — clinical trials (ClinicalTrials.gov)
  • search_grants        — federal funding opportunities (Grants.gov)
  • search_tools         — open-source software tools/repos (GitHub)
  • search_lab_resources — internal lab-resource registry (read-only; never contact_info)
  • search_people        — researchers: public platform profiles + internal collaborators
  • search_wiki          — internal podcast-derived episode wiki pages
  • explore              — orchestration: reason over free text, route to tools, group results

Tool DESCRIPTIONS matter — external agents read them to decide what to call, so
each docstring below is the tool's public contract. Read-only service: no writes
to Supabase, and no LLM SDK is imported here (that lives only in llm.py, reached
through the tools).

Config (env; loaded from .env):
  MCP_HOST (default 0.0.0.0), MCP_PORT (default 8000)
  LLM_PROVIDER / LLM_MODEL / LLM_API_KEY / GROQ_API_KEY  (see llm.py)
  SUPABASE_URL / SUPABASE_KEY  (read-only; search_lab_resources/people/wiki)
  GITHUB_TOKEN                 (optional; raises GitHub rate limits for search_tools)

Run:  python server.py      (serves MCP at /mcp, health at /health)
"""

from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from starlette.responses import JSONResponse

from tools.explore import explore_async
from tools.search_grants import search_grants_async
from tools.search_lab_resources import search_lab_resources as _search_lab_resources
from tools.search_papers import search_papers_async
from tools.search_people import search_people as _search_people
from tools.search_tools import search_tools_async
from tools.search_trials import search_trials_async
from tools.search_wiki import search_wiki as _search_wiki

load_dotenv()

HOST = os.environ.get("MCP_HOST", "0.0.0.0")
PORT = int(os.environ.get("MCP_PORT", "8000"))

mcp = FastMCP("explore-mcp", host=HOST, port=PORT)


# ── External-source tools ─────────────────────────────────────────────────────


@mcp.tool()
async def search_papers(query: str, limit: int = 20) -> list[dict]:
    """Search the live scientific literature for papers relevant to a topic.

    Fans out to PubMed, OpenAlex and Crossref in parallel and returns up to `limit`
    de-duplicated papers (DOI-merged across sources), ranked so the most-cited and
    the newest both surface near the top. Each item carries an evidence-backed
    `signal` ONLY when the source reported one (OpenAlex citation counts);
    PubMed/Crossref items have signal=null. Never treat a null-signal item as
    "most cited".

    Args:
        query: A topical query, e.g. "PHGDH Alzheimer's disease" or "EGFR glioblastoma".
        limit: Max items to return (default 20).
    """
    items = await search_papers_async(query, limit)
    return [item.model_dump() for item in items]


@mcp.tool()
async def search_trials(query: str, limit: int = 20) -> list[dict]:
    """Search ClinicalTrials.gov for clinical studies relevant to `query`.

    Returns up to `limit` studies (kind="trial"), most-recently-updated first, with
    NCT id, brief title, summary and a link to the study record. No ranking signal
    (signal=null).

    Args:
        query: A disease/intervention query, e.g. "glioblastoma".
        limit: Max items to return (default 20).
    """
    items = await search_trials_async(query, limit)
    return [item.model_dump() for item in items]


@mcp.tool()
async def search_grants(query: str, limit: int = 20) -> list[dict]:
    """Search Grants.gov for forecasted/posted federal funding opportunities.

    Returns up to `limit` opportunities (kind="grant") with title, funding agency,
    open date and a link to the opportunity. No ranking signal (signal=null).

    Args:
        query: A topic/method query, e.g. "glioblastoma" or "CRISPR screen".
        limit: Max items to return (default 20).
    """
    items = await search_grants_async(query, limit)
    return [item.model_dump() for item in items]


@mcp.tool()
async def search_tools(query: str, limit: int = 20) -> list[dict]:
    """Search GitHub for open-source software tools/repositories relevant to `query`.

    Returns up to `limit` repositories (kind="tool") ranked by stars, each carrying a
    REAL `signal` of metric="stars". Use this for methods/assays/data types the user
    wants software for (e.g. "single cell rna seq").

    Args:
        query: A technique/tool query, e.g. "single cell rna seq".
        limit: Max items to return (default 20).
    """
    items = await search_tools_async(query, limit)
    return [item.model_dump() for item in items]


# ── Internal (Supabase, read-only) tools ──────────────────────────────────────


@mcp.tool()
async def search_lab_resources(query: str, category: str | None = None, limit: int = 20) -> list[dict]:
    """Search the INTERNAL lab-resource registry (read-only).

    Covers nine categories — person, technique, equipment, vector, animal_model,
    cell_line, protein_antibody, software, drug — available for collaboration. Use
    this for capabilities/techniques/models/reagents/software, NOT for a disease
    name. Matches `query` against each category's searchable fields; pass `category`
    to scope to one. contact_info is auth-gated and is NEVER returned. Results have
    kind="resource", source="internal", signal=null. The registry is small — few or
    zero results is normal.

    Args:
        query: A technique/method/capability/name query (empty string lists all).
        category: Optional category to scope to (one of the nine).
        limit: Max items to return (default 20).
    """
    items = await asyncio.to_thread(_search_lab_resources, query, category, limit)
    return [item.model_dump() for item in items]


@mcp.tool()
async def search_people(query: str, limit: int = 20) -> list[dict]:
    """Find researchers relevant to `query` from two sources.

    Merges public platform researcher profiles (source="platform", linked at
    /researchers/<slug>) and internal-registry collaborators (source="internal").
    Both appear as kind="person" and are NOT deduped against each other. `email` is
    NEVER returned. signal=null.

    Args:
        query: A topic/expertise query, e.g. "cancer metabolism" (empty lists all public people).
        limit: Max items to return (default 20).
    """
    items = await asyncio.to_thread(_search_people, query, limit)
    return [item.model_dump() for item in items]


@mcp.tool()
async def search_wiki(query: str, limit: int = 20) -> list[dict]:
    """Search the INTERNAL podcast-derived episode wiki pages.

    Searches the 64 episode pages over title, description, concepts and tags, newest
    episode first. Returns kind="episode", source="internal", signal=null. The
    episode transcript is never returned (too large for a result item).

    Args:
        query: A topical query, e.g. "drug discovery" (empty lists all episodes).
        limit: Max items to return (default 20).
    """
    items = await asyncio.to_thread(_search_wiki, query, limit)
    return [item.model_dump() for item in items]


# ── Orchestration ─────────────────────────────────────────────────────────────


@mcp.tool()
async def explore(input_text: str) -> dict:
    """Orchestrate a research query from free text across all the search tools.

    Reasons over the message to (1) extract a structured scope
    (topics/genes/diseases/assets/methods), (2) route to the fitting tools — one or
    several, not always all, (3) build the RIGHT query per tool (papers/trials/grants
    get the disease+topic; tools/resources get the method+gene; people get
    disease+method; wiki gets the topic — never swapped), (4) run them in parallel,
    and (5) return results grouped by kind.

    Returns {input, scope, tools_called, reasoning, sections:[{tool, kind, query, items}]}.
    Prefer the individual tools when you know exactly what you want; use explore when
    you want the system to decide what's relevant.

    Args:
        input_text: The scientist's free-text message.
    """
    return await explore_async(input_text)


@mcp.custom_route("/health", methods=["GET"])
async def health(_request):
    return JSONResponse({"service": "explore-mcp", "status": "ok", "transport": "streamable-http"})


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
