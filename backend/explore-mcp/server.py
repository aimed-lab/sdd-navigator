"""
server.py — Explore MCP server (streamable-HTTP transport).

Exposes 9 tools to other agents over MCP (external agents such as Pleaser call
these directly to learn about papers, news, assays/trials, funding,
datasets/tools, internal resources, people, and podcast episodes):

  • search_papers        — live scientific literature (PubMed/OpenAlex/Crossref)
  • search_news          — recency-first industry news for the field (OpenAlex, newest first)
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
import logging
import os
import sys

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from starlette.responses import JSONResponse

import prewarm
from cache import cache as _cache
from response import trim_explore_result, trim_items
from tools.explore import explore_async
from tools.search_grants import search_grants_async
from tools.search_lab_resources import search_lab_resources as _search_lab_resources
from tools.search_news import search_news_async
from tools.search_papers import search_papers_async
from tools.search_people import search_people as _search_people
from tools.search_tools import search_tools_async
from tools.search_trials import search_trials_async
from tools.search_wiki import get_wiki_page as _get_wiki_page
from tools.search_wiki import search_wiki as _search_wiki

load_dotenv()

# ── Logging ──────────────────────────────────────────────────────────────────
# Single setup point for the whole service: stdout (containers collect stdout,
# not files), one line per record with timestamp/level/logger name so a failure
# can be traced to its module. Level from LOG_LEVEL (default INFO). Every module
# gets its own logger via logging.getLogger(__name__); this call just configures
# the shared root handler they all funnel into.
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    stream=sys.stdout,
)

# basicConfig sets the ROOT level, which every third-party logger inherits too —
# including httpx's OWN request logger, which prints "HTTP Request: <method>
# <FULL URL>" at INFO. NCBI_API_KEY and OPENALEX_EMAIL ride in query strings
# (see sources/pubmed.py, sources/openalex.py), so at the default LOG_LEVEL=INFO
# httpx was printing both in plaintext on every request — a leak the redaction
# in sources/base.py never covered, because that redaction only touches OUR
# exception messages, not httpx's own request/response logging.
# Pin every third-party logger we depend on to WARNING, UNCONDITIONALLY (not
# derived from LOG_LEVEL): our own DEBUG needs are for OUR modules, not for
# relogging every outbound request with its secrets attached. If you're
# debugging a specific library and need its own logs back, raise that one
# logger by name in your local environment — do not delete this block or
# raise the whole root level, that reopens the leak.
for _name in ("httpx", "httpcore", "groq", "openai", "urllib3", "requests"):
    logging.getLogger(_name).setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

HOST = os.environ.get("MCP_HOST", "0.0.0.0")
PORT = int(os.environ.get("MCP_PORT", "8000"))

mcp = FastMCP("explore-mcp", host=HOST, port=PORT)


# ── Limit clamping ──────────────────────────────────────────────────────────────
# The MCP tools below used to accept an UNBOUNDED `limit` — a caller could pass
# 5000 and get an unbounded upstream fan-out, unbounded memory, and an unbounded
# response payload. The HTTP bridge routes (/api/papers, /api/wiki) already clamp
# their own `limit`; MCP clients are just as much a primary consumer of this
# service as the HTTP routes (see module docstring), so they get the same
# treatment here rather than being the one unguarded path in.
#
# Two ceilings, not one, because the two ALREADY-SHIPPED HTTP ceilings genuinely
# differ and for a real reason:
#   MAX_LIMIT (50)       — /api/papers' existing ceiling. Applies to every tool
#                          that fans out to a LIVE upstream API per call
#                          (papers/news/trials/grants/tools) plus the two
#                          Supabase-backed tools that don't have their own HTTP
#                          route (lab_resources/people) — same conservative
#                          bound, since the risk (unbounded upstream work +
#                          payload) is the same.
#   MAX_WIKI_LIMIT (500)  — /api/wiki's existing ceiling. search_wiki alone: no
#                          live upstream fan-out (Supabase's own row cap is
#                          fixed elsewhere, independent of this `limit`), and
#                          the whole table is ~64 episodes — 500 is already
#                          effectively "no limit" for this dataset, so there's
#                          no reason to shrink it below what /api/wiki already
#                          ships.
MAX_LIMIT = 50
MAX_WIKI_LIMIT = 500


def _clamp_limit(limit: int, *, ceiling: int, default: int, tool: str) -> int:
    """Defensive clamp for an MCP tool's caller-supplied `limit`.

    Never errors — an agent should get useful results, not a rejection. Missing/
    non-numeric/zero/negative falls back to `default` silently (that's normal
    usage, not a problem). Anything over `ceiling` is capped there AND logged at
    INFO with both the requested and served values, since a caller expecting
    `limit` items back deserves to know it got fewer.
    """
    try:
        value = int(limit)
    except (TypeError, ValueError):
        value = default
    if value <= 0:
        value = default
    if value > ceiling:
        logger.info("%s: requested limit=%d exceeds ceiling, serving %d instead", tool, value, ceiling)
        value = ceiling
    return value


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
        limit: Max items to return (default 20, capped at 50).
    """
    limit = _clamp_limit(limit, ceiling=MAX_LIMIT, default=20, tool="search_papers")
    items = await search_papers_async(query, limit)
    return [item.model_dump() for item in items]


