// lib/server/promote/groqCall.ts — one Groq chat-completion call, with a single
// retry on rate limiting.
//
// WHY THIS EXISTS
// A /api/promote/generate request makes TWO Groq calls (4 LinkedIn variants at
// max_tokens 4096 + the funding/lay pair at 2048 = ~6,144 of a 12,000
// tokens-per-MINUTE budget). Two users generating in the same minute can empty
// the bucket, and the loser got a bare 500. Measured: 2 of 3 consecutive
// requests succeeded before this existed.
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
const MODEL = "llama-3.3-70b-versatile";

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
  // generatePosts.ts/generateExtras.ts need no change to keep that
  // behaviour. Groq REJECTS json_object mode with a 400 unless the word
  // "json" appears somewhere in the messages (a chatbot answering in plain
  // prose won't say that) — set json: false for a prose caller instead of
  // gaming the prompt with the word "json" just to satisfy the mode check.
  json?: boolean;
}): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new ServerConfigError("GROQ_API_KEY not configured");

  const useJson = opts.json ?? true;

  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens,
    ...(useJson ? { response_format: { type: "json_object" } } : {}),
  });

  const send = () =>
    fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
      body,
    });

  let res = await send();

  if (res.status === 429 || res.status >= 500) {
    const wait = retryDelayMs(res);
    console.warn(
      `Groq ${res.status} (${opts.label}); retrying once in ${wait}ms`
    );
    await sleep(wait);
    res = await send();
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
