"""
tools/find_provider.py — checklist item <-> a teammate's external
provider-catalog MCP server.

Deliberately NOT registered as an @mcp.tool() and NOT reachable through
explore()'s routing (see server.py) — this is a project-checklist-scoped
action, not a general research tool other agents or explore() should ever
reach for. A lit-search query like "PHGDH glioblastoma" wants papers, not
a CRO.

TWO SEPARATE OPERATIONS, ON PURPOSE — the classification LLM call and the
catalog search are no longer one pipeline:

  classify_checklist_item_async(item_text)
    Free text -> 0-3 capability terms (the ONE place an LLM runs in this
    module). Called ONCE per item, when it's created or its label is
    edited (see frontend/lib/server/projects.ts) — the result is stored on
    the checklist_items row (matched_capabilities column,
    2026-08-19_checklist_matched_capabilities.sql) and reused from there
    for the item's entire lifetime between edits. This is what keeps a
    checklist page — and a "Find a service provider" click — at ZERO LLM
    calls: the classification already happened at write time, not at
    read/click time. See that migration's own comment for why store-once
    beats "one LLM call per item on every page load" or "one batched LLM
    call on every load" — both cost far more over a project's lifetime
    than one call per add/edit.

  find_providers_for_item_async(item_text, capabilities)
    Given ALREADY-KNOWN capability terms (read from the stored column, not
    computed here), queries the catalog. Zero LLM calls — pure catalog
    search + trim + log.

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
  - `description` is forwarded VERBATIM in _format_provider below — never
    generated, never rewritten. An invented sentence about a real company
    under this platform's branding would be a liability; the catalog's own
    words are the only words shown.

LOGGING IS THE ONLY PERSISTENCE HERE beyond the stored column above. This
service writes nothing else to Supabase (see server.py's own "read-only
service" stance), so each classification (item text, matched terms) and
each provider lookup (item text, capability terms, result count) go to
stdout at INFO — cheap now, impossible to backfill later.
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
    cached value propagates; classify_checklist_item_async treats that as
    "capability mapping unavailable" and the HTTP route degrades to an
    empty result (matched_capabilities=[], the safe Ask-for-help fallback),
    same resilience contract as the rest of this service."""
    return await cache.get_or_compute(
        "catalog:capabilities", _fetch_capabilities, TTL_TOOLS, STALE_TOOLS
    )