@mcp.tool()
async def search_news(query: str, limit: int = 20) -> list[dict]:
    """Recency-first industry news for the drug-discovery field.

    Returns the most RECENT OpenAlex works matching `query`, newest first
    (kind="news", source="openalex") — sorted by publication date, not relevance.
    Use this for "what's new" / field-level updates rather than a targeted
    literature search. Citations Signal is set where OpenAlex reports one, else null.

    Args:
        query: A field/topic query, e.g. "drug discovery" or "AI in drug discovery".
        limit: Max items to return (default 20, capped at 50).
    """
    limit = _clamp_limit(limit, ceiling=MAX_LIMIT, default=20, tool="search_news")
    items = await search_news_async(query, limit)
    return [item.model_dump() for item in items]


@mcp.tool()
async def search_trials(query: str, limit: int = 20) -> list[dict]:
    """Search ClinicalTrials.gov for clinical studies relevant to `query`.

    Returns up to `limit` studies (kind="trial"), most-recently-updated first, with
    NCT id, brief title, summary and a link to the study record. No ranking signal
    (signal=null).

    Args:
        query: A disease/intervention query, e.g. "glioblastoma".
        limit: Max items to return (default 20, capped at 50).
    """
    limit = _clamp_limit(limit, ceiling=MAX_LIMIT, default=20, tool="search_trials")
    items = await search_trials_async(query, limit)
    return [item.model_dump() for item in items]


@mcp.tool()
async def search_grants(query: str, limit: int = 20) -> list[dict]:
    """Search Grants.gov for forecasted/posted federal funding opportunities.

    Returns up to `limit` opportunities (kind="grant") with title, funding agency,
    open date and a link to the opportunity. No ranking signal (signal=null).

    Args:
        query: A topic/method query, e.g. "glioblastoma" or "CRISPR screen".
        limit: Max items to return (default 20, capped at 50).
    """
    limit = _clamp_limit(limit, ceiling=MAX_LIMIT, default=20, tool="search_grants")
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
        limit: Max items to return (default 20, capped at 50).
    """
    limit = _clamp_limit(limit, ceiling=MAX_LIMIT, default=20, tool="search_tools")
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
        limit: Max items to return (default 20, capped at 50).
    """
    limit = _clamp_limit(limit, ceiling=MAX_LIMIT, default=20, tool="search_lab_resources")
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
        limit: Max items to return (default 20, capped at 50).
    """
    limit = _clamp_limit(limit, ceiling=MAX_LIMIT, default=20, tool="search_people")
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
        limit: Max items to return (default 20, capped at 500).
    """
    limit = _clamp_limit(limit, ceiling=MAX_WIKI_LIMIT, default=20, tool="search_wiki")
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
    """Liveness ONLY — "is this process up". Zero dependencies: no Groq, no
    Supabase, no upstream source, and deliberately no dependency on prewarm's
    warm state either. Always 200 the instant the process can answer a
    request. See /ready for "has it finished warming"."""
    return JSONResponse({"service": "explore-mcp", "status": "ok", "transport": "streamable-http"})


