// lib/server/validation.ts — the quality layer for live Discovery/research results.
//
// WHERE IT SITS: after runDiscover has fetched + scored + sorted its items, and
// BEFORE they're returned to the UI (see lib/server/discovery.ts). Because BOTH
// the Discovery feed and Navigator's per-phase research go through runDiscover,
// this one layer serves both.
//
// STARLING METHODOLOGY: we do NOT collapse quality into one opaque number. Every
// result is scored on NAMED AXES, each yielding a { verdict, reason } — so we can
// always explain WHY something was dropped or demoted, not just that its score
// was low. The four axes:
//   • relevance — LLM judge (Groq): does the result actually match the query focus?
//   • recency   — rule: DROP impossible future dates, FLAG stale items.
//   • integrity — rule: DROP malformed/empty/junk results.
//   • dedup     — rule: DROP near-duplicate titles that slipped past URL dedup.
//
// HYBRID (cost/latency): the three rule axes are cheap and run on EVERYTHING to
// drop the obvious junk first. The LLM relevance judge runs ONLY on the survivors,
// capped at the top-N candidates and batched into a SINGLE Groq call per feed
// load (never one call per item). The judge is also flag-gated so it can be
// switched off entirely (env DISCOVERY_LLM_JUDGE=off) when latency/cost matters.
//
// FAIL-OPEN: this is a live feed. If anything here throws — a bug, a flaky LLM —
// we return the ORIGINAL, unvalidated items rather than an empty feed. A judge
// call that errors or times out is treated as "pass", never as a block.

import type { DiscoverItem } from "@/types/discover";

// ── Named axes + verdicts (the Starling shape) ────────────────────────────────

export type ValidationAxis = "relevance" | "recency" | "integrity" | "dedup";
export type Verdict = "pass" | "flag" | "fail";

export type AxisResult = { verdict: Verdict; reason: string };

// The per-item validation record, kept WITH the item (see DiscoverItem.validation)
// so anything downstream — or a developer debugging the feed — can read exactly
// why an item passed, was flagged, or (for dropped items, via the debug log) failed.
export type ItemValidation = {
  overall: Verdict;
  axes: Partial<Record<ValidationAxis, AxisResult>>;
};

// ── Configurable thresholds (no magic numbers buried in the logic) ────────────

export type ValidationConfig = {
  /** FLAG (don't drop) any item older than this many days. */
  recencyStaleDays: number;
  /** Days past today a date may be before it's treated as impossible → DROP. */
  futureToleranceDays: number;
  /** Cap on how many top candidates the LLM judge sees per feed load. */
  maxLlmJudged: number;
  /** Master switch for the LLM relevance judge. */
  llmJudgeEnabled: boolean;
  /** Groq model + timeout for the judge call. */
  llmModel: string;
  llmTimeoutMs: number;
};

// Defaults are resolved per-call (not at module load) so env changes and
// per-call overrides both take effect. The LLM judge is ON unless explicitly
// disabled via env, so the feature is opt-OUT for operators, opt-IN for tests.
function resolveConfig(overrides?: Partial<ValidationConfig>): ValidationConfig {
  const base: ValidationConfig = {
    recencyStaleDays: 365 * 3, // ~3 years — older literature still shows, just demoted
    futureToleranceDays: 2, // small clock/timezone slack; beyond this a date is impossible
    maxLlmJudged: 20, // one Groq call judges at most the top 20 survivors
    llmJudgeEnabled: process.env.DISCOVERY_LLM_JUDGE !== "off",
    llmModel: "llama-3.3-70b-versatile",
    llmTimeoutMs: 8000,
  };
  return { ...base, ...overrides };
}

// ── Rule axis: integrity ──────────────────────────────────────────────────────
// Drops results that are structurally unusable — a card with no title or no link
// is junk no matter how relevant it might be. Conservative: only obvious failures.

const MIN_TITLE_LEN = 4;

function checkIntegrity(item: DiscoverItem): AxisResult {
  const title = (item.title ?? "").trim();
  if (title.length < MIN_TITLE_LEN) {
    return { verdict: "fail", reason: `Missing or too-short title (${title.length} chars)` };
  }
  const url = (item.url ?? "").trim();
  if (!url) return { verdict: "fail", reason: "Missing URL" };
  if (!/^https?:\/\//i.test(url)) {
    return { verdict: "fail", reason: `Non-http(s) URL: ${url.slice(0, 40)}` };
  }
  return { verdict: "pass", reason: "Well-formed" };
}

