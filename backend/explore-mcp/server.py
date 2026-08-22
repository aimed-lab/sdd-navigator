"""
server.py — Explore MCP server (streamable-HTTP transport).

Exposes 11 tools to other agents over MCP (external agents such as Pleaser call
these directly to learn about papers, news, assays/trials, funding,
datasets/tools, gene sets/pathways, internal resources, people, and podcast
episodes):

  • search_papers        — live scientific literature (PubMed/OpenAlex/Crossref)
  • search_news          — recency-first industry news for the field (OpenAlex, newest first)
  • search_trials        — clinical trials (ClinicalTrials.gov)
  • search_grants        — federal funding opportunities (Grants.gov)
  • search_tools         — open-source software tools/repos (GitHub)
  • search_datasets      — gene-expression/functional-genomics DATASETS (NCBI GEO), not papers
  • search_pager         — gene sets / pathways (PAGER), not papers, not datasets
  • search_chembl        — drug mechanisms / bioactivity against a gene target (ChEMBL)
  • search_lab_resources — internal lab-resource registry (read-only; never contact_info)
  • search_people        — researchers: public platform profiles + internal collaborators
  • search_wiki          — internal podcast-derived episode wiki pages
  • explore              — orchestration: reason over free text, route to tools, group results

Also exposes plain-HTTP-only actions (no MCP tool, no Supabase writes):
  • POST /api/classify-checklist-item — checklist item text -> capability
    terms (the ONE LLM call in this feature, restricted to a fixed
    vocabulary). Called once at item create/edit time, not at page-load or
    click time — see tools/find_provider.py's module docstring.
  • POST /api/find-provider — ALREADY-KNOWN capability terms -> providers
    from a teammate's external provider-catalog MCP server. Zero LLM calls.
    Deliberately NOT an MCP tool and NOT reachable through explore()'s
    routing — see tools/find_provider.py's module docstring for why.
  • POST /api/project-agent — the project agent. One search, two outputs:
    resources/checklist proposals for a human to review and accept (search ->
    relevance pass -> checklist proposal), AND a downloadable prior-art digest
    rendered from the SAME search (papers, terminated/withdrawn/recruiting
    trials, tools, datasets/gene sets — pure formatting, no LLM, never
    concludes anything is novel). These used to be two separate HTTP actions
    (this one plus a since-removed POST /api/prior-art-brief) that each ran
    their own full search over the same goal text; merged into one run when
    the frontend collapsed them into one button — see tools/project_agent.py
    and tools/prior_art_brief.py (now rendering-only, no orchestration of its
    own).

Tool DESCRIPTIONS matter — external agents read them to decide what to call, so
each docstring below is the tool's public contract. Read-only service: no writes
to Supabase, and no LLM SDK is imported here (that lives only in llm.py, reached
through the tools).

Config (env; loaded from .env):
  MCP_HOST (default 0.0.0.0), MCP_PORT (default 8000)
  LLM_PROVIDER / LLM_MODEL / LLM_API_KEY / GROQ_API_KEY  (see llm.py)
  SUPABASE_URL / SUPABASE_KEY  (read-only; search_lab_resources/people/wiki)
  GITHUB_TOKEN                 (optional; raises GitHub rate limits for search_tools)
  EXPLORE_API_TOKEN            (optional; see BearerAuthMiddleware below — unset
                                means every route but /health and /ready is open)

MCP MOUNT PATH: FastMCP.streamable_http_app() mounts the MCP session endpoint
at exactly `/mcp` (Starlette Route(path='/mcp', name='StreamableHTTPASGIApp') —
confirmed by inspecting `mcp.streamable_http_app().routes` directly, not
guessed). That is the full path to hand to another team or to protect at a
proxy/WAF layer: <this service's origin>/mcp, no trailing slash, no prefix.

Run:  python server.py      (serves MCP at /mcp, health at /health)
"""

from __future__ import annotations

import asyncio
import hmac
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
from tools.find_provider import classify_checklist_item_async, find_providers_for_item_async
from tools.project_agent import run_project_agent_async
from tools.search_chembl import search_chembl_async
from tools.search_datasets import search_datasets_async
from tools.search_grants import search_grants_async
from tools.search_lab_resources import search_lab_resources as _search_lab_resources
from tools.search_news import search_news_async
from tools.search_pager import search_pager_async
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