@mcp.custom_route("/ready", methods=["GET"])
async def ready(_request):
    """Readiness — distinct from liveness (/health above). 200 once the first
    landing-feed warm has FINISHED, whether it succeeded, failed, or timed
    out (see prewarm._first_warm_and_ready — availability beats warmth, so a
    failed warm still flips this to ready rather than leaving the service
    stuck unready). 503 while still warming. PREWARM_ENABLED=false means
    there is nothing to wait for, so this is 200 immediately in that case
    too. The body carries enough to diagnose a stuck deploy on its own."""
    info = prewarm.ready_info()
    return JSONResponse(info, status_code=200 if info["ready"] else 503)


@mcp.custom_route("/cache/stats", methods=["GET"])
async def cache_stats(_request):
    """Cache counters — hits / stale_hits / misses / coalesced / refreshes, plus
    `upstream_calls` (misses + refreshes). Operational visibility, and how the
    'a cache hit made no upstream calls' claim is actually verified."""
    return JSONResponse({"entries": len(_cache), **_cache.stats.as_dict()})


@mcp.custom_route("/cache/prewarm", methods=["GET"])
async def prewarm_status(_request):
    """Landing-feed pre-warm status: enabled, interval, run/failure counts."""
    return JSONResponse(prewarm.status())


@mcp.custom_route("/api/explore", methods=["POST"])
async def explore_http(request):
    """Plain-HTTP bridge to explore() for the Next.js proxy.

    The `explore` tool above is only reachable over the MCP protocol (/mcp); the
    web app speaks normal HTTP, so this route exposes the SAME explore_async()
    over a plain POST { "input": "<free text>" } -> the full explore JSON
    (input, scope, tools_called, reasoning, sections). Never 500s the caller:
    on failure it returns the empty-sections shape with HTTP 200.

    Optional `scope`: a list of terms that PERSONALIZES the blank-input landing
    feed (the Next proxy fills it from the signed-in user's saved interests —
    this service never sees a user id, and the terms are only ever a scope, so
    they are cached by their own normalized value). Ignored when `input` is a
    real search."""
    try:
        body = await request.json()
    except Exception:
        logger.exception("POST /api/explore: request body is not valid JSON")
        body = {}
    input_text = body.get("input", "") if isinstance(body, dict) else ""
    raw_scope = body.get("scope") if isinstance(body, dict) else None
    scope_terms = raw_scope if isinstance(raw_scope, list) else None
    try:
        # trim_* only on egress — the cached copy keeps its full `raw` so the
        # citation graph stays rebuildable server-side (see response.py).
        return JSONResponse(
            trim_explore_result(await explore_async(input_text or "", scope_terms))
        )
    except Exception as exc:
        logger.exception("POST /api/explore failed: input=%r", input_text)
        return JSONResponse(
            {"input": input_text, "scope": {}, "tools_called": [], "sections": [], "error": str(exc)},
            status_code=200,
        )


@mcp.custom_route("/api/wiki", methods=["GET", "POST"])
async def wiki_http(request):
    """Plain-HTTP bridge to search_wiki() for the Next.js proxy.

    Same pattern as /api/explore above: the `search_wiki` tool is only reachable
    over MCP (/mcp), so this exposes the SAME _search_wiki() over plain HTTP for
    the podcast grid page.

      GET  /api/wiki?q=<query>&limit=<n>
      POST /api/wiki  { "query": "<text>", "limit": <n> }

    An empty query lists all episodes, newest first (search_wiki's own behaviour).
    Returns { query, count, episodes: [Item, ...] } — transcript is never included
    (search_wiki does not select it). Never 500s the caller: on failure it returns
    the empty shape with HTTP 200 so the page can render a clean error state."""
    query = ""
    limit = 100
    if request.method == "POST":
        try:
            body = await request.json()
        except Exception:
            logger.exception("POST /api/wiki: request body is not valid JSON")
            body = {}
        if isinstance(body, dict):
            query = body.get("query") or ""
            limit = body.get("limit") or limit
    else:
        query = request.query_params.get("q", "")
        limit = request.query_params.get("limit") or limit

    try:
        limit = max(1, min(int(limit), 500))
    except (TypeError, ValueError):
        limit = 100

    try:
        items = await asyncio.to_thread(_search_wiki, str(query), limit)
        episodes = [item.model_dump() for item in items]
        return JSONResponse({"query": query, "count": len(episodes), "episodes": episodes})
    except Exception as exc:
        logger.exception("GET/POST /api/wiki failed: query=%r limit=%r", query, limit)
        return JSONResponse(
            {"query": query, "count": 0, "episodes": [], "error": str(exc)},
            status_code=200,
        )