// ── Rule axis: recency ────────────────────────────────────────────────────────
// Future-dated results are impossible for most types and get DROPPED. Grants are
// the documented exception — Grants.gov forecasted opportunities are legitimately
// future-dated — so they're never dropped on this axis. Stale items are FLAGGED
// (still shown, ranked lower), never dropped: old ≠ wrong.

function checkRecency(item: DiscoverItem, cfg: ValidationConfig, now: number): AxisResult {
  const t = new Date(item.dateISO).getTime();
  if (isNaN(t)) return { verdict: "pass", reason: "No parseable date" }; // can't judge → don't punish

  const futureMs = t - now;
  if (item.type !== "grant" && futureMs > cfg.futureToleranceDays * 86_400_000) {
    const days = Math.round(futureMs / 86_400_000);
    return { verdict: "fail", reason: `Impossible future date (+${days}d)` };
  }

  const ageDays = (now - t) / 86_400_000;
  if (ageDays > cfg.recencyStaleDays) {
    return { verdict: "flag", reason: `Stale (${Math.round(ageDays / 365)}y old)` };
  }
  return { verdict: "pass", reason: "Current" };
}

// ── Rule axis: dedup ──────────────────────────────────────────────────────────
// runDiscover already dedupes by URL/DOI before scoring. This is the near-dup
// sweep it can't do: the SAME paper surfaced by two sources under slightly
// different URLs but an (almost) identical title. First occurrence wins; later
// ones FAIL (drop). The caller passes a shared `seenTitles` set so the sweep is
// stable across the whole batch.

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function checkDedup(item: DiscoverItem, seenTitles: Set<string>): AxisResult {
  const key = normalizeTitle(item.title ?? "");
  if (!key) return { verdict: "pass", reason: "No title to key on" };
  if (seenTitles.has(key)) {
    return { verdict: "fail", reason: "Near-duplicate title of an earlier result" };
  }
  seenTitles.add(key);
  return { verdict: "pass", reason: "Unique title" };
}

// ── LLM axis: relevance ───────────────────────────────────────────────────────
// The one axis a keyword rule can't do honestly — does the result actually match
// what the user is asking about? Injectable so tests run without a network/key,
// and so the default (Groq) can be swapped. Contract: return a verdict+reason per
// item id; ANY item id it omits is treated as "pass" (fail-open per item).

export type RelevanceJudge = (
  query: string,
  items: { id: string; title: string; description: string }[],
  cfg: ValidationConfig,
) => Promise<Map<string, AxisResult>>;

const JUDGE_SYSTEM_PROMPT = `You are a relevance judge for a biomedical drug-discovery research feed.
Given a user's QUERY and a numbered list of results (title + abstract), decide for EACH result whether it genuinely matches the query's scientific focus.
Return a verdict per result:
- "pass": clearly on-topic — the same target, disease, modality, or method the query is about.
- "flag": tangential or uncertain — same broad area but not the specific focus (e.g. same disease, different target).
- "fail": off-topic — a keyword collision or unrelated work that should not be shown.
Give a short (<= 12 words) reason for each.
Return ONLY a JSON array, one object per result, in the SAME ORDER:
[{"index":0,"verdict":"pass","reason":"..."}, ...]
No prose, no markdown.`;

// Best-effort parse of the model's JSON array (tolerates fences / stray prose).
function parseJudgeArray(content: string): { index: number; verdict: string; reason: string }[] | null {
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  let arr = tryParse(cleaned);
  if (!arr) {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) arr = tryParse(m[0]);
  }
  if (!arr) return null;
  return arr as { index: number; verdict: string; reason: string }[];
}

function coerceVerdict(v: unknown): Verdict {
  return v === "fail" || v === "flag" || v === "pass" ? v : "pass";
}

