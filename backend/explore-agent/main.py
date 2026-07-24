"""
Explore Agent — minimal scaffold (first pass).

A standalone FastAPI service, completely separate from backend/podcast-agent/ (the
podcast pipeline). Its only job here is to PROVE the core agentic loop:

    free-text input  ->  LLM reasons about whether a literature search is warranted
                     ->  if yes, it calls the one real tool (search_papers)
                     ->  the tool proxies the EXISTING Next.js /api/discover endpoint
                     ->  we return BOTH the tool-call decision and the real result.

One tool only. No database, no auth, no other sources — that's all intentionally
out of scope for this scaffold.
"""

from __future__ import annotations

import json
import os

import requests
from dotenv import load_dotenv
from fastapi import FastAPI
from groq import Groq
from pydantic import BaseModel

# Load GROQ_API_KEY from a local .env (in this directory) or the process env. This
# reuses the SAME key the Next.js app uses — we do not mint a new one, and we never
# touch backend/podcast-agent/'s env.
load_dotenv()

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
# The already-running Next.js app that owns /api/discover. Override if it's not on
# the default dev port.
NEXTJS_BASE_URL = os.environ.get("NEXTJS_BASE_URL", "http://localhost:3000")
# Same model used elsewhere in this project.
MODEL = "llama-3.3-70b-versatile"

app = FastAPI(title="Explore Agent (scaffold)")


# ── Request / response models ─────────────────────────────────────────────────
class ExploreRequest(BaseModel):
    input: str


# ── The one tool ──────────────────────────────────────────────────────────────
def search_papers(query: str) -> dict:
    """Thin proxy to the EXISTING /api/discover endpoint — no PubMed/Crossref logic
    is reimplemented here. Returns the real JSON the Next.js endpoint produces."""
    resp = requests.get(
        f"{NEXTJS_BASE_URL}/api/discover",
        params={"q": query},
        timeout=45,
    )
    resp.raise_for_status()
    return resp.json()


# The tool definition handed to the model. The description is what the model reasons
# over when deciding whether to call it.
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_papers",
            "description": (
                "Search the live scientific literature (PubMed, OpenAlex, Crossref, "
                "bioRxiv, ClinicalTrials.gov, patents) for work relevant to a research "
                "topic. Call this ONLY when the user's input describes a scientific or "
                "biomedical topic, disease, drug, target, method, or question that can be "
                "turned into a literature search. Do NOT call it for administrative, "
                "funding, logistical, or otherwise non-scientific inputs, or when there is "
                "nothing meaningful to search for."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "A concise keyword query extracted from the user's input, e.g. "
                            "'glioblastoma EGFR inhibitors' or 'CRISPR base editing sickle cell'."
                        ),
                    }
                },
                "required": ["query"],
            },
        },
    }
]

SYSTEM_PROMPT = (
    "You are Explore, a research assistant for drug-discovery scientists. "
    "Decide whether the researcher's message warrants a scientific literature search. "
    "If it describes a scientific/biomedical topic, disease, target, molecule, or method, "
    "call the search_papers tool with a concise query extracted from their message. "
    "If the message is clearly NOT a literature question (for example it is about funding, "
    "scheduling, or administration) or there is nothing meaningful to search for, do NOT "
    "call any tool — instead reply briefly that no literature search applies and why."
)


def _compact_for_model(result: dict) -> str:
    """Shrink the /api/discover payload before feeding it back to the model for its
    summary — the caller still gets the FULL result in the response."""
    items = result.get("items", []) if isinstance(result, dict) else []
    trimmed = [
        {
            "title": it.get("title"),
            "source": it.get("source"),
            "year": it.get("year"),
        }
        for it in items[:8]
    ]
    return json.dumps({"query": result.get("query"), "count": len(items), "top": trimmed})


# ── The agent loop ────────────────────────────────────────────────────────────
@app.post("/explore")
def explore(req: ExploreRequest) -> dict:
    if not GROQ_API_KEY:
        return {"error": "GROQ_API_KEY is not set. Put it in backend/explore-agent/.env."}

    client = Groq(api_key=GROQ_API_KEY)
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": req.input},
    ]

    # 1) Let the model decide whether to call the tool.
    first = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        tools=TOOLS,
        tool_choice="auto",
        temperature=0.2,
    )
    choice = first.choices[0].message
    tool_calls = choice.tool_calls or []

    # No tool call → the model judged this not a literature question. Return its reasoning.
    if not tool_calls:
        return {
            "input": req.input,
            "tool_called": None,
            "tool_argument": None,
            "tool_result": None,
            "agent_message": choice.content,
        }

    # 2) Execute the tool call(s). Only search_papers exists in this pass; we answer
    # every call the model made so the follow-up request is API-valid.
    messages.append(
        {
            "role": "assistant",
            "content": choice.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in tool_calls
            ],
        }
    )

    primary = None  # the first call, reported at the top level for readability
    for tc in tool_calls:
        try:
            args = json.loads(tc.function.arguments or "{}")
        except json.JSONDecodeError:
            args = {}
        query = args.get("query", "")

        if tc.function.name == "search_papers":
            try:
                result = search_papers(query)
                tool_payload = _compact_for_model(result)
                tool_error = None
            except Exception as exc:  # e.g. Next.js not running
                result = None
                tool_error = f"search_papers failed: {exc}"
                tool_payload = json.dumps({"error": tool_error})
        else:
            result = None
            tool_error = f"Unknown tool: {tc.function.name}"
            tool_payload = json.dumps({"error": tool_error})

        messages.append(
            {
                "role": "tool",
                "tool_call_id": tc.id,
                "name": tc.function.name,
                "content": tool_payload,
            }
        )

        if primary is None:
            primary = {
                "tool_called": tc.function.name,
                "tool_argument": {"query": query},
                "tool_result": result,
                "tool_error": tool_error,
            }

    # 3) Give the model the tool result so it can produce a short final answer.
    second = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        temperature=0.2,
    )
    agent_message = second.choices[0].message.content

    return {
        "input": req.input,
        "tool_called": primary["tool_called"],
        "tool_argument": primary["tool_argument"],
        "tool_error": primary["tool_error"],
        "tool_result": primary["tool_result"],
        "agent_message": agent_message,
    }


@app.get("/")
def health() -> dict:
    return {"service": "explore-agent", "status": "ok", "model": MODEL}
