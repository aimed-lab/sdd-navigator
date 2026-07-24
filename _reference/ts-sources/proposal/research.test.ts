// research.test.ts — pins the tightened paper-relevance filter (Refinement 1).
//
// The proposal's per-phase "relevant research" used to keep any paper matching
// ANY extracted term — including a DISEASE-only term. For a "KRAS G12D covalent
// inhibitor for pancreatic ductal adenocarcinoma" project that let disease-area
// papers through (a CT-imaging paper, a biliary/liver-metastasis paper — both
// PDAC but neither about KRAS G12D or the covalent approach). The fix has TWO
// parts, and this test covers BOTH on the REAL path:
//   1. focusTerms() derives the focus (target + modality) from a disease-CONTAINING
//      therapeutic_target — and must EXCLUDE the disease/indication itself, or the
//      raised threshold is satisfied by a mere disease match (the reported bug).
//   2. precisionFilterPapers() keeps only papers hitting that focus.
//
// The fixtures deliberately put the disease IN the therapeutic_target field (how
// real users fill the form) so the test exercises focusTerms()'s disease
// exclusion — not a pre-cleaned focus set.
//
// Trials/funding logic is deliberately NOT covered here — that path (precisionFilter)
// is unchanged. Runner: node:test + Node native TypeScript (npm test).

import { test } from "node:test";
import assert from "node:assert/strict";
import { precisionFilter, precisionFilterPapers, focusTerms } from "./researchFilters.ts";
import type { DiscoverItem } from "@/types/discover";
import type { ProposalInput } from "@/types/proposal";

// ── The KRAS G12D covalent-inhibitor project (disease IN the target field) ────

const KRAS_INPUT: ProposalInput = {
  title_and_team: "Covalent KRAS G12D inhibitors for pancreatic cancer",
  // Realistic: the researcher names the indication in the target field.
  therapeutic_target: "Covalent inhibitor (small molecule) targeting KRAS G12D for pancreatic ductal adenocarcinoma",
  scientific_rationale:
    "KRAS G12D is the dominant driver mutation in pancreatic ductal adenocarcinoma; a covalent small molecule could achieve durable target engagement.",
  sparc_support_needed: "",
  validation_plan: "",
  expected_impact: "",
  project_readiness: "",
  support_chips: [],
};

// What /api/extract-interests returns for this project: the specific focus
// (target/modality) MIXED WITH the disease/indication — and the disease is in
// the target field, so focusTerms() must actively exclude it.
const TERMS = ["KRAS G12D", "pancreatic ductal adenocarcinoma", "covalent inhibitor", "small molecule"];

function paper(id: string, title: string, description: string): DiscoverItem {
  return {
    id,
    type: "paper",
    title,
    description,
    source: "Test Journal",
    date: "Jan 1, 2025",
    dateISO: "2025-01-01",
    url: `https://example.org/${id}`,
    tags: [],
    relevance: 3,
  };
}

// The two REAL off-focus papers the researcher flagged — pancreatic ductal
// adenocarcinoma (the disease) but NOT about KRAS G12D / the covalent approach.
const CT_IMAGING = paper(
  "ct-imaging",
  "Differentiation of pancreatic neuroendocrine carcinoma from pancreatic ductal adenocarcinoma using contrast-enhanced computed tomography",
  "Contrast-enhanced CT differentiates pancreatic neuroendocrine carcinoma from pancreatic ductal adenocarcinoma.",
);
const LIVER_MET = paper(
  "liver-met",
  "Biliary multi-omic signatures associated with early liver metastasis in resectable pancreatic ductal adenocarcinoma",
  "Multi-omic analysis of biliary samples identifies early liver metastasis signatures in resectable pancreatic ductal adenocarcinoma.",
);

// On-focus papers — actually about the target + approach + modality.
const COVALENT_HIT = paper(
  "covalent-hit",
  "Discovery of covalent inhibitor scaffolds targeting KRAS G12D",
  "A small molecule covalent inhibitor engaging the mutant residue of KRAS G12D in pancreatic ductal adenocarcinoma.",
);
const SM_DESIGN = paper(
  "sm-design",
  "Structure-based drug design of small molecule KRAS G12D binders",
  "Fragment growing yields selective small molecule binders of KRAS G12D.",
);

const POOL = [CT_IMAGING, LIVER_MET, COVALENT_HIT, SM_DESIGN];
const ids = (items: DiscoverItem[]) => items.map((i) => i.id);

// ── focusTerms EXCLUDES the disease even though it's in the target field ──────

test("focusTerms returns target+modality only, excluding the disease in the target field", () => {
  const focus = focusTerms(TERMS, KRAS_INPUT);
  // Focus is the TARGET + MODALITY — the disease is stripped.
  assert.deepEqual(focus, ["KRAS G12D", "covalent inhibitor", "small molecule"]);
  // The indication must NOT be treated as focus (this was the reported bug).
  assert.ok(!focus.includes("pancreatic ductal adenocarcinoma"));
});

// ── BEFORE: the old broad filter lets the off-focus papers through ────────────

test("BEFORE — broad precisionFilter keeps the off-focus CT-imaging & liver-met papers", () => {
  const before = precisionFilter(POOL, TERMS);
  // All four survive (each matches at least the disease term), so the two
  // off-focus papers WOULD reach the proposal.
  assert.ok(ids(before).includes("ct-imaging"), "old filter kept the CT-imaging paper");
  assert.ok(ids(before).includes("liver-met"), "old filter kept the liver-metastasis paper");
  assert.equal(before.length, 4);
});

// ── AFTER: the focus filter drops the disease-only papers, keeps on-focus ─────

test("AFTER — precisionFilterPapers drops off-focus papers, keeps on-focus, focus-ranked", () => {
  const focus = focusTerms(TERMS, KRAS_INPUT);
  const after = precisionFilterPapers(POOL, TERMS, focus);

  // The two disease-only papers are gone.
  assert.ok(!ids(after).includes("ct-imaging"), "CT-imaging paper dropped");
  assert.ok(!ids(after).includes("liver-met"), "liver-metastasis paper dropped");

  // Only the on-focus papers remain…
  assert.deepEqual(ids(after), ["covalent-hit", "sm-design"]);
  // …and the paper hitting the most focus terms ranks first.
  assert.equal(after[0].id, "covalent-hit");
});

// ── The raised threshold: disease-only pool → DROP, never reintroduce ─────────
// The exact real-world failure: for this KRAS query the live feed returned ONLY
// disease-area papers (CT-imaging + liver-met). They must be dropped, not
// reintroduced via a broad fallback — the phase then shows its well-targeted
// trial/funding and no loose papers.

test("AFTER — disease-only pool yields NO papers (does not fall back to broad)", () => {
  const focus = focusTerms(TERMS, KRAS_INPUT);
  const offTargetOnly = [CT_IMAGING, LIVER_MET];
  const after = precisionFilterPapers(offTargetOnly, TERMS, focus);
  assert.deepEqual(after, []);
});

// Only when we can't identify ANY focus term do we defer to the broad filter
// (we have no basis to tighten).
test("AFTER — no identifiable focus term → defers to the broad filter", () => {
  const after = precisionFilterPapers([CT_IMAGING, LIVER_MET], TERMS, []);
  assert.equal(after.length, 2);
});