// The production judge: ONE batched Groq call for the whole candidate set. On any
// failure (no key, non-2xx, timeout, unparseable) it returns an empty map, which
// the caller reads as "all pass" — a flaky judge never blocks the feed.
export const groqRelevanceJudge: RelevanceJudge = async (query, items, cfg) => {
  const result = new Map<string, AxisResult>();
  if (items.length === 0) return result;

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return result; // not configured → treat as all-pass

  const numbered = items
    .map((it, i) => `[${i}] ${it.title}\n${(it.description ?? "").slice(0, 400)}`)
    .join("\n\n");
  const userMessage = `QUERY: ${query}\n\nRESULTS:\n${numbered}\n\nReturn the JSON array of verdicts, one per result, in order.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.llmTimeoutMs);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.llmModel,
        messages: [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0,
        max_tokens: 1024,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("Relevance judge Groq error:", res.status);
      return result; // fail-open
    }
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseJudgeArray(content);
    if (!parsed) {
      console.error("Relevance judge: unparseable response");
      return result; // fail-open
    }
    for (const row of parsed) {
      const item = items[row.index];
      if (!item) continue;
      result.set(item.id, {
        verdict: coerceVerdict(row.verdict),
        reason: typeof row.reason === "string" ? row.reason.slice(0, 120) : "",
      });
    }
    return result;
  } catch (err) {
    // AbortError (timeout) or network failure — fail-open.
    console.error("Relevance judge failed:", err instanceof Error ? err.message : err);
    return result;
  } finally {
    clearTimeout(timer);
  }
};

// ── Combine axes → overall verdict ────────────────────────────────────────────
// Worst axis wins: any fail → fail (drop); else any flag → flag (demote); else pass.

function combine(axes: Partial<Record<ValidationAxis, AxisResult>>): Verdict {
  const verdicts = Object.values(axes).map((a) => a.verdict);
  if (verdicts.includes("fail")) return "fail";
  if (verdicts.includes("flag")) return "flag";
  return "pass";
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
//
// 1. Run the three CHEAP rule axes on every item; drop integrity/recency/dedup
//    failures immediately (no point paying the LLM to judge junk).
// 2. Take the top-N rule-survivors (input is pre-sorted by relevance) and send
//    them to the LLM judge in ONE batched call. Items beyond N default to pass.
// 3. Fold the relevance verdict in, drop overall-fail, and re-rank so flagged
//    items sit BELOW all passing items (preserving prior order within each group).
//
// Whole body is wrapped so ANY throw returns the original items (fail-open).

export async function validateDiscoverItems(
  items: DiscoverItem[],
  query: string,
  overrides?: Partial<ValidationConfig> & { judge?: RelevanceJudge },
): Promise<DiscoverItem[]> {
  try {
    const cfg = resolveConfig(overrides);
    const judge = overrides?.judge ?? groqRelevanceJudge;
    const now = Date.now();

    // ── Step 1: rule axes on everything ──
    const seenTitles = new Set<string>();
    type Staged = { item: DiscoverItem; axes: Partial<Record<ValidationAxis, AxisResult>> };
    const survivors: Staged[] = [];

    for (const item of items) {
      const axes: Partial<Record<ValidationAxis, AxisResult>> = {};
      axes.integrity = checkIntegrity(item);
      axes.recency = checkRecency(item, cfg, now);
      // Only key dedup off items that cleared integrity, so a junk item can't
      // "claim" a title and drop the real one behind it.
      axes.dedup =
        axes.integrity.verdict === "fail"
          ? { verdict: "pass", reason: "Skipped (already failing integrity)" }
          : checkDedup(item, seenTitles);

      if (combine(axes) === "fail") {
        logDrop(item, axes);
        continue;
      }
      survivors.push({ item, axes });
    }

    // ── Step 2: LLM relevance judge on the top-N survivors only ──
    let judgeVerdicts = new Map<string, AxisResult>();
    if (cfg.llmJudgeEnabled && survivors.length > 0) {
      const candidates = survivors.slice(0, cfg.maxLlmJudged).map(({ item }) => ({
        id: item.id,
        title: item.title,
        description: item.description,
      }));
      judgeVerdicts = await judge(query, candidates, cfg);
    }

    // ── Step 3: fold relevance in, drop fails, re-rank ──
    const passed: DiscoverItem[] = [];
    const flagged: DiscoverItem[] = [];
    for (const { item, axes } of survivors) {
      const rel = judgeVerdicts.get(item.id);
      if (rel) axes.relevance = rel;

      const overall = combine(axes);
      if (overall === "fail") {
        logDrop(item, axes);
        continue;
      }
      const withValidation: DiscoverItem = { ...item, validation: { overall, axes } };
      (overall === "flag" ? flagged : passed).push(withValidation);
    }

    // Passing items keep normal (relevance) rank; flagged ones are demoted below
    // them wholesale. Within each group the input's existing sort is preserved.
    return [...passed, ...flagged];
  } catch (err) {
    // FAIL-OPEN: never let a validation bug empty a live feed.
    console.error("validateDiscoverItems failed — returning unvalidated items:", err);
    return items;
  }
}

// Dropped items never reach the UI, so their reasons live only in the debug log —
// the audit trail for "why isn't X in the feed?".
function logDrop(item: DiscoverItem, axes: Partial<Record<ValidationAxis, AxisResult>>) {
  const failed = Object.entries(axes)
    .filter(([, a]) => a.verdict === "fail")
    .map(([axis, a]) => `${axis}: ${a.reason}`)
    .join("; ");
  console.debug(`[validation] dropped "${item.title?.slice(0, 60)}" — ${failed}`);
}
