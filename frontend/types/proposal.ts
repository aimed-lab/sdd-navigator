// ── Types for the unified Navigator proposal engine (/api/generate-proposal) ──
//
// This is the NEW single proposal flow that replaces the 3-space model
// (target/discovery/validation). One input shape (the 7 RFA sections) → one
// phased-document output. The old per-space types in ./navigator.ts stay in
// place while the 3 space pages remain live in parallel.

// ── Input: the 7 RFA proposal sections (+ optional support chips) ─────────────

export type ProposalInput = {
  title_and_team: string;        // 1. project title (and team, if given)
  therapeutic_target: string;    // 2. the target / opportunity / what you have
  scientific_rationale: string;  // 3. why this, mechanism, evidence
  sparc_support_needed: string;  // 4. what you need SPARC / providers for
  validation_plan: string;       // 5. how you'll validate
  expected_impact: string;       // 6. clinical / scientific significance
  project_readiness: string;     // 7. current stage, resources, data readiness
  support_chips?: string[];      // optional multi-select "type of support" chips
};

// ── Output: one phased-document proposal ──────────────────────────────────────

// A Verified provider card for one phase. Providers ONLY ever come from the real
// `providers` DB table (never invented by the LLM), so `verified` is always true.
// `capabilities` / `tools` are the grounded subset relevant to THIS phase,
// re-validated verbatim against the DB row. `cost_symbol` is derived from the
// row's real `estimated_cost` ($–$$$$) or null when the row has no cost.
export type ProposalProvider = {
  name: string;
  verified: true;
  speciality: string | null;         // the DB row's service area (= its description)
  capabilities: string[];            // grounded subset relevant to this phase
  tools: string[];                   // grounded subset relevant to this phase
  how: string;                       // 1-2 sentences: how it helps at THIS phase
  estimated_cost: string | null;     // raw DB value, e.g. "$1,500"
  cost_symbol: string | null;        // derived $–$$$$, or null when no cost
  estimated_timeline: string | null; // raw DB value, e.g. "2–4 weeks"
  is_free: boolean;
  contact: string | null;            // website URL or email
};

// A relevant-research item for one phase. Real records pulled from the live
// /api/discover engine — never invented. `type` distinguishes the source kind:
//   • "paper" — PubMed / OpenAlex / Crossref (target-queryable)
//   • "trial" — ClinicalTrials.gov (target-queryable)
//   • "grant" — Grants.gov FUNDING OPPORTUNITY (broad call, NOT target-specific;
//               labelled honestly in the UI as "Funding Opportunity")
export type ProposalResearchType = "paper" | "trial" | "grant";

export type ProposalResearchItem = {
  type: ProposalResearchType;
  id: string;
  title: string;
  source: string;   // journal / registry / agency, e.g. "Nature Biotech"
  date: string;     // human-readable, e.g. "Oct 24, 2024"
  url: string;
};

export type ProposalPhase = {
  id: string;                    // slug, e.g. "phase-1"
  title: string;                 // e.g. "Target Validation & Feasibility"
  goal: string;
  // 1-2 concrete deliverables the researcher WALKS AWAY WITH after this phase,
  // derived from the phase goal (e.g. "a ranked list of validated hits"). Never
  // names providers/tools/papers and never overstates — follows logically from
  // the goal. Optional for backward-compat with proposals saved before outcomes.
  outcomes?: string[];
  estimated_duration: string;    // e.g. "6–9 weeks"
  providers: ProposalProvider[]; // Verified-only; may be empty (honest empty state)
  // Mixed papers + trials + funding opportunities. Field name kept as `papers`
  // for backward-compat with already-saved proposals (older items had no `type`,
  // and the UI treats a missing type as "paper").
  papers: ProposalResearchItem[];
  // NOTE: researcher matching is deliberately NOT produced here — the frontend
  // shows a "coming soon" Talent Knowledge Graph placeholder.
};

// Echoes the key inputs back (drives the "Your project" recap block + the PDF).
export type ProposalRecap = {
  title: string;
  therapeutic_target: string;
  scientific_rationale: string;
  sparc_support_needed: string;
  validation_plan: string;
  expected_impact: string;
  project_readiness: string;
  support_chips: string[];
};

export type ProposalDocument = {
  title: string;              // document title (LLM-polished, falls back to input)
  summary: string;            // one-line AI summary
  recap: ProposalRecap;       // echoes the inputs
  phases: ProposalPhase[];    // aim ~3; not locked to exactly 3
};