# ── Bearer auth ────────────────────────────────────────────────────────────────
# This service has no auth on its own by default — before this, POST
# /api/project-agent with an empty body ran the full six-source fanout plus two
# Groq calls for anyone with the URL, no project, no payload, no rate limit.
# EXPLORE_API_TOKEN gates every route except /health and /ready (see
# _OPEN_PATHS below and BearerAuthMiddleware).
#
# OPTIONAL BY DESIGN, NOT A BUG: unset/empty means NO auth is enforced (with a
# loud startup warning, right below) — this is what lets the backend and the
# frontend's EXPLORE_API_TOKEN be deployed/rolled out in either order with no
# window where the site itself breaks. Sourced with `or` (not the dict-style
# `os.environ.get(KEY, default)`), deliberately: an explicitly-empty env var
# must fall back to "no auth enforced" exactly like an unset one, not be
# treated as "the token is the empty string" — a two-arg `.get()` would only
# apply its default when the var is entirely ABSENT, not when a deploy sets it
# to "". This codebase has taken a container down once already over that
# exact absent-vs-empty distinction; don't reintroduce it here.
EXPLORE_API_TOKEN = os.environ.get("EXPLORE_API_TOKEN") or ""

# The only two routes a deploy script / uptime monitor needs to reach without
# a token, and neither leaks anything: /health is a static liveness string,
# /ready is warm-state booleans/counts. Every other route — every /api/*
# action AND the MCP endpoint itself (mounted at /mcp, see streamable_http_app()
# below) — requires the bearer token once one is configured.
_OPEN_PATHS = {"/health", "/ready"}


class BearerAuthMiddleware:
    """ASGI middleware (not BaseHTTPMiddleware — this service's MCP endpoint
    streams, and BaseHTTPMiddleware buffers the whole response body before
    handing it back, which would break that) gating every route except
    _OPEN_PATHS behind `Authorization: Bearer <EXPLORE_API_TOKEN>`.

    Compares with hmac.compare_digest, not `==` — a plain string compare
    short-circuits on the first mismatched byte, which leaks the token's
    length/prefix through response-timing differences to a patient attacker;
    compare_digest runs in constant time for that reason.

    Never echoes the token back in the 401 body, and never logs it — only the
    request path and source IP go to the WARNING log on a rejection. This
    codebase has leaked an API key through logs once already (see the httpx
    redaction note above); a bearer token is exactly as sensitive."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not EXPLORE_API_TOKEN or scope["path"] in _OPEN_PATHS:
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        auth = (headers.get(b"authorization") or b"").decode("latin-1")
        token = auth[7:] if auth.lower().startswith("bearer ") else ""

        if token and hmac.compare_digest(token, EXPLORE_API_TOKEN):
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        source_ip = client[0] if client else "unknown"
        logger.warning("Rejected unauthenticated request: path=%s source_ip=%s", scope["path"], source_ip)
        response = JSONResponse({"error": "Unauthorized"}, status_code=401)
        await response(scope, receive, send)


if not EXPLORE_API_TOKEN:
    logger.warning(
        "EXPLORE_API_TOKEN is not set — /api/* and /mcp are running WITHOUT AUTH. "
        "Anyone with this URL can run the full pipeline. Set EXPLORE_API_TOKEN here "
        "AND on the frontend to require a bearer token."
    )

# OpenAlex retired its unauthenticated "polite pool" (mailto=) on 2026-02-13 in
# favor of a keyed, credit-metered model — see sources/openalex.py's
# _api_key_param(). Running without OPENALEX_API_KEY isn't a hard failure (the
# unauthenticated common pool still technically answers requests), but it gets
# throttled hard and silently: search_papers._fetch isolates failures per
# source, so 429s from OpenAlex never surface as an error, they just quietly
# empty out the citation graph WINNER needs — this ran undetected for six
# months before. Same loud-warning pattern as EXPLORE_API_TOKEN above, so a
# repeat of that silent degradation is caught at startup instead.
if not (os.environ.get("OPENALEX_API_KEY") or "").strip():
    logger.warning(
        "OPENALEX_API_KEY is not set — OpenAlex requests are running on the "
        "UNAUTHENTICATED common pool and will be throttled hard. This degrades "
        "silently (per-source fetch failures are swallowed), not loudly — expect "
        "WINNER's citation graph to come back empty. Set OPENALEX_API_KEY here."
    )


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
async def search_papers(query: str, limit: int = 20, since_year: int | None = None) -> list[dict]:
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
        since_year: Optional. Restricts to papers published on/after this year.
    """
    limit = _clamp_limit(limit, ceiling=MAX_LIMIT, default=20, tool="search_papers")
    items = await search_papers_async(query, limit, since_year)
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


