// lib/server/promote/groqCall.ts — one Groq chat-completion call, with a single
// retry on rate limiting.
//
// WHY THIS EXISTS
// A /api/promote/generate request makes ONE Groq call (the article, up to
// max_tokens 3072 of a 12,000 tokens-per-MINUTE budget — this used to be two
// calls/~6,144 tokens when a funding-pitch/lay-summary generator ran
// alongside it; that generator is gone, this budget note isn't). Two users
// generating in the same minute can still empty the bucket, and the loser
// got a bare 500. Measured: 2 of 3 consecutive requests succeeded before
// this existed.
//
// Two things fix that, and they are different fixes:
//   * the CACHE (lib/serverCache.ts, applied in the route) stops the same paper
//     ever costing tokens twice — that is the big win;
//   * this retry absorbs the narrow case of two DIFFERENT papers colliding
//     inside one minute window.
//
// Groq's token bucket refills continuously and the reset is short (the
// x-ratelimit-reset-tokens header is typically sub-second to a few seconds), so
// one bounded wait is usually enough. We retry ONCE — never a loop, because a
// retry storm against a token limit makes the situation worse, not better.

import { ServerConfigError } from "@/lib/server/supabaseServer";

/** Thrown when Groq rate-limits us and the retry also fails. The route maps
 *  this to a friendly 503, distinct from a genuine 500. */
export class RateLimitedError extends Error {
  constructor(message = "The generator is busy right now — try again in a moment.") {
    super(message);
    this.name = "RateLimitedError";
  }
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Read from GROQ_MODEL (optional) with a hardcoded fallback, not a bare
// hardcoded string — Groq retired llama-3.3-70b-versatile on 2026-08-16
// with no warning, which broke this call in production for days before
// anyone noticed. An env var means the NEXT deprecation is a config change,
// not a code change + redeploy. `|| ` (not a two-arg default) so an
// explicitly-empty GROQ_MODEL="" falls back too, same reasoning as
// backend/explore-mcp/llm.py's LLM_MODEL.
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

// openai/gpt-oss-120b is a REASONING model: unlike llama-3.3-70b-versatile
// (the previous default, not a reasoning model), it spends hidden "thinking"
// tokens before it writes the visible answer, and those tokens count against
// the SAME max_tokens budget as the answer. Confirmed by direct reproduction
// against the real generate-extras prompt: at the DEFAULT reasoning effort,
// the model's reasoning alone consumed the full max_tokens: 2048 budget,
// truncated before any JSON was written, and Groq's response_format:
// json_object validator rejected the empty result with a 400
// json_validate_failed (failed_generation: "") — this is EXACTLY the error
// that was showing up as a 503 in production after the model swap.
// reasoning_effort: "low" cuts reasoning tokens roughly 5x on the same
// prompt (244 -> 44 in the reproduction) and leaves the answer comfortably
// inside budget without changing max_tokens per caller. Every Promote call
// here is a short, structurally simple generation task (a JSON object of a
// few paragraphs) that never needed deep reasoning in the first place.
const REASONING_EFFORT = "low";

/** How long to wait before the single retry. Prefers Groq's own
 *  `x-ratelimit-reset-tokens` / `retry-after` hint, clamped so a request can
 *  never hang on a long reset. */
function retryDelayMs(res: Response): number {
  const raw =
    res.headers.get("retry-after") ?? res.headers.get("x-ratelimit-reset-tokens") ?? "";
  // Values look like "205ms", "2.5s", or a bare seconds count.
  const m = /^([\d.]+)\s*(ms|s)?$/.exec(raw.trim());
  let ms = 1200; // sensible default when the header is absent/odd
  if (m) {
    const n = parseFloat(m[1]);
    if (Number.isFinite(n)) ms = m[2] === "ms" ? n : n * 1000;
  }
  return Math.min(Math.max(ms + 150, 300), 5000); // +150ms slack, 0.3s–5s
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST one chat completion and return the raw message content.
 * Retries ONCE on 429 (or 5xx, which Groq also uses when shedding load).
 *
 * @throws ServerConfigError  GROQ_API_KEY missing
 * @throws RateLimitedError   rate-limited, and the retry was too
 * @throws Error              any other upstream failure
 */
export async function groqComplete(opts: {
  system: string;
  user: string;
  maxTokens: number;
  label: string; // for logs, e.g. "generate-posts"
  temperature?: number;
  // JSON mode: both existing Promote callers parse structured JSON, and
  // without response_format: json_object the model emits literal newlines
  // inside string values, which JSON.parse rejects. Defaults to true so
  // generateArticle.ts/generateExtras.ts need no change to keep that
  // behaviour. Groq REJECTS json_object mode with a 400 unless the word
  // "json" appears somewhere in the messages (a chatbot answering in plain
  // prose won't say that) — set json: false for a prose caller instead of
  // gaming the prompt with the word "json" just to satisfy the mode check.
  json?: boolean;
}): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new ServerConfigError("GROQ_API_KEY not configured");

  const useJson = opts.json ?? true;

  // Built as a function, not a fixed string: `withReasoningEffort` toggles
  // off for the fallback retry below, when the currently-configured MODEL
  // turns out not to be a reasoning model after all (see that retry's own
  // comment). Everything else about the request is identical either way.
  const buildBody = (withReasoningEffort: boolean) =>
    JSON.stringify({
      model: MODEL,
      ...(withReasoningEffort ? { reasoning_effort: REASONING_EFFORT } : {}),
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens,
      ...(useJson ? { response_format: { type: "json_object" } } : {}),
    });

  const send = (body: string) =>
    fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
      body,
    });

  let useReasoningEffort = true;
  let res = await send(buildBody(useReasoningEffort));

  // MODEL-DOESN'T-SUPPORT-reasoning_effort FALLBACK. Confirmed directly
  // against Groq: a model without reasoning support 400s this exact param
  // with `"reasoning_effort" is not supported with this model` rather than
  // ignoring it — so if GROQ_MODEL is ever swapped to a non-reasoning model
  // (the same kind of unannounced-deprecation swap that broke this file
  // once already), sending reasoning_effort unconditionally would turn
  // every call into a hard failure instead of degrading. One silent retry
  // without the param, same "retry once, never a loop" discipline as the
  // 429/5xx branch below — this is a config mismatch to route around, not
  // a transient failure to log loudly about. useReasoningEffort flips to
  // false for the REST of this call (including the 429/5xx retry just
  // below) so a later retry can't reintroduce the same rejected param.
  if (res.status === 400) {
    const cloned = res.clone();
    const text = await cloned.text().catch(() => "");
    if (text.includes("reasoning_effort")) {
      useReasoningEffort = false;
      res = await send(buildBody(useReasoningEffort));
    }
  }

  if (res.status === 429 || res.status >= 500) {
    const wait = retryDelayMs(res);
    console.warn(
      `Groq ${res.status} (${opts.label}); retrying once in ${wait}ms`
    );
    await sleep(wait);
    res = await send(buildBody(useReasoningEffort));
  }

  if (!res.ok) {
    const detail = await res.text();
    console.error(`Groq API error (${opts.label}):`, res.status, detail.slice(0, 400));
    if (res.status === 429) throw new RateLimitedError();
    throw new Error("AI service unavailable. Please try again.");
  }

  const data = await res.json();
  return (data.choices?.[0]?.message?.content as string) ?? "";
}
