"""
tools/find_provider.py — "Find a provider" bridge (checklist item -> a
teammate's external provider-catalog MCP server).

Deliberately NOT registered as an @mcp.tool() and NOT reachable through
explore()'s routing (see server.py) — this is a project-checklist-scoped
action a human triggers explicitly ("Find a provider" beside "Ask for
help"), not a general research tool other agents or explore() should ever
reach for. A lit-search query like "PHGDH glioblastoma" wants papers, not
a CRO.

CATALOG SERVER CONTRACT — verified against the live server, not assumed:
  https://xazpggbzzclubdfjldam.supabase.co/functions/v1/catalog-mcp
  - JSON-RPC 2.0 over plain HTTP POST, no auth, STATELESS: no
    initialize/session handshake required — every tools/call is answered
    as an independent request (confirmed: a bare tools/call with no prior
    initialize returns a normal result).
  - find_providers requires "capabilities" as an ARRAY. Sending a bare
    string throws INSIDE the server's own code ("want.filter is not a
    function") and comes back as a raw JSON-RPC 500 — so this module
    always sends a list, never a string, no matter what the LLM mapping
    step produces.
  - find_providers with no explicit `limit` defaults to 3 results. Always
    pass one explicitly (FIND_PROVIDERS_LIMIT below).
  - An unrecognized capability is NOT a crash: clean 200 with
    {"error": "unknown_capability", "did_you_mean": [...]}. Handled below
    as "no results", not raised.
  - list_capabilities() returns the full fixed vocabulary (66 terms as of
    writing) — fetched live and cached (see list_capabilities_async),
    never hardcoded: it's a controlled list that may grow.
  - find_by_certification and search_text are deliberately never called
    from this module — see the feature's own spec: certification claims
    are self-reported and never registry-verified, and search_text only
    reaches name/description, not capabilities.

ONE LLM CALL: only the free-text -> capability-terms mapping below runs a
model. If nothing maps confidently, this returns matched_capabilities=[]
and the frontend shows the Ask-for-help fallback instead of a guess.

LOGGING IS THE ONLY PERSISTENCE HERE. This service writes nothing to
Supabase (see server.py's own "read-only service" stance) and a provider
catalog lookup isn't worth introducing a new table for on day one, so each
lookup's item text, matched capability terms, and result count go to
stdout at INFO — the one thing that's cheap now and impossible to
backfill later.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from urllib.parse import urlsplit, urlunsplit

import httpx

import llm
from cache import STALE_TOOLS, TTL_TOOLS, cache

logger = logging.getLogger(__name__)

CATALOG_MCP_URL = os.environ.get(
    "CATALOG_MCP_URL",
    "https://xazpggbzzclubdfjldam.supabase.co/functions/v1/catalog-mcp",
)
# Typical response 400-600ms per the ask, tail risk past a second (Supabase
# Edge Function cold start) — 5s gives real headroom past that tail without
# holding a checklist-item click open indefinitely.
CATALOG_TIMEOUT = float(os.environ.get("CATALOG_TIMEOUT_SEC", "5"))

# Same retry-once-on-unusable-JSON backoff as tools/project_agent.py's
# relevance/checklist passes — a bad JSON sample from the model is usually a
# one-off, not a quota issue.
_JSON_RETRY_BACKOFF_SEC = 2.0

FIND_PROVIDERS_LIMIT = 25


def _redact_url(url: str) -> str:
    """Scheme+host+path only, matching sources/base.py's convention. No
    secret rides in this URL today (the catalog is unauthenticated), but the
    pattern is kept for consistency and in case that ever changes."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


async def _call_catalog(tool_name: str, arguments: dict) -> dict:
    """One JSON-RPC 2.0 tools/call round trip to the catalog MCP server.

    Raises on timeout, transport failure, a non-200, a JSON-RPC error
    envelope, or an unparseable tool result. Callers are expected to catch,
    log, and degrade — this module never talks to the frontend directly."""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                CATALOG_MCP_URL,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                },
                timeout=CATALOG_TIMEOUT,
            )
    except httpx.HTTPError as exc:
        raise RuntimeError(
            f"catalog-mcp {tool_name} request failed: {_redact_url(CATALOG_MCP_URL)}"
        ) from exc

    if resp.status_code != 200:
        raise RuntimeError(
            f"catalog-mcp {tool_name} responded {resp.status_code}: {_redact_url(CATALOG_MCP_URL)}"
        )

    body = resp.json()
    if isinstance(body, dict) and body.get("error"):
        raise RuntimeError(f"catalog-mcp {tool_name} error: {body['error'].get('message')}")

    content = ((body or {}).get("result") or {}).get("content") or []
    if not content or content[0].get("type") != "text":
        raise RuntimeError(f"catalog-mcp {tool_name}: unexpected result shape")

    try:
        return json.loads(content[0]["text"])
    except (json.JSONDecodeError, TypeError) as exc:
        raise RuntimeError(f"catalog-mcp {tool_name}: unparseable result text") from exc


