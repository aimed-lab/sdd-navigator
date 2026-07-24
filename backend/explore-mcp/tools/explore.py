"""
tools/explore.py — the orchestration tool.

Takes a scientist's free-text message and, in order:
  1. extracts a structured SCOPE from it (topics/genes/diseases/assets/methods)
     via the LLM — empty fields are expected and left empty, never invented;
  2. lets the LLM CHOOSE which of the search tools fit the message (parallel tool
     calls enabled) — it does NOT always call both;
  3. builds each chosen tool's query from the RIGHT slice of scope — papers get
     topics+diseases+genes; lab resources get methods+genes (a technique/model
     search, NOT the disease name, which is useless as a resource query);
  4. runs the chosen tools in parallel (failures isolated);
  5. returns {scope, sections:[{kind, items}], tools_called}.

The LLM only DECIDES which tools to run; the actual query strings are built
deterministically here from scope, so the two tools never get the same string.
No ranking is ever claimed that isn't backed by a real signal (see models.Signal).
"""

from __future__ import annotations

import asyncio
import json
import re

import llm
from tools.search_lab_resources import search_lab_resources
from tools.search_papers import search_papers_async

SCOPE_KEYS = ["topics", "genes", "diseases", "assets", "methods"]

_PAPER_LIMIT = 10
_RESOURCE_LIMIT = 20

# ── Step 1: scope extraction ─────────────────────────────────────────────────

_SCOPE_SYSTEM = (
    "You extract a structured research scope from a scientist's message. "
    "Return ONLY a JSON object with exactly these keys, each an array of short strings:\n"
    "  topics   — the overall research subject phrases\n"
    "  genes    — gene / protein symbols (e.g. PHGDH, EGFR)\n"
    "  diseases — disease or condition names (e.g. Alzheimer's disease, glioblastoma)\n"
    "  assets   — named molecules / drugs / compounds\n"
    "  methods  — experimental techniques, assays, model systems, or data types "
    "(e.g. RNA-seq, CRISPR screen, mouse model)\n"
    "Leave an array EMPTY if the message has nothing for it. NEVER invent values to "
    "fill an empty field. Output JSON only — no prose, no code fences."
)


def _loads_lenient(content: str | None) -> dict:
    """Parse a JSON object out of an LLM reply, tolerating code fences / prose."""
    if not content:
        return {}
    try:
        return json.loads(content)
    except (json.JSONDecodeError, TypeError):
        pass
    m = re.search(r"\{.*\}", content, re.DOTALL)  # first {...} block
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}
    return {}


def _normalize_scope(data: dict) -> dict:
    """Coerce to the fixed 5-key shape, each a list of non-empty strings."""
    out: dict[str, list[str]] = {}
    for key in SCOPE_KEYS:
        raw = data.get(key) if isinstance(data, dict) else None
        values = raw if isinstance(raw, list) else []
        out[key] = [str(v).strip() for v in values if str(v).strip()]
    return out


def _extract_scope(input_text: str) -> dict:
    resp = llm.complete(
        [{"role": "system", "content": _SCOPE_SYSTEM}, {"role": "user", "content": input_text}],
        temperature=0,
    )
    return _normalize_scope(_loads_lenient(resp.content))


# ── Step 2: tool choice ──────────────────────────────────────────────────────

_TOOL_CHOICE_SYSTEM = (
    "You are Explore, a research assistant for drug-discovery scientists. You have two tools:\n"
    "  • search_papers        — the live scientific literature (PubMed, OpenAlex, Crossref).\n"
    "  • search_lab_resources — an INTERNAL registry of lab techniques, equipment, animal "
    "models, cell lines, vectors, reagents, software, drugs, and PEOPLE available for "
    "collaboration.\n"
    "Decide which tool(s) fit the user's message and call them. Rules:\n"
    "  • Call ONLY tools that fit. Calling one tool, or several, are both correct.\n"
    "  • A message describing DATA or a METHOD the user already has (e.g. 'I have RNA-seq "
    "datasets') should pull INTERNAL RESOURCES and PEOPLE (search_lab_resources) who can "
    "help — not only papers.\n"
    "  • A scientific target/topic/disease (e.g. 'PHGDH in Alzheimer's') should pull BOTH "
    "papers AND internal resources.\n"
    "  • Do NOT default to calling both tools every time — choose based on the message.\n"
    "  • Never claim a ranking that isn't backed by a real signal.\n"
    "You may call tools in parallel. The query arguments you pass are placeholders; the "
    "system builds the real per-tool queries."
)

_TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "search_papers",
            "description": (
                "Search the live scientific literature for papers relevant to a research "
                "topic, target, gene, disease, or method."
            ),
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "A topical query."}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_lab_resources",
            "description": (
                "Search the INTERNAL lab-resource registry — techniques, equipment, models, "
                "cell lines, reagents, software, and people available for collaboration. Use "
                "this when the user has data/methods or needs a capability, technique, or "
                "collaborator, not a disease name."
            ),
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "A technique/method/capability query."}},
                "required": ["query"],
            },
        },
    },
]

