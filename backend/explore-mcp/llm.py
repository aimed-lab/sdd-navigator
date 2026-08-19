"""
llm.py — provider-agnostic LLM wrapper.

The ONLY module in explore-mcp allowed to import an LLM SDK. Every other file
(tools/explore.py in particular) talks to the model exclusively through
`complete()` and the normalized `LLMResponse` returned here, so swapping
providers never touches call sites.

Configuration (env):
    LLM_PROVIDER   provider id — "groq" (default) | "openai"
    LLM_MODEL      model id     — default "openai/gpt-oss-120b"
    LLM_API_KEY    API key      — falls back to GROQ_API_KEY when unset

groq and openai share the OpenAI chat-completions wire format (same request
kwargs, same `choices[0].message` shape with `.content` and `.tool_calls`), so
one normalization path covers both. Any other provider raises NotImplementedError.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_PROVIDER = "groq"
# Groq retired llama-3.3-70b-versatile on 2026-08-16 — was the default here
# and took down production plus a local test run until it was caught.
DEFAULT_MODEL = "openai/gpt-oss-120b"

# openai/gpt-oss-120b is a REASONING model: it spends hidden "thinking"
# tokens before it writes the visible answer — billed the same as any other
# completion token, on a service that's on a daily token cap. Confirmed by
# direct measurement against the real explore() prompts: reasoning was ~30%
# of total tokens per call at the default effort. reasoning_effort: "low"
# cuts that sharply (measured ~90% reduction in reasoning tokens on the same
# prompts) with no loss of JSON validity, for every call site here — scope
# extraction, tool routing, the project agent's relevance/checklist passes,
# and find_provider's capability mapping are all short, structurally simple
# JSON-shaped tasks that never needed deep reasoning.
REASONING_EFFORT = "low"


# ── Normalized response types ────────────────────────────────────────────────
# Call sites read these dataclasses, never raw SDK objects.


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]        # parsed JSON args (empty dict if unparseable)
    arguments_json: str              # original JSON string, for echoing back to the model


@dataclass
class LLMResponse:
    content: str | None
    tool_calls: list[ToolCall] = field(default_factory=list)
    # An OpenAI-format assistant message ready to append to `messages` before the
    # follow-up call (so the tool results that follow are wire-valid).
    assistant_message: dict[str, Any] = field(default_factory=dict)

    @property
    def has_tool_calls(self) -> bool:
        return bool(self.tool_calls)


# ── Provider clients (SDKs imported lazily so only the chosen one is required) ─


def _resolve_api_key() -> str:
    key = os.environ.get("LLM_API_KEY") or os.environ.get("GROQ_API_KEY")
    if not key:
        raise RuntimeError(
            "No LLM API key: set LLM_API_KEY (or GROQ_API_KEY) in the environment."
        )
    return key


def _groq_client(api_key: str):
    from groq import Groq  # lazy: only imported when provider == groq

    return Groq(api_key=api_key)


def _openai_client(api_key: str):
    from openai import OpenAI  # lazy: only imported when provider == openai

    return OpenAI(api_key=api_key)


def _build_client(provider: str, api_key: str):
    if provider == "groq":
        return _groq_client(api_key)
    if provider == "openai":
        return _openai_client(api_key)
    raise NotImplementedError(
        f"LLM_PROVIDER={provider!r} is not supported (only 'groq' and 'openai')."
    )


# ── Public API ───────────────────────────────────────────────────────────────


def complete(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str = "auto",
    *,
    temperature: float = 0.2,
) -> LLMResponse:
    """Run one chat completion and return a normalized `LLMResponse`.

    `messages` are OpenAI-format dicts (role/content, plus assistant tool_calls
    and tool messages on follow-up turns). When `tools` is provided the model may
    emit parallel tool calls; they arrive normalized on `LLMResponse.tool_calls`.
    """
    # Sourced with `or`, not the two-arg os.environ.get(KEY, default) form:
    # an explicitly-empty env var (LLM_PROVIDER="" / LLM_MODEL="") must fall
    # back to the default exactly like an unset one. The two-arg .get() only
    # applies its default when the var is entirely ABSENT — an empty string
    # is still "set" as far as it's concerned, so it would pass "" straight
    # through to the SDK/API call. This exact absent-vs-empty distinction
    # already took the container down once via MCP_PORT; don't reintroduce
    # it here (see server.py's EXPLORE_API_TOKEN for the same fix pattern).
    provider = (os.environ.get("LLM_PROVIDER") or DEFAULT_PROVIDER).lower()
    model = os.environ.get("LLM_MODEL") or DEFAULT_MODEL
    client = _build_client(provider, _resolve_api_key())

    def build_kwargs(with_reasoning_effort: bool) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice
        if with_reasoning_effort:
            kwargs["reasoning_effort"] = REASONING_EFFORT
        return kwargs

    try:
        resp = client.chat.completions.create(**build_kwargs(True))
    except Exception as exc:
        # MODEL-DOESN'T-SUPPORT-reasoning_effort FALLBACK — same self-healing
        # retry as frontend/lib/server/promote/groqCall.ts. Confirmed
        # directly against Groq: a non-reasoning model 400s this exact param
        # with "reasoning_effort is not supported with this model" rather
        # than ignoring it. If LLM_MODEL is ever swapped to a non-reasoning
        # model (the same kind of unannounced-deprecation swap that broke
        # this file once already — see DEFAULT_MODEL's own history above),
        # sending reasoning_effort unconditionally would turn every call
        # into a hard failure instead of degrading. One silent retry without
        # the param — never a loop, and only for this specific rejection;
        # any other exception (quota, network, a real bad request) still
        # propagates unchanged.
        status = getattr(exc, "status_code", None)
        if status == 400 and "reasoning_effort" in str(exc):
            logger.info(
                "llm.complete: model=%r rejected reasoning_effort, retrying without it", model
            )
            resp = client.chat.completions.create(**build_kwargs(False))
        else:
            raise
    return _normalize(resp)


def _normalize(resp: Any) -> LLMResponse:
    """Fold a groq/openai SDK response into the provider-agnostic LLMResponse."""
    msg = resp.choices[0].message
    raw_calls = getattr(msg, "tool_calls", None) or []

    tool_calls: list[ToolCall] = []
    echo_calls: list[dict[str, Any]] = []
    for tc in raw_calls:
        args_json = tc.function.arguments or "{}"
        try:
            parsed = json.loads(args_json)
        except json.JSONDecodeError:
            parsed = {}
        tool_calls.append(
            ToolCall(id=tc.id, name=tc.function.name, arguments=parsed, arguments_json=args_json)
        )
        echo_calls.append(
            {
                "id": tc.id,
                "type": "function",
                "function": {"name": tc.function.name, "arguments": args_json},
            }
        )

    assistant_message: dict[str, Any] = {"role": "assistant", "content": msg.content or ""}
    if echo_calls:
        assistant_message["tool_calls"] = echo_calls

    return LLMResponse(
        content=msg.content,
        tool_calls=tool_calls,
        assistant_message=assistant_message,
    )