# ── Vocabulary (fetched live, cached — never hardcoded) ───────────────────────


async def _fetch_capabilities() -> list[str]:
    data = await _call_catalog("list_capabilities", {})
    caps = data.get("capabilities")
    if not isinstance(caps, list):
        raise RuntimeError("catalog-mcp list_capabilities: malformed response")
    return [c for c in caps if isinstance(c, str)]


async def list_capabilities_async() -> list[str]:
    """The controlled capability vocabulary, fetched live and cached under
    the shared cache's own TTL_TOOLS/STALE_TOOLS window (1h fresh, 3h
    stale-while-revalidate — the same "slowly-changing curated list" policy
    already used elsewhere in this service). Cached rather than hardcoded
    because the list is explicitly allowed to grow. A failed fetch with no
    cached value propagates; find_provider_async treats that as "capability
    mapping unavailable" and the HTTP route degrades to an empty result,
    same resilience contract as the rest of this service."""
    return await cache.get_or_compute(
        "catalog:capabilities", _fetch_capabilities, TTL_TOOLS, STALE_TOOLS
    )


# ── Step 1: map free text onto 0-3 vocabulary terms ────────────────────────────

_MAPPING_SYSTEM_TEMPLATE = (
    "You map a project checklist item's free text onto capability tags from a "
    "FIXED vocabulary. Only use terms from this exact list, verbatim — never "
    "invent a term, never substitute a close-but-absent one:\n{vocab}\n\n"
    'Return ONLY a JSON object: {{"capabilities": [...], "confident": true|false}}.\n'
    '"capabilities" is 0-3 terms from the list above that the item is clearly '
    'asking for. Set "confident": false and leave "capabilities" empty if '
    "nothing in the list is a clear match for what the item is asking for — do "
    "not guess a near-miss just to return something. Output JSON only — no "
    "prose, no code fences."
)