@mcp.custom_route("/api/wiki/episode", methods=["GET"])
async def wiki_episode_http(request):
    """Plain-HTTP bridge for ONE episode's full record, for the detail page.

      GET /api/wiki/episode?slug=<slug>

    Unlike /api/wiki (the search/list bridge, which never carries a transcript),
    this returns the complete row for a single episode INCLUDING `transcript`,
    plus concepts, summary, tags, episode_url and image_url.

    404s when the slug doesn't exist; on an unexpected failure returns HTTP 200
    with {episode: null, error} so the page can render an error state."""
    slug = request.query_params.get("slug", "")
    if not slug:
        return JSONResponse({"episode": None, "error": "missing slug"}, status_code=400)
    try:
        row = await asyncio.to_thread(_get_wiki_page, slug)
        if row is None:
            return JSONResponse({"episode": None, "error": "not found"}, status_code=404)
        return JSONResponse({"episode": row})
    except Exception as exc:
        logger.exception("GET /api/wiki/episode failed: slug=%r", slug)
        return JSONResponse({"episode": None, "error": str(exc)}, status_code=200)


@mcp.custom_route("/api/papers", methods=["GET"])
async def papers_http(request):
    """Plain-HTTP bridge to search_papers() for the Live Literature rail.

      GET /api/papers?q=<query>&limit=<n>

    Same live PubMed/OpenAlex/Crossref fan-out the MCP tool uses. Never 500s the
    caller: on failure returns {items: [], error} with HTTP 200."""
    query = request.query_params.get("q", "")
    try:
        limit = max(1, min(int(request.query_params.get("limit") or 8), 50))
    except (TypeError, ValueError):
        limit = 8
    if not query.strip():
        return JSONResponse({"query": query, "items": []})
    try:
        items = await search_papers_async(query, limit)
        return JSONResponse(
            {"query": query, "items": trim_items([i.model_dump() for i in items])}
        )
    except Exception as exc:
        logger.exception("GET /api/papers failed: query=%r limit=%r", query, limit)
        return JSONResponse({"query": query, "items": [], "error": str(exc)}, status_code=200)


def _serve() -> None:
    """Serve the streamable-HTTP app with the landing-feed pre-warm attached.

    Mirrors FastMCP.run_streamable_http_async(), with one addition: the app's
    lifespan is WRAPPED so prewarm.start() runs on the server's own event loop
    at startup. That matters twice over —
      * Starlette ignores router.on_startup once a lifespan is set, and
        streamable_http_app() sets one (the MCP session manager), so wrapping is
        the only correct hook;
      * the cache's per-key asyncio.Locks bind to the loop that creates them, so
        pre-warming from another thread/loop would silently break single-flight.

    `await prewarm.start()` does NOT wait for a warm feed anymore — it only
    schedules the warm as a background task and returns. Startup (and with it,
    /health) is available immediately regardless of upstream warm state; see
    prewarm.py's LIVENESS vs READINESS note and the /ready route above for how
    "has it finished warming" is tracked separately.
    """
    import uvicorn
    from contextlib import asynccontextmanager

    app = mcp.streamable_http_app()
    session_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(scope_app):
        async with session_lifespan(scope_app):      # MCP session manager
            await prewarm.start()                    # schedules the warm; returns immediately
            try:
                yield
            finally:
                await prewarm.stop()

    app.router.lifespan_context = lifespan

    uvicorn.Server(
        uvicorn.Config(app, host=HOST, port=PORT, log_level=mcp.settings.log_level.lower())
    ).run()


if __name__ == "__main__":
    _serve()