@mcp.tool()
async def search_datasets(query: str, limit: int = 20) -> list[dict]:
    """Search NCBI GEO (Gene Expression Omnibus) for gene-expression and
    functional-genomics DATASETS — NOT papers.

    Returns up to `limit` GEO Series/DataSet records (kind="dataset",
    source="geo") relevant to `query`: accession (GSEnnnnnn/GDSnnnn), title,
    summary, organism, sample count, experiment type (as GEO itself labels
    it — e.g. "Expression profiling by high throughput sequencing",
    "Expression profiling by array", a ChIP-seq/binding-profiling label,
    etc.), platform accession, submission date, the GEO record's own page
    URL, and any PubMed IDs GEO has linked to it (in `raw.pubmed_ids`) — use
    those to connect a dataset back to search_papers results. No ranking
    signal (signal=null): GEO records don't cite each other, so there is no
    citation graph to rank by. Sorted by NCBI's own relevance ranking.

    Use this when the ask is for existing DATA to reuse/reanalyze (e.g. "is
    there public RNA-seq data for X"), not when the ask is for literature —
    call search_papers for that instead.

    Args:
        query: A disease/tissue/gene query, e.g. "glioblastoma" or "PHGDH glioblastoma".
        limit: Max items to return (default 20, capped at 50).
    """
    limit = _clamp_limit(limit, ceiling=MAX_LIMIT, default=20, tool="search_datasets")
    items = await search_datasets_async(query, limit)
    return [item.model_dump() for item in items]


@mcp.tool()
async def search_pager(query: str, limit: int = 20) -> list[dict]:
    """Search PAGER (Pathway, Annotated-list and Gene-signature Electronic
    Repository) for GENE SETS AND PATHWAYS — NOT papers, NOT datasets.

    Returns up to `limit` PAGs (kind="geneset", source="pager") relevant to
    `query`: name, type (Pathway / Annotated list / Gene signature — the
    label in `raw.type_label`), source database (Reactome, KEGG, GWAS
    Catalog, DSigDB, I2D, ...), size (gene count), an nCoCo quality score
    (`raw.ncoco_score`), and a link to the PAG's own page. Gene MEMBERS are
    NOT included (a separate, per-PAG lookup — too expensive to fetch for
    every result in a list). Ranked by nCoCo score then size, both
    descending — PAGER itself returns results unsorted, so this tool fetches
    the full set and ranks it before trimming to `limit`, not the other way
    around. No ranking signal on the item itself (signal=null): gene sets
    don't cite each other, so there is no citation graph for a WINNER-style
    rank.

    Use this for a gene, protein, or disease target when the ask is about
    which PATHWAYS or curated GENE SETS it belongs to (e.g. "what pathways
    involve PHGDH") — not for literature (search_papers) and not for raw
    expression data (search_datasets).

    Args:
        query: A gene symbol or disease/keyword query, e.g. "PHGDH" or "glioblastoma".
        limit: Max items to return (default 20, capped at 50).
    """
    limit = _clamp_limit(limit, ceiling=MAX_LIMIT, default=20, tool="search_pager")
    items = await search_pager_async(query, limit)
    return [item.model_dump() for item in items]