def _loads_lenient(content: str | None) -> dict:
    """Parse a JSON object out of an LLM reply, tolerating code fences/prose —
    identical pattern to tools/explore.py's own _loads_lenient."""
    if not content:
        return {}
    try:
        return json.loads(content)
    except (json.JSONDecodeError, TypeError):
        pass
    m = re.search(r"\{.*\}", content, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    return {}


def _try_map_once(item_text: str, vocab: list[str]) -> list[str] | None:
    """One LLM round trip. Returns the matched capability list (possibly
    empty, meaning "confidently nothing"), or None when the reply's JSON is
    unusable (missing/wrong-typed keys) — the caller retries once on None."""
    messages = [
        {"role": "system", "content": _MAPPING_SYSTEM_TEMPLATE.format(vocab=", ".join(vocab))},
        {"role": "user", "content": item_text},
    ]
    resp = llm.complete(messages, temperature=0.0)
    parsed = _loads_lenient(resp.content)
    caps = parsed.get("capabilities")
    confident = parsed.get("confident")
    if not isinstance(caps, list) or not isinstance(confident, bool):
        return None
    valid = set(vocab)
    matched = [c for c in caps if isinstance(c, str) and c in valid]
    if not confident:
        return []
    return matched


def _map_item_to_capabilities(item_text: str, vocab: list[str]) -> list[str]:
    """Free text -> 0-3 terms from `vocab`. Retry-once-on-unusable-JSON, same
    pattern as tools/project_agent.py's relevance/checklist passes.

    Never raises for a bad or low-confidence LLM reply — returns [] (the "say
    so, offer Ask for help instead" signal) rather than guessing. An actual
    LLM call failure (network, auth, quota — llm.complete() raising outright)
    IS allowed to propagate, since that is a service-level failure the HTTP
    route should log and degrade on distinctly, not a modeling ambiguity."""
    if not vocab:
        return []
    out = _try_map_once(item_text, vocab)
    if out is not None:
        return out
    logger.warning("find_provider: capability-mapping JSON unusable (attempt 1/2), retrying once")
    time.sleep(_JSON_RETRY_BACKOFF_SEC)
    out = _try_map_once(item_text, vocab)
    if out is not None:
        logger.info("find_provider: capability-mapping JSON usable on retry (attempt 2/2)")
        return out
    logger.warning(
        "find_provider: capability-mapping JSON unusable (attempt 2/2) — treating as no match"
    )
    return []


# ── Step 2: query the catalog, trim to what the panel renders ─────────────────

# Wording per the ask: the catalog's own "verified" means every claim was
# found on the company's OWN site, never independently confirmed —
# evidence_urls is often just the homepage. not_yet_verified gets no warning
# icon: the catalog's own docs say it usually means a bot-blocked or
# JavaScript-rendered site, not doubt about the company.
_VERIFICATION_LABELS = {
    "verified": "Claims checked on their site",
    "partially_verified": "Some claims checked",
    "not_yet_verified": "Not checked",
}


def _format_provider(raw: dict) -> dict:
    """Trim one catalog entity down to what the panel actually renders: name,
    business type(s), capability tags, country/countries served, an honest
    verification label, and the website link. Never forwards
    certifications, products/services, evidence_urls, etc. — the panel
    doesn't show them, and trimming here keeps this module the one place
    that has to change if the catalog adds fields the panel doesn't want."""
    verification = raw.get("verification")
    return {
        "name": raw.get("name"),
        "business_types": raw.get("business_types") or [],
        "capability_tags": raw.get("capability_tags") or [],
        "countries_served": raw.get("countries_served") or [],
        "website": raw.get("website"),
        "verification": verification,
        "verification_label": _VERIFICATION_LABELS.get(verification, "Not checked"),
    }


async def find_providers_for_capabilities(
    capabilities: list[str], limit: int = FIND_PROVIDERS_LIMIT
) -> list[dict]:
    """find_providers over the given (already-vocabulary-validated)
    capability terms, ANDed, up to `limit` (always explicit — the catalog's
    own default is 3). A clean unknown_capability/other error envelope from
    the catalog is treated as zero results, not raised — this module only
    ever passes terms it just got from list_capabilities_async(), so that
    envelope would indicate the vocabulary drifted out from under the cache,
    not a caller bug; logged so it's visible either way."""
    data = await _call_catalog(
        "find_providers", {"capabilities": capabilities, "limit": limit}
    )
    if isinstance(data, dict) and data.get("error"):
        logger.warning(
            "find_provider: catalog find_providers returned error=%r for capabilities=%r",
            data.get("error"),
            capabilities,
        )
        return []
    results = data.get("results") if isinstance(data, dict) else None
    if not isinstance(results, list):
        return []
    return [_format_provider(r) for r in results if isinstance(r, dict)]


async def find_provider_async(item_text: str) -> dict:
    """Full pipeline for one checklist item: fetch/cached vocab -> map item
    text to capability terms -> query the catalog -> trim results.

    Returns {item_text, matched_capabilities, providers, count}.
    matched_capabilities == [] IS the "nothing mapped confidently" signal —
    never raises for that normal outcome, so the frontend can render the
    Ask-for-help fallback rather than an error state.

    DOES raise on a genuine service failure (catalog unreachable, vocab
    fetch failed, the LLM call itself failing outright) — the HTTP route in
    server.py is what turns that into a degraded-but-200 response, same
    resilience contract as /api/explore and /api/project-agent.

    Logs exactly once per lookup: item text, matched terms, result count —
    the only persistence this feature has (see module docstring)."""
    text = (item_text or "").strip()
    if not text:
        return {"item_text": item_text, "matched_capabilities": [], "providers": [], "count": 0}

    vocab = await list_capabilities_async()
    matched = _map_item_to_capabilities(text, vocab)

    if not matched:
        logger.info("find_provider lookup: item=%r matched=[] results=0", text)
        return {"item_text": item_text, "matched_capabilities": [], "providers": [], "count": 0}

    providers = await find_providers_for_capabilities(matched)
    logger.info(
        "find_provider lookup: item=%r matched=%r results=%d", text, matched, len(providers)
    )
    return {
        "item_text": item_text,
        "matched_capabilities": matched,
        "providers": providers,
        "count": len(providers),
    }
