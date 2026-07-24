// validation.test.ts — pins the named-axis quality layer (Starling methodology).
//
// The layer that sits inside runDiscover between "fetched" and "shown", shared by
// the Discovery feed and Navigator's per-phase research. It scores each result on
// NAMED AXES (relevance / recency / integrity / dedup), each with a verdict +
// reason — never one opaque number. This test pins every axis on the REAL path
// AND demonstrates the KRAS before/after: off-topic PDAC papers that the old
// keyword filter let through now get caught by the (injected) relevance judge.
//
// The LLM relevance judge is INJECTED here (overrides.judge) so the test is
// deterministic and network-free — exactly the seam production uses to swap Groq.
//
// Runner: node:test + Node native TypeScript (npm test).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateDiscoverItems,
  type RelevanceJudge,
  type AxisResult,
} from "./validation.ts";
import type { DiscoverItem } from "@/types/discover";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TODAY = Date.now();
const iso = (msFromNow: number) => new Date(TODAY + msFromNow).toISOString().slice(0, 10);

function paper(over: Partial<DiscoverItem> & { id: string }): DiscoverItem {
  return {
    type: "paper",
    title: `Paper ${over.id}`,
    description: "",
    source: "Test Journal",
    date: "Jan 1, 2025",
    dateISO: iso(-30 * 86_400_000), // ~1 month old by default
    url: `https://example.org/${over.id}`,
    tags: [],
    relevance: 3,
    ...over,
  };
}

const ids = (items: DiscoverItem[]) => items.map((i) => i.id);

// A judge that never runs (proves the rule axes work with the LLM disabled).
const noJudge: Partial<Parameters<typeof validateDiscoverItems>[2]> = { llmJudgeEnabled: false };

// ── The KRAS project results (the reported real-world case) ───────────────────
// A "covalent KRAS G12D inhibitor for pancreatic ductal adenocarcinoma" query.
// Two off-focus PDAC papers (disease match only) + two on-focus papers.

const CT_IMAGING = paper({
  id: "ct-imaging",
  title: "Differentiation of pancreatic neuroendocrine carcinoma from pancreatic ductal adenocarcinoma using contrast-enhanced CT",
  description: "Contrast-enhanced CT differentiates pancreatic neuroendocrine carcinoma from pancreatic ductal adenocarcinoma.",
});
const LIVER_MET = paper({
  id: "liver-met",
  title: "Biliary multi-omic signatures associated with early liver metastasis in resectable pancreatic ductal adenocarcinoma",
  description: "Multi-omic analysis of biliary samples identifies early liver metastasis signatures in PDAC.",
});
const COVALENT_HIT = paper({
  id: "covalent-hit",
  title: "Discovery of covalent inhibitor scaffolds targeting KRAS G12D",
  description: "A small molecule covalent inhibitor engaging the mutant residue of KRAS G12D.",
  relevance: 5,
});
const SM_DESIGN = paper({
  id: "sm-design",
  title: "Structure-based drug design of small molecule KRAS G12D binders",
  description: "Fragment growing yields selective small molecule binders of KRAS G12D.",
  relevance: 4,
});

// The injected judge encoding the SAME verdicts a real relevance model gives for
// this query: the two disease-only papers are off-topic (fail), the two on-focus
// papers pass. Named axis + reason on each — the Starling shape.
const KRAS_JUDGE: RelevanceJudge = async (_query, items) => {
  const verdicts: Record<string, AxisResult> = {
    "ct-imaging": { verdict: "fail", reason: "Imaging of PDAC — not about KRAS G12D or covalent inhibition" },
    "liver-met": { verdict: "fail", reason: "PDAC metastasis biomarkers — off the molecular focus" },
    "covalent-hit": { verdict: "pass", reason: "Directly about covalent KRAS G12D inhibitors" },
    "sm-design": { verdict: "pass", reason: "Small-molecule KRAS G12D design" },
  };
  const out = new Map<string, AxisResult>();
  for (const it of items) if (verdicts[it.id]) out.set(it.id, verdicts[it.id]);
  return out;
};

const KRAS_POOL = [COVALENT_HIT, SM_DESIGN, CT_IMAGING, LIVER_MET];
const KRAS_QUERY = "covalent KRAS G12D inhibitor pancreatic ductal adenocarcinoma";

// ── BEFORE: judge off → the off-focus PDAC papers all survive ─────────────────

test("BEFORE — with the relevance judge disabled, off-focus PDAC papers still show", async () => {
  const before = await validateDiscoverItems(KRAS_POOL, KRAS_QUERY, noJudge);
  assert.ok(ids(before).includes("ct-imaging"), "CT-imaging paper shown");
  assert.ok(ids(before).includes("liver-met"), "liver-metastasis paper shown");
  assert.equal(before.length, 4);
});

// ── AFTER: judge on → the relevance axis DROPS the off-focus papers ───────────

test("AFTER — the relevance judge catches the off-topic KRAS papers", async () => {
  const after = await validateDiscoverItems(KRAS_POOL, KRAS_QUERY, { judge: KRAS_JUDGE });

  assert.ok(!ids(after).includes("ct-imaging"), "CT-imaging paper dropped by relevance judge");
  assert.ok(!ids(after).includes("liver-met"), "liver-metastasis paper dropped by relevance judge");
  assert.deepEqual(ids(after), ["covalent-hit", "sm-design"]);

  // Starling lesson: the verdict + reason is kept WITH the surviving item.
  assert.equal(after[0].validation?.overall, "pass");
  assert.equal(after[0].validation?.axes.relevance?.verdict, "pass");
  assert.match(after[0].validation!.axes.relevance!.reason, /covalent KRAS G12D/i);
});