_KNOWN_TOOLS = {"search_papers", "search_lab_resources"}


def _heuristic_tools(scope: dict) -> list[str]:
    """Deterministic scope-based tool choice — the fallback when the LLM's
    tool-calling path is unavailable (e.g. a provider's function-call parser
    rejects the model output). Mirrors the same intent as the system prompt:
    a topical scope pulls papers; methods/genes pull internal resources."""
    chosen: list[str] = []
    if any(scope[k] for k in ("topics", "diseases", "genes", "assets")):
        chosen.append("search_papers")
    if any(scope[k] for k in ("methods", "genes")):
        chosen.append("search_lab_resources")
    return chosen


def _choose_tools(input_text: str, scope: dict) -> list[str]:
    """Ask the LLM which tools fit (primary), falling back to a deterministic
    scope heuristic if the provider's tool-calling errors or returns nothing.

    Only the CHOICE (tool names) is used — the model's query args are ignored;
    the real per-tool queries are built from scope in step 3.
    """
    scope_hint = json.dumps(scope)
    try:
        resp = llm.complete(
            [
                {"role": "system", "content": _TOOL_CHOICE_SYSTEM},
                {"role": "user", "content": f"Message: {input_text}\nExtracted scope: {scope_hint}"},
            ],
            tools=_TOOL_SCHEMAS,
            tool_choice="auto",   # parallel tool calls enabled by default
        )
        chosen: list[str] = []
        for call in resp.tool_calls:
            if call.name in _KNOWN_TOOLS and call.name not in chosen:
                chosen.append(call.name)
        if chosen:
            return chosen
        # Model replied without a usable tool call — fall through to the heuristic.
    except Exception:
        # Provider tool-call parse/transport failure (e.g. groq tool_use_failed on
        # a llama pythonic-format emission) — don't let it sink orchestration.
        pass
    return _heuristic_tools(scope)


# ── Step 3: per-tool query construction ──────────────────────────────────────


def _join_unique(*groups: list[str]) -> str:
    """Join terms across groups, de-duplicating case-insensitively, preserving order."""
    seen: set[str] = set()
    out: list[str] = []
    for group in groups:
        for term in group:
            t = (term or "").strip()
            if not t or t.lower() in seen:
                continue
            seen.add(t.lower())
            out.append(t)
    return " ".join(out)


def _paper_query(scope: dict) -> str:
    # Papers get the full topical scope.
    return _join_unique(scope["topics"], scope["diseases"], scope["genes"])


def _resource_query(scope: dict) -> str:
    # Lab resources get technique/model terms — NOT the disease name.
    return _join_unique(scope["methods"], scope["genes"])


# ── Steps 4–5: execute chosen tools in parallel and assemble the result ───────


async def _execute(chosen: list[str], scope: dict) -> list[dict]:
    paper_q = _paper_query(scope)
    resource_q = _resource_query(scope)

    tasks = []
    specs: list[tuple[str, str, str]] = []  # (tool, kind, query)
    for name in chosen:
        if name == "search_papers":
            tasks.append(search_papers_async(paper_q, _PAPER_LIMIT))
            specs.append(("search_papers", "paper", paper_q))
        elif name == "search_lab_resources":
            # search_lab_resources is blocking (requests) — run it off the loop.
            tasks.append(asyncio.to_thread(search_lab_resources, resource_q, None, _RESOURCE_LIMIT))
            specs.append(("search_lab_resources", "resource", resource_q))

    results = await asyncio.gather(*tasks, return_exceptions=True) if tasks else []

    sections: list[dict] = []
    for (tool, kind, query), result in zip(specs, results):
        section: dict = {"tool": tool, "kind": kind, "query": query}
        if isinstance(result, Exception):
            # one tool failing never sinks the others; report an empty, flagged section
            section["items"] = []
            section["error"] = f"{type(result).__name__}: {result}"
        else:
            section["items"] = [item.model_dump() for item in result]
        sections.append(section)
    return sections


async def explore_async(input_text: str) -> dict:
    """Async orchestration core (used by the MCP server). The blocking LLM calls
    run off the event loop so the tool fan-out stays concurrent."""
    scope = await asyncio.to_thread(_extract_scope, input_text)
    chosen = await asyncio.to_thread(_choose_tools, input_text, scope)
    sections = await _execute(chosen, scope)
    return {
        "input": input_text,
        "scope": scope,
        "tools_called": chosen,
        "sections": sections,
    }


def explore(input_text: str) -> dict:
    """Synchronous entry point (the registered tool signature).

    Reason about a free-text research message, choose which search tools fit, run
    them with the right per-tool query, and return results grouped by kind:
    {scope, sections:[{kind, items}], tools_called}.
    """
    return asyncio.run(explore_async(input_text))
