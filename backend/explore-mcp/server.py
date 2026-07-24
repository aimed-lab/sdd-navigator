"""
server.py — Explore MCP server (streamable-HTTP transport).

Exposes three tools to other agents over MCP:
  • search_papers        — live scientific literature search (PubMed/OpenAlex/Crossref)
  • search_lab_resources — the internal lab-resource registry (read-only; never contact_info)
  • explore              — orchestration: reason over free text, choose tools, group results

Tool DESCRIPTIONS matter — external agents read them to decide what to call, so
each docstring below is the tool's public contract. Read-only service: no writes
to Supabase, and no LLM SDK is imported here (that lives only in llm.py, reached
through the tools).

Config (env; loaded from .env):
  MCP_HOST (default 0.0.0.0), MCP_PORT (default 8000)
  LLM_PROVIDER / LLM_MODEL / LLM_API_KEY / GROQ_API_KEY  (see llm.py)
  SUPABASE_URL / SUPABASE_KEY                            (read-only; search_lab_resources)

Run:  python server.py      (serves MCP at /mcp, health at /health)
"""

from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from starlette.responses import JSONResponse

from tools.explore import explore_async
from tools.search_lab_resources import search_lab_resources as _search_lab_resources
from tools.search_papers import search_papers_async

load_dotenv()

HOST = os.environ.get("MCP_HOST", "0.0.0.0")
PORT = int(os.environ.get("MCP_PORT", "8000"))

mcp = FastMCP("explore-mcp", host=HOST, port=PORT)


@mcp.tool()
async def search_papers(query: str, limit: int = 20) -> list[dict]:
    """Search the live scientific literature for papers relevant to a topic.

    Fans out to PubMed, OpenAlex and Crossref in parallel and returns up to `limit`
    de-duplicated papers, ranked so the most-cited and the newest both surface near
    the top. Each item carries an evidence-backed `signal` ONLY when the source
    reported one (OpenAlex citation counts); PubMed/Crossref items have signal=null.
    Never treat a null-signal item as "most cited".

    Args:
        query: A topical query, e.g. "PHGDH Alzheimer's disease" or "EGFR glioblastoma".
        limit: Max items to return (default 20).
    """
    items = await search_papers_async(query, limit)
    return [item.model_dump() for item in items]


@mcp.tool()
async def search_lab_resources(query: str, category: str | None = None, limit: int = 20) -> list[dict]:
    """Search the INTERNAL lab-resource registry (read-only).

    Covers nine categories — person, technique, equipment, vector, animal_model,
    cell_line, protein_antibody, software, drug — available for collaboration. Use
    this for capabilities/techniques/models/reagents/software/people, NOT for a
    disease name. Matches `query` against each category's searchable fields; pass
    `category` to scope to one. contact_info is auth-gated and is NEVER returned.
    Results have kind="resource", source="internal", signal=null. The registry is
    small — few or zero results is normal.

    Args:
        query: A technique/method/capability/name query (empty string lists all).
        category: Optional category to scope to (one of the nine).
        limit: Max items to return (default 20).
    """
    items = await asyncio.to_thread(_search_lab_resources, query, category, limit)
    return [item.model_dump() for item in items]


@mcp.tool()
async def explore(input_text: str) -> dict:
    """Orchestrate a research query from free text.

    Reasons over the message to (1) extract a structured scope
    (topics/genes/diseases/assets/methods), (2) choose which search tools fit — one
    or several, not always both, (3) build the RIGHT query per tool (papers get the
    topic; lab resources get technique/model terms, not the disease), (4) run them
    in parallel, and (5) return results grouped by kind.

    Returns {input, scope, tools_called, sections:[{tool, kind, query, items}]}.
    Empty scope fields are expected and never invented.

    Args:
        input_text: The scientist's free-text message.
    """
    return await explore_async(input_text)


@mcp.custom_route("/health", methods=["GET"])
async def health(_request):
    return JSONResponse({"service": "explore-mcp", "status": "ok", "transport": "streamable-http"})


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