@mcp.tool()
async def search_chembl(query: str, limit: int = 20) -> list[dict]:
    """Search ChEMBL for drug MECHANISMS and quantified BIOACTIVITY against a
    GENE target — NOT papers, NOT datasets.

    Returns up to `limit` records (kind="compound", source="chembl") of two
    kinds: mechanism-of-action records (which molecule, action_type, max_phase,
    the specific mutation targeted when known, e.g. "G12C") and quantified
    bioactivity/assay records (pchembl_value, standard_type/value/units,
    assay_description) — both scoped to the ChEMBL target resolved from
    `query`. No ranking signal (signal=null): ChEMBL records don't cite each
    other, so there is no citation graph to rank by.

    GENE-ONLY: `query` must be a gene/protein SYMBOL (e.g. "KRAS", "PHGDH"),
    resolved via ChEMBL's own target search. A disease or free-text query has
    no ChEMBL target to resolve to and will return no results.

    Args:
        query: A gene/protein symbol, e.g. "KRAS" or "EGFR".
        limit: Max items to return (default 20, capped at 50).
    """
    limit = _clamp_limit(limit, ceiling=MAX_LIMIT, default=20, tool="search_chembl")
    items = await search_chembl_async(query, limit)
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
async def explore(
    input_text: str, since_year: int | None = None, status_filter: list[str] | None = None,
) -> dict:
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
        since_year: Optional. Restricts the search_papers section (PubMed/OpenAlex/
            Crossref only) to papers published on/after this year. No other tool's
            results are date-filtered. Not driven by any current UI control —
            search_papers's own default (since_year omitted) already fetches a
            large candidate pool per source and returns the latest by date, so
            this param is for internal/future callers only.
        status_filter: Optional. Restricts the search_trials section to these
            ClinicalTrials.gov overall-status values (e.g. ["TERMINATED",
            "WITHDRAWN"]). Never derived from input_text — a UI-only filter,
            same as since_year.
    """
    return await explore_async(input_text, since_year=since_year, status_filter=status_filter)


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
    raw_since_year = body.get("since_year") if isinstance(body, dict) else None
    try:
        since_year = int(raw_since_year) if raw_since_year is not None else None
    except (TypeError, ValueError):
        since_year = None
    raw_status_filter = body.get("status_filter") if isinstance(body, dict) else None
    status_filter = (
        [str(s).strip() for s in raw_status_filter if str(s).strip()]
        if isinstance(raw_status_filter, list) else None
    ) or None
    try:
        # trim_* only on egress — the cached copy keeps its full `raw` so the
        # citation graph stays rebuildable server-side (see response.py).
        return JSONResponse(
            trim_explore_result(
                await explore_async(input_text or "", scope_terms, since_year, status_filter)
            )
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
    raw_since_year = request.query_params.get("since_year")
    try:
        since_year = int(raw_since_year) if raw_since_year else None
    except (TypeError, ValueError):
        since_year = None
    if not query.strip():
        return JSONResponse({"query": query, "items": []})
    try:
        items = await search_papers_async(query, limit, since_year)
        return JSONResponse(
            {"query": query, "items": trim_items([i.model_dump() for i in items])}
        )
    except Exception as exc:
        logger.exception("GET /api/papers failed: query=%r limit=%r", query, limit)
        return JSONResponse({"query": query, "items": [], "error": str(exc)}, status_code=200)


@mcp.custom_route("/api/classify-checklist-item", methods=["POST"])
async def classify_checklist_item_http(request):
    """Plain-HTTP-only bridge to classify_checklist_item_async() — see
    tools/find_provider.py's module docstring for why classification is its
    own step, called once at checklist-item create/edit time, not at page-
    load or click time.

    Deliberately NOT an MCP tool and NOT registered in explore()'s routing:
    this is a project-checklist-scoped classification a Server Action
    triggers on write, not a general research tool other agents or
    explore() should reach for.

      POST { "item_text": "<checklist item label>" } ->
        { item_text, matched_capabilities }

    Auth (EXPLORE_API_TOKEN) is enforced ahead of this handler by
    BearerAuthMiddleware. Project MEMBERSHIP is enforced by the Next.js
    Server Action BEFORE it ever calls this route (the write already went
    through getProject()'s/requireCurrentUser()'s RLS-backed gate to get
    this far) — this service has no notion of Supabase sessions and cannot
    check membership itself.

    Resilience: never 500s the caller. On any failure (vocab fetch failed,
    LLM call failed) this returns HTTP 200 with matched_capabilities=[] —
    the SAFE FALLBACK the spec calls for: an item that fails to classify
    reads as "needs a person", i.e. Ask for help, which always works."""
    try:
        body = await request.json()
    except Exception:
        logger.exception("POST /api/classify-checklist-item: request body is not valid JSON")
        body = {}
    item_text = body.get("item_text", "") if isinstance(body, dict) else ""
    if not isinstance(item_text, str) or not item_text.strip():
        return JSONResponse({"error": "Missing required field: item_text."}, status_code=400)

    try:
        result = await classify_checklist_item_async(item_text)
        return JSONResponse(result)
    except Exception as exc:
        logger.exception("POST /api/classify-checklist-item failed: item_text=%r", item_text)
        return JSONResponse(
            {"item_text": item_text, "matched_capabilities": [], "error": str(exc)},
            status_code=200,
        )


@mcp.custom_route("/api/find-provider", methods=["POST"])
async def find_provider_http(request):
    """Plain-HTTP-only bridge to find_providers_for_item_async() — a pure
    catalog search over ALREADY-KNOWN capability terms, zero LLM calls. See
    tools/find_provider.py's module docstring for why this is split from
    classification.

    Deliberately NOT an MCP tool and NOT registered in explore()'s routing:
    this is a project-checklist-scoped lookup a human triggers explicitly
    ("Find a service provider"), not a general research tool other agents
    or explore() should reach for.

      POST { "item_text": "<checklist item label>", "capabilities": [...] } ->
        { item_text, matched_capabilities, providers: [...], count }

    `capabilities` comes from the checklist item's STORED
    matched_capabilities column (see frontend/lib/server/projects.ts) —
    this route does not classify, it only searches.

    Auth (EXPLORE_API_TOKEN) is enforced ahead of this handler by
    BearerAuthMiddleware. Project MEMBERSHIP is enforced by the Next.js
    proxy route BEFORE it ever calls this route (getProject()'s RLS-backed
    gate) — this service has no notion of Supabase sessions and cannot
    check membership itself.

    Resilience: this sits someone else's uptime (a Supabase Edge Function
    that cold-starts) in the request path. Never 500s the caller — on any
    failure (catalog unreachable/slow) this returns HTTP 200 with an
    explained-empty result, so the checklist item and its Ask-for-help
    fallback keep working regardless."""
    try:
        body = await request.json()
    except Exception:
        logger.exception("POST /api/find-provider: request body is not valid JSON")
        body = {}
    item_text = body.get("item_text", "") if isinstance(body, dict) else ""
    raw_caps = body.get("capabilities") if isinstance(body, dict) else None
    capabilities = [c for c in raw_caps if isinstance(c, str)] if isinstance(raw_caps, list) else []

    try:
        result = await find_providers_for_item_async(item_text, capabilities)
        return JSONResponse(result)
    except Exception as exc:
        logger.exception("POST /api/find-provider failed: item_text=%r capabilities=%r", item_text, capabilities)
        return JSONResponse(
            {
                "item_text": item_text,
                "matched_capabilities": capabilities,
                "providers": [],
                "count": 0,
                "error": str(exc),
            },
            status_code=200,
        )


def _validate_project_agent_body(body) -> str | None:
    """Returns an error message if `body` is missing the fields the agent
    actually reasons over, else None.

    An empty {} body must NOT fall through to a default search — that was
    exactly the abuse case a public, tokenless request could exploit for a
    free six-source fanout plus two Groq calls. `name` is the one field every
    real project always has (see lib/server/projects.ts: it's required at
    creation), so it's the cheapest reliable signal that this is a genuine
    project-agent call and not an empty/garbage probe. This is deliberately
    NOT full schema validation — target/indication/modality/stage/
    existing_checklist/saved_item_ids all stay optional, exactly as
    tools/project_agent.py already treats them."""
    if not isinstance(body, dict):
        return "Request body must be a JSON object."
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        return "Missing required field: name."
    return None


@mcp.custom_route("/api/project-agent", methods=["POST"])
async def project_agent_http(request):
    """The project agent — plain-HTTP only, no MCP tool (this is a project-scoped
    action, not a general-purpose search tool other agents should call).

    POST { name, description, target, indication, modality, stage,
           existing_checklist: [str], saved_item_ids: [str] } -> the agent's
    proposal: { summary, selected_items: [Item + {reason}], checklist_items:
    [{label, rationale}], checklist_enabled, digest: {markdown, generated_at,
    counts} | None, tools_called, warnings }

    ONE SEARCH, TWO OUTPUTS. `digest` is the downloadable prior-art digest —
    pure Markdown formatting (tools/prior_art_brief.py's render_digest()) over
    the SAME search this route already runs for selected_items/
    checklist_items, not a second search. This used to be a separate route
    (POST /api/prior-art-brief, since removed) that ran its own explore_async()
    call over the same goal text; merged so one click costs one search
    instead of two. `digest` is None only when the search itself failed
    entirely — it does not depend on the relevance pass succeeding (it never
    calls an LLM), so it's still returned even when analysis_failed is True.

    `name` is REQUIRED — see _validate_project_agent_body's own docstring for
    why. A request missing it gets 400 before anything downstream (search,
    LLM calls) ever runs.

    WRITES NOTHING to Supabase — this route (and tools/project_agent.py behind
    it) only ever returns a proposal. The frontend is the only thing that
    persists anything, through the existing saveToProject/addChecklistItem
    paths — see CLAUDE.md's "IT PROPOSES; THE FRONTEND PERSISTS".

    Auth (EXPLORE_API_TOKEN) is enforced ahead of this handler by
    BearerAuthMiddleware, not here — see that class's own docstring.

    Runs the fixed pipeline in tools/project_agent.py: search (reusing
    explore_async, plus two direct status-filtered trial searches for the
    digest, all in parallel) -> digest render -> relevance pass -> checklist
    proposal (skipped for a ColaboFest project). No timeout here on purpose —
    this container has none, unlike the Vercel function that would otherwise
    have to run it (see CLAUDE.md's architecture note). Never 500s the
    caller: on total failure it returns an explained empty proposal with
    HTTP 200, same resilience contract as /api/explore.
    """
    try:
        body = await request.json()
    except Exception:
        logger.exception("POST /api/project-agent: request body is not valid JSON")
        body = {}
    if not isinstance(body, dict):
        body = {}

    validation_error = _validate_project_agent_body(body)
    if validation_error:
        return JSONResponse({"error": validation_error}, status_code=400)

    try:
        result = await run_project_agent_async(body)
        result["selected_items"] = trim_items(result.get("selected_items") or [])
        return JSONResponse(result)
    except Exception as exc:
        logger.exception("POST /api/project-agent failed: name=%r", body.get("name"))
        return JSONResponse(
            {
                "summary": "The agent hit an unexpected error and could not complete this run.",
                "selected_items": [],
                "checklist_items": [],
                "tools_called": [],
                "warnings": [str(exc)],
            },
            status_code=200,
        )



# ── Project agent — job polling ───────────────────────────────────────────────
#
# The frontend needs REAL progress on a 20-40s run, not a bare spinner (see
# CLAUDE.md). A single blocking POST can't report progress mid-flight, so this
# is a tiny start/poll pair instead: POST /start kicks off the pipeline as a
# background asyncio task and returns immediately with a job id; GET /status
# reports which stage it's on and, once done, the same proposal shape
# /api/project-agent returns synchronously.
#
# IN-MEMORY, PER-PROCESS, ON PURPOSE — same constraint as cache.py's
# single-flight dict (see CLAUDE.md's "must stay single-worker" note): a
# second uvicorn worker would have its own unsynchronized _JOBS dict and a
# poll could land on the wrong process. Scale with more containers, not
# workers=N, exactly as the rest of this service already requires.
#
# EVICTION: a job is small (one dict) and short-lived (30-60s to finish, plus
# however long its poller keeps checking after), but without an eviction
# policy this dict grows without bound exactly like cache.py's own dict would
# without its TTL/stats — a client that starts a run and never polls it to
# completion (tab closed, network drop) otherwise leaves an orphaned entry
# forever. Two bounds, not one:
#   _JOB_TTL_SECONDS — a completed job older than this is swept on the next
#     /start call. Nothing legitimate polls minutes after the run finished
#     (the frontend stops polling the moment it sees status="done"), so this
#     is generous headroom for a slow poller, not a tight budget.
#   _MAX_JOBS — a hard count backstop against a burst of /start calls
#     outrunning the TTL sweep before it can catch up; oldest-first, which
#     for a per-process dict with append-only insertion means oldest
#     CREATED, not oldest completed — a pathological burst could in theory
#     evict a still-running job, but at 500 concurrent runs this service has
#     far bigger problems than a dropped poll.
_JOBS: dict[str, dict] = {}
_JOB_TTL_SECONDS = 30 * 60  # 30 minutes
_MAX_JOBS = 500


def _prune_jobs() -> None:
    import time

    now = time.monotonic()
    stale = [
        job_id
        for job_id, job in _JOBS.items()
        if job.get("status") == "done" and (now - job.get("created_at", now)) > _JOB_TTL_SECONDS
    ]
    for job_id in stale:
        _JOBS.pop(job_id, None)

    if len(_JOBS) > _MAX_JOBS:
        # Oldest-first eviction — dict preserves insertion order in Python
        # 3.7+, and job ids are only ever appended, never reinserted.
        for job_id in list(_JOBS.keys())[: len(_JOBS) - _MAX_JOBS]:
            _JOBS.pop(job_id, None)


async def _run_job(job_id: str, body: dict) -> None:
    def on_stage(stage: str) -> None:
        if job_id in _JOBS:
            _JOBS[job_id]["stage"] = stage

    created_at = _JOBS[job_id]["created_at"] if job_id in _JOBS else None
    try:
        result = await run_project_agent_async(body, on_stage=on_stage)
        result["selected_items"] = trim_items(result.get("selected_items") or [])
        if job_id in _JOBS:
            _JOBS[job_id] = {
                "status": "done",
                "stage": "done",
                "result": result,
                "created_at": created_at,
            }
    except Exception as exc:
        logger.exception("project_agent job %s failed", job_id)
        if job_id in _JOBS:
            _JOBS[job_id] = {
                "status": "done",
                "stage": "done",
                "result": {
                    "summary": "The agent hit an unexpected error and could not complete this run.",
                    "selected_items": [],
                    "checklist_items": [],
                    "tools_called": [],
                    "warnings": [str(exc)],
                },
                "created_at": created_at,
            }


@mcp.custom_route("/api/project-agent/start", methods=["POST"])
async def project_agent_start_http(request):
    """Kick off a project-agent run in the background. Same body shape and
    same `name`-required validation as POST /api/project-agent (see
    _validate_project_agent_body) — a request missing it gets 400 before a
    job is even created, not after it's already running in the background.
    Returns {job_id} immediately (HTTP 202) once validation passes."""
    import time
    import uuid

    try:
        body = await request.json()
    except Exception:
        logger.exception("POST /api/project-agent/start: request body is not valid JSON")
        body = {}
    if not isinstance(body, dict):
        body = {}

    validation_error = _validate_project_agent_body(body)
    if validation_error:
        return JSONResponse({"error": validation_error}, status_code=400)

    _prune_jobs()  # before inserting, so a burst can't outrun its own cleanup
    job_id = uuid.uuid4().hex
    _JOBS[job_id] = {
        "status": "running",
        "stage": "searching",
        "result": None,
        "created_at": time.monotonic(),
    }
    asyncio.create_task(_run_job(job_id, body))
    return JSONResponse({"job_id": job_id}, status_code=202)


@mcp.custom_route("/api/project-agent/status", methods=["GET"])
async def project_agent_status_http(request):
    """GET /api/project-agent/status?job_id=<id> -> {status, stage, result}.
    `result` is null until status="done". An unknown job_id (expired, or the
    process restarted) returns 404 rather than hanging a poller forever."""
    job_id = request.query_params.get("job_id", "")
    job = _JOBS.get(job_id)
    if job is None:
        return JSONResponse({"status": "not_found", "stage": None, "result": None}, status_code=404)
    # created_at (a monotonic clock float, meaningless off-process) is bookkeeping
    # for _prune_jobs() only — never shipped to the client.
    return JSONResponse({"status": job["status"], "stage": job["stage"], "result": job["result"]})


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

    # Outermost wrap: BearerAuthMiddleware passes non-"http" scope types
    # (lifespan, websocket) straight through untouched, so this doesn't
    # interfere with the lifespan wiring just above.
    app = BearerAuthMiddleware(app)

    uvicorn.Server(
        uvicorn.Config(app, host=HOST, port=PORT, log_level=mcp.settings.log_level.lower())
    ).run()


if __name__ == "__main__":
    _serve()