// ── flag → shown but demoted below all passing items ──────────────────────────

test("flagged items are shown but ranked BELOW passing items", async () => {
  const flagJudge: RelevanceJudge = async (_q, items) => {
    const out = new Map<string, AxisResult>();
    for (const it of items) {
      out.set(
        it.id,
        it.id === "covalent-hit"
          ? { verdict: "flag", reason: "Tangential" }
          : { verdict: "pass", reason: "On-topic" },
      );
    }
    return out;
  };
  // covalent-hit has the HIGHEST relevance (5) so it sorts first — but a flag must
  // push it below the passing sm-design despite that.
  const out = await validateDiscoverItems([COVALENT_HIT, SM_DESIGN], KRAS_QUERY, { judge: flagJudge });
  assert.deepEqual(ids(out), ["sm-design", "covalent-hit"]);
  assert.equal(out.find((i) => i.id === "covalent-hit")!.validation?.overall, "flag");
});

// ── Rule axis: integrity → drop malformed/empty ───────────────────────────────

test("integrity axis drops results with no title or no/invalid URL", async () => {
  const pool = [
    paper({ id: "good" }),
    paper({ id: "no-title", title: "  " }),
    paper({ id: "no-url", url: "" }),
    paper({ id: "bad-url", url: "javascript:alert(1)" }),
  ];
  const out = await validateDiscoverItems(pool, "anything", noJudge);
  assert.deepEqual(ids(out), ["good"]);
});

// ── Rule axis: recency → DROP impossible future, FLAG stale ───────────────────

test("recency axis drops impossible future-dated papers", async () => {
  const pool = [
    paper({ id: "now" }),
    paper({ id: "future", dateISO: iso(120 * 86_400_000) }), // ~4 months ahead
  ];
  const out = await validateDiscoverItems(pool, "anything", noJudge);
  assert.deepEqual(ids(out), ["now"]);
});

test("recency axis FLAGS (does not drop) stale items and demotes them", async () => {
  const stale = paper({ id: "stale", dateISO: iso(-6 * 365 * 86_400_000) }); // ~6y old
  const fresh = paper({ id: "fresh" });
  const out = await validateDiscoverItems([stale, fresh], "anything", noJudge);
  // Stale still shows…
  assert.equal(out.length, 2);
  // …but is flagged and demoted below the fresh (passing) item.
  assert.deepEqual(ids(out), ["fresh", "stale"]);
  assert.equal(out.find((i) => i.id === "stale")!.validation?.axes.recency?.verdict, "flag");
});

test("recency axis keeps future-dated GRANTS (forecasted opportunities are legit)", async () => {
  const grant: DiscoverItem = { ...paper({ id: "g" }), type: "grant", dateISO: iso(200 * 86_400_000) };
  const out = await validateDiscoverItems([grant], "anything", noJudge);
  assert.deepEqual(ids(out), ["g"]);
});

// ── Rule axis: dedup → near-duplicate titles across sources ───────────────────

test("dedup axis drops a near-duplicate title from a second source", async () => {
  const a = paper({ id: "a", title: "Covalent Inhibitors of KRAS G12D", url: "https://one.org/a" });
  const b = paper({ id: "b", title: "covalent inhibitors of kras g12d!", url: "https://two.org/b" });
  const out = await validateDiscoverItems([a, b], "kras", noJudge);
  assert.deepEqual(ids(out), ["a"]); // first wins, near-dup dropped
});

// ── Fail-open: a throwing judge must NEVER empty the feed ──────────────────────

test("fail-open — a judge that throws returns items as if all passed (never empties feed)", async () => {
  const throwingJudge: RelevanceJudge = async () => {
    throw new Error("simulated LLM outage");
  };
  const out = await validateDiscoverItems(KRAS_POOL, KRAS_QUERY, { judge: throwingJudge });
  // The whole feed survives (relevance treated as pass), rules still applied.
  assert.equal(out.length, 4);
});

// ── Judge omission is per-item fail-open ──────────────────────────────────────

test("an item the judge omits is treated as pass (per-item fail-open)", async () => {
  const partialJudge: RelevanceJudge = async (_q, items) => {
    const out = new Map<string, AxisResult>();
    // Only judge covalent-hit; omit the rest.
    const hit = items.find((i) => i.id === "covalent-hit");
    if (hit) out.set(hit.id, { verdict: "pass", reason: "ok" });
    return out;
  };
  const out = await validateDiscoverItems([COVALENT_HIT, SM_DESIGN], KRAS_QUERY, { judge: partialJudge });
  assert.equal(out.length, 2); // sm-design not dropped just because it wasn't judged
});

// ── The LLM judge is capped so a big feed makes ONE bounded call ──────────────

test("maxLlmJudged caps how many items reach the judge; the rest default to pass", async () => {
  let seenByJudge = 0;
  const countingJudge: RelevanceJudge = async (_q, items) => {
    seenByJudge = items.length;
    return new Map(); // all-pass
  };
  const pool = Array.from({ length: 30 }, (_, i) => paper({ id: `p${i}` }));
  const out = await validateDiscoverItems(pool, "q", { judge: countingJudge, maxLlmJudged: 10 });
  assert.equal(seenByJudge, 10, "judge sees at most maxLlmJudged candidates");
  assert.equal(out.length, 30, "un-judged items still show (default pass)");
});