# ── Step 1: map free text onto 0-3 vocabulary terms ────────────────────────────
#
# THE QUESTION IS "WOULD A TEAM PAY AN EXTERNAL PROVIDER TO DO THIS", NOT
# "DOES THIS TEXT MENTION A TECHNIQUE THE CATALOG COVERS". The earlier
# version of this prompt asked the model to match vocabulary terms against
# the item text, which is exactly the failure mode a live project (NLRP3)
# surfaced: every one of five agent-generated items got a service match,
# including "Quantify GSDMD and IL1B expression in EXISTING scRNA-seq
# biopsy data" and "Perform retrospective analysis of the cohort" — the
# team's OWN analysis of data they already have, matched purely because
# "scRNA-seq" is a technique word the catalog also covers. A checklist item
# naming a method is not evidence the team wants to buy that method from a
# vendor; it's usually evidence of the opposite — they're describing the
# work they're about to do themselves.
_MAPPING_SYSTEM_TEMPLATE = (
    "You decide whether a project checklist item describes work a team would "
    "PAY AN EXTERNAL PROVIDER OR VENDOR TO DO — a SERVICE.\n\n"
    "This is NOT a keyword match against a vocabulary list. Mentioning a "
    "technique, assay, or method by name does NOT by itself make something a "
    "service — a team writes checklist items describing their OWN planned "
    "work using exactly that kind of technical language. The question is "
    "always: would this specific team realistically hire an outside "
    "provider to do this piece of work, or is this something they're doing "
    "themselves?\n\n"
    "NOT a service (return capabilities: [] for these), even when the text "
    "names a technique the vocabulary covers:\n"
    "  - Analysing, quantifying, or integrating data the team ALREADY HAS. "
    'e.g. "Quantify GSDMD and IL1B expression in existing scRNA-seq biopsy '
    'data", "Perform retrospective analysis of the cohort", "Integrate the '
    'dataset to assess PANX1-P2X7 signaling" — this is the team\'s own '
    "analysis of their own data, not something to outsource.\n"
    "  - A decision, an open question, a write-up, a plan, or a review — "
    '"Decide on the primary endpoint", "Draft the manuscript", "Review the '
    'literature for precedent".\n'
    "  - Recruiting a person, a collaborator, or a co-investigator — that "
    "needs a PERSON, never a vendor.\n\n"
    "Possibly a service:\n"
    "  - GENERATING data, material, or a model system the team does NOT "
    'already have — "Generate GBM organoids with a CRISPR knockout", "Run '
    'in vivo efficacy studies", "GMP-manufacture the lead compound".\n'
    "  - Work that needs a facility, instrument, or capability the team "
    "does not have in-house.\n\n"
    "Only use terms from this exact fixed vocabulary, verbatim — never "
    "invent a term, never substitute a close-but-absent one:\n{vocab}\n\n"
    'Return ONLY a JSON object: {{"capabilities": [...], "confident": true|false}}.\n'
    '"capabilities" is 0-3 terms from the list above, and ONLY when this '
    "item clearly describes work to buy from an outside provider.\n\n"
    "WHEN IN DOUBT, RETURN NOTHING. Leaving \"capabilities\" empty (and "
    '"confident": false) is the CORRECT, SAFE default whenever it\'s '
    "ambiguous, whenever the item reads as the team's own analysis, or "
    "whenever you are not confident — missing a real service costs "
    "nothing (the team still sees Ask for help, which always works), but a "
    "wrong service match is visibly, embarrassingly wrong to the team. "
    "Bias toward NOT a service. Output JSON only — no prose, no code fences."
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


# CODE-LEVEL GROUNDING GATE — same "prompt asks, code enforces" pattern as
# tools/project_agent.py's checklist grounding gate. The prompt above
# already instructs the model to treat "analysing data we already have" as
# NOT a service, but a prompt instruction is advisory, not a guarantee —
# the NLRP3 failure (see _MAPPING_SYSTEM_TEMPLATE's own comment) came from
# the model latching onto a technique word and discounting the surrounding
# "existing" qualifier. This is a small, EXPLICIT, closed list of phrases
# (not a broad heuristic) checked verbatim, case-insensitive, against the
# raw item text: if any is present, the classification is dropped to []
# regardless of what the model returned, full stop. False negatives here
# (a genuine service item that happens to also contain one of these words)
# cost nothing — Ask for help still works — which is exactly the same
# bias-toward-NOT-a-service the prompt itself asks for, just enforced in
# code instead of trusted to hold.
_ALREADY_HAVE_SIGNALS = (
    "existing",
    "our own",
    "we have",
    "previously collected",
    "published",
    "retrospective",
)


def _has_already_have_signal(item_text: str) -> bool:
    text = item_text.lower()
    return any(signal in text for signal in _ALREADY_HAVE_SIGNALS)


def _map_item_to_capabilities(item_text: str, vocab: list[str]) -> list[str]:
    """Free text -> 0-3 terms from `vocab`. Retry-once-on-unusable-JSON, same
    pattern as tools/project_agent.py's relevance/checklist passes, THEN the
    already-have-it grounding gate above.

    Never raises for a bad or low-confidence LLM reply — returns [] (the "say
    so, offer Ask for help instead" signal) rather than guessing. An actual
    LLM call failure (network, auth, quota — llm.complete() raising outright)
    IS allowed to propagate, since that is a service-level failure the HTTP
    route should log and degrade on distinctly, not a modeling ambiguity."""
    if not vocab:
        return []

    def _gated(caps: list[str]) -> list[str]:
        if caps and _has_already_have_signal(item_text):
            logger.info(
                "find_provider: grounding gate dropped %r for item=%r "
                "(already-have-it signal present)",
                caps,
                item_text,
            )
            return []
        return caps

    out = _try_map_once(item_text, vocab)
    if out is not None:
        return _gated(out)
    logger.warning("find_provider: capability-mapping JSON unusable (attempt 1/2), retrying once")
    time.sleep(_JSON_RETRY_BACKOFF_SEC)
    out = _try_map_once(item_text, vocab)
    if out is not None:
        logger.info("find_provider: capability-mapping JSON usable on retry (attempt 2/2)")
        return _gated(out)
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
    ONE line of description taken VERBATIM from the catalog (never
    generated, never rewritten — see module docstring), business type(s),
    capability tags, country/countries served, an honest verification
    label, and the website link. Never forwards certifications, products/
    services, evidence_urls, etc. — the panel doesn't show them, and
    trimming here keeps this module the one place that has to change if the
    catalog adds fields the panel doesn't want."""
    verification = raw.get("verification")
    return {
        "name": raw.get("name"),
        "description": raw.get("description"),
        "business_types": raw.get("business_types") or [],
        "capability_tags": raw.get("capability_tags") or [],
        "countries_served": raw.get("countries_served") or [],
        "website": raw.get("website"),
        "verification": verification,
        "verification_label": _VERIFICATION_LABELS.get(verification, "Not checked"),
    }


async def find_providers_for_capabilities(
    capabilities: list[str], limit: int = FIND_PROVIDERS_LIMIT, match_all: bool = True
) -> list[dict]:
    """find_providers over the given (already-vocabulary-validated)
    capability terms, up to `limit` (always explicit — the catalog's own
    default is 3). A clean unknown_capability/other error envelope from the
    catalog is treated as zero results, not raised — this module only ever
    passes terms it just got from list_capabilities_async(), so that
    envelope would indicate the vocabulary drifted out from under the cache,
    not a caller bug; logged so it's visible either way.

    `match_all` (the catalog's own param, default True = ANDed): True for
    the single-item lookup (find_providers_for_item_async) — a checklist
    item's own 0-3 capability terms came from the SAME piece of text and
    should co-occur in a good match. find_providers_for_project_async below
    passes False (ANY) — a project-wide combined term set spans DIFFERENT
    checklist items describing unrelated gaps; ANDing them would only
    surface a provider that happens to do everything at once, which is not
    what "who can help with any of this project's gaps" means."""
    data = await _call_catalog(
        "find_providers", {"capabilities": capabilities, "limit": limit, "match_all": match_all}
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


async def classify_checklist_item_async(item_text: str) -> dict:
    """Free text -> 0-3 capability terms. THE ONE place this module calls an
    LLM. Called once, at checklist-item create/edit time (see
    frontend/lib/server/projects.ts) — never at page-load or click time.

    Returns {item_text, matched_capabilities}. matched_capabilities == [] IS
    the "needs a person / an internal task, not a service" signal — never
    raises for that normal outcome. DOES raise on a genuine service failure
    (vocab fetch failed, the LLM call itself failing outright) — the HTTP
    route in server.py turns that into a degraded (matched_capabilities=[],
    the safe fallback) response, same resilience contract as the rest of
    this service.

    Logs once: item text, matched terms."""
    text = (item_text or "").strip()
    if not text:
        return {"item_text": item_text, "matched_capabilities": []}

    vocab = await list_capabilities_async()
    matched = _map_item_to_capabilities(text, vocab)
    logger.info("find_provider classify: item=%r matched=%r", text, matched)
    return {"item_text": item_text, "matched_capabilities": matched}


async def find_providers_for_item_async(item_text: str, capabilities: list[str]) -> dict:
    """Given ALREADY-KNOWN capability terms (read from the checklist item's
    stored matched_capabilities column, not computed here), query the
    catalog. Zero LLM calls — this is what makes a "Find a service
    provider" click cost nothing beyond a plain catalog search.

    `item_text` is carried through for the one log line only (see below);
    it plays no role in the search itself. `capabilities` is trusted as
    already-vocabulary-valid (it was classified once by
    classify_checklist_item_async and never hand-edited), but an empty list
    short-circuits to zero results without even calling the catalog — the
    frontend shouldn't be showing "Find a service provider" for an item
    with no matched capabilities in the first place, so this is a defensive
    backstop, not the primary gate.

    Returns {item_text, matched_capabilities, providers, count}. Never
    raises for the normal "no capabilities to search" case; DOES raise on a
    genuine catalog failure, same resilience contract as everywhere else in
    this service (the HTTP route degrades it to a 200).

    Logs exactly once: item text, capability terms, result count — the
    other half of this feature's only persistence (see module docstring)."""
    if not capabilities:
        logger.info("find_provider lookup: item=%r capabilities=[] results=0 (nothing to search)", item_text)
        return {"item_text": item_text, "matched_capabilities": [], "providers": [], "count": 0}

    providers = await find_providers_for_capabilities(capabilities)
    logger.info(
        "find_provider lookup: item=%r capabilities=%r results=%d", item_text, capabilities, len(providers)
    )
    return {
        "item_text": item_text,
        "matched_capabilities": capabilities,
        "providers": providers,
        "count": len(providers),
    }


# ── Step 3: project-level — the SAME matcher, reused, not rebuilt ─────────────
#
# "New section on the project page" does NOT mean a new matcher. This
# collects the capability terms ALREADY stored on the project's checklist
# items (computed once each, at add/edit time, by classify_checklist_item_
# async — see that function's own docstring), queries the catalog ONCE for
# their combined set, and maps each returned provider back to which
# checklist item(s) it covers. Zero LLM calls, same as find_providers_for_
# item_async above — this is a different SHAPE of the same already-known
# data, not a new classification pass.


def find_providers_for_project(checklist_items: list[dict]) -> tuple[list[dict], int]:
    """Pure, synchronous helper (no network) that decides WHICH capability
    terms are worth searching for and — once results come back — which
    checklist item(s) each result covers. Split out from the async function
    below so the matching logic itself (the part actually worth testing) has
    no network dependency.

    `checklist_items` is [{"id", "label", "matched_capabilities"}, ...] —
    exactly the shape frontend/lib/server/projects.ts's ChecklistItem
    already carries. Items with matched_capabilities=[] contribute nothing
    (nothing to search for) and are silently skipped here, same as they are
    everywhere else in this feature.

    Returns (all_capabilities_to_search, items_with_capabilities_count) —
    the caller does the actual catalog round trip with the first element."""
    items_with_caps = [
        i for i in checklist_items if isinstance(i.get("matched_capabilities"), list) and i["matched_capabilities"]
    ]
    all_caps = sorted({c for i in items_with_caps for c in i["matched_capabilities"]})
    return all_caps, items_with_caps


def _attach_matched_items(providers: list[dict], items_with_caps: list[dict]) -> list[dict]:
    """For each provider the catalog returned, which of THIS project's
    checklist items does it actually cover? Pure set intersection between
    the provider's own capability_tags (from the catalog) and each item's
    stored matched_capabilities — no second catalog call, no LLM, just
    cross-referencing data this function already has in hand. A provider
    the catalog returned that doesn't intersect ANY item (shouldn't happen
    given match_all=False was built from exactly these items' terms, but
    the catalog's own matching logic is not ours to assume perfect) is
    dropped rather than shown with an empty, meaningless "matches: []"."""
    out = []
    for provider in providers:
        provider_tags = set(provider.get("capability_tags") or [])
        matched_items = [
            {"id": i["id"], "label": i["label"]}
            for i in items_with_caps
            if provider_tags & set(i["matched_capabilities"])
        ]
        if not matched_items:
            continue
        out.append({**provider, "matched_items": matched_items})
    return out


async def find_providers_for_project_async(checklist_items: list[dict]) -> dict:
    """The project-level lookup. Returns
    {"providers": [...], "items_with_capabilities": N, "total_items": M} —
    each provider dict is _format_provider's own shape plus "matched_items":
    [{"id", "label"}, ...], naming exactly which checklist item(s) it
    covers (the frontend builds the one-line "how this helps YOU" sentence
    from that, not from anything generated here — see this module's own
    "description is forwarded verbatim, never generated" rule; the same
    discipline applies to the gap sentence: it quotes the item's own stored
    label, never invents a paraphrase).

    `items_with_capabilities` / `total_items` distinguish "nothing to
    search for" (no item has a matched capability) from "searched and found
    nothing" — both are legitimate zero-provider outcomes but mean
    different things to a caller deciding what to render (see this
    feature's own "genuinely no match" vs the exception path below).

    Raises the SAME way find_providers_for_capabilities does — a real
    catalog failure (the current 2026-08-23 outage, or any other) is NOT
    caught here; the HTTP route's try/except is what turns that into a
    distinct `error` field, same resilience contract as every other route
    in this module. This function returning normally always means the
    catalog answered, whether with providers or with nothing."""
    all_caps, items_with_caps = find_providers_for_project(checklist_items)
    if not all_caps:
        logger.info(
            "find_provider project lookup: 0 of %d checklist item(s) have matched capabilities — nothing to search",
            len(checklist_items),
        )
        return {"providers": [], "items_with_capabilities": 0, "total_items": len(checklist_items)}

    providers = await find_providers_for_capabilities(all_caps, match_all=False)
    providers = _attach_matched_items(providers, items_with_caps)
    logger.info(
        "find_provider project lookup: items_with_capabilities=%d/%d capabilities=%r providers=%d",
        len(items_with_caps), len(checklist_items), all_caps, len(providers),
    )
    return {
        "providers": providers,
        "items_with_capabilities": len(items_with_caps),
        "total_items": len(checklist_items),
    }
