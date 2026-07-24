// grounding.test.ts — the pin for the "LLM can't invent providers" guarantee.
//
// This is the crown-jewel regression guard. It exercises the two functions that
// enforce grounding — sanitizeSparcSelection (verbatim re-validation against the
// real DB arrays) and buildPhaseProviders (cards built ONLY from real DB rows) —
// and asserts that anything the model invents is dropped and never appears as a
// provider. It must keep passing across every future refactor, including a port
// of this logic to Python.
//
// Runner: Node's built-in test runner (node:test) + Node 24 native TypeScript —
// no test-framework dependency. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeSparcSelection, buildPhaseProviders } from "./grounding.ts";
import type { InternalProvider } from "@/types/navigator";

// ── Fixtures: a known, REAL SPARC grounding ───────────────────────────────────

const REAL_CAP_A = "Pathway & gene-set enrichment analysis";
const REAL_CAP_B = "Protein-interaction network analysis";
const REAL_TOOL_A = "Cytoscape";
const REAL_TOOL_B = "GSEA";

// The invented items a hallucinating model might try to inject — NONE of these
// exist in the SPARC grounding below.
const INVENTED_CAP = "Quantum molecular docking simulator";
const INVENTED_TOOL = "MadeUpToolX";

// The real SPARC provider row(s) — the ONLY source of truth for provider cards.
const SPARC_PROVIDERS: InternalProvider[] = [
  {
    name: "UAB SPARC — Systems Pharmacology",
    speciality: "Systems pharmacology & network analysis",
    capabilities: [REAL_CAP_A, REAL_CAP_B],
    tools: [REAL_TOOL_A, REAL_TOOL_B],
    estimated_cost: "$1,500",
    estimated_timeline: "2-4 weeks",
    is_free: false,
    contact: "https://sparc.uab.edu",
  },
];

// The grounding vocabulary the model is allowed to draw from (as collectGrounding
// would produce it — the union across all SPARC rows).
const ALLOWED_CAPS = [REAL_CAP_A, REAL_CAP_B];
const ALLOWED_TOOLS = [REAL_TOOL_A, REAL_TOOL_B];

// ── 1. sanitizeSparcSelection drops the invented capability/tool ──────────────

test("sanitizeSparcSelection drops invented capabilities/tools, keeps real ones", () => {
  // A model response that names ONE real capability AND ONE invented capability
  // (plus one real + one invented tool).
  const modelSparc = {
    relevant: true,
    capabilities: [REAL_CAP_A, INVENTED_CAP],
    tools: [REAL_TOOL_B, INVENTED_TOOL],
    how: "Situates the target in its pathway/gene-set context.",
  };

  const contribution = sanitizeSparcSelection(modelSparc, ALLOWED_CAPS, ALLOWED_TOOLS);

  // Only the real, grounded strings survive — verbatim.
  assert.deepEqual(contribution.capabilities, [REAL_CAP_A]);
  assert.deepEqual(contribution.tools, [REAL_TOOL_B]);
  assert.equal(contribution.relevant, true);

  // The invented strings are gone entirely.
  assert.ok(!contribution.capabilities.includes(INVENTED_CAP));
  assert.ok(!contribution.tools.includes(INVENTED_TOOL));
});

// ── 2. buildPhaseProviders builds cards ONLY from real DB rows ─────────────────

test("buildPhaseProviders builds only DB-row-backed cards — no card for invented items", () => {
  const contribution = sanitizeSparcSelection(
    {
      relevant: true,
      capabilities: [REAL_CAP_A, INVENTED_CAP],
      tools: [REAL_TOOL_B, INVENTED_TOOL],
      how: "Situates the target in its pathway/gene-set context.",
    },
    ALLOWED_CAPS,
    ALLOWED_TOOLS,
  );

  const cards = buildPhaseProviders(contribution, SPARC_PROVIDERS, new Map());

  // Exactly one card, backed by the real SPARC row.
  assert.equal(cards.length, 1);
  assert.equal(cards[0].name, "UAB SPARC — Systems Pharmacology");
  assert.equal(cards[0].verified, true);

  // Its capabilities/tools are the surviving REAL selection only.
  assert.deepEqual(cards[0].capabilities, [REAL_CAP_A]);
  assert.deepEqual(cards[0].tools, [REAL_TOOL_B]);

  // Nothing the model invented appears on any card, anywhere.
  const allCaps = cards.flatMap((c) => c.capabilities);
  const allTools = cards.flatMap((c) => c.tools);
  assert.ok(!allCaps.includes(INVENTED_CAP));
  assert.ok(!allTools.includes(INVENTED_TOOL));

  // The card is built from real DB fields, not model free text.
  assert.equal(cards[0].estimated_cost, "$1,500");
  assert.equal(cards[0].contact, "https://sparc.uab.edu");
});

// ── 3. No matching SPARC capability → empty providers (never fabricated) ───────

test("model selecting ONLY invented capabilities yields NO providers (not fabricated)", () => {
  const contribution = sanitizeSparcSelection(
    {
      relevant: true,
      capabilities: [INVENTED_CAP],
      tools: [INVENTED_TOOL],
      how: "This should never produce a provider.",
    },
    ALLOWED_CAPS,
    ALLOWED_TOOLS,
  );

  // Nothing grounded survived → not relevant → empty.
  assert.equal(contribution.relevant, false);
  assert.deepEqual(contribution.capabilities, []);
  assert.deepEqual(contribution.tools, []);

  const cards = buildPhaseProviders(contribution, SPARC_PROVIDERS, new Map());
  assert.deepEqual(cards, []);
});

test("SPARC honestly not-relevant for a phase yields an empty providers list", () => {
  const contribution = sanitizeSparcSelection(
    { relevant: false, capabilities: [], tools: [], how: "" },
    ALLOWED_CAPS,
    ALLOWED_TOOLS,
  );

  assert.equal(contribution.relevant, false);
  assert.deepEqual(buildPhaseProviders(contribution, SPARC_PROVIDERS, new Map()), []);
});
