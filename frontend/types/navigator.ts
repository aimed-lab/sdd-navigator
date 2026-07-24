// ── Shared Navigator types (still used by the unified proposal flow) ──────────
//
// The old per-space output shapes (Target/Discovery/Validation roadmaps) were
// removed with the 3-space cleanup. Only the types still referenced by surviving
// code remain:
//   • InternalProvider / SparcStepContribution → app/api/generate-proposal
//   • ResearcherMini                            → lib/navigatorResearchers (dormant, TKG)

// Internal UAB provider (e.g. SPARC) read from the `providers` table.
// NOTE: the live table has no description/website columns — `speciality`
// holds the description and `contact` holds the URL.
export type InternalProvider = {
  name: string;
  speciality: string | null;
  capabilities: string[] | null;
  tools: string[] | null;
  estimated_cost: string | null;
  estimated_timeline: string | null;
  is_free: boolean | null;
  contact: string | null;
};

// How UAB SPARC's real capabilities/tools map onto ONE roadmap/phase. The LLM
// selects a subset (it may not invent any); the server re-validates that subset
// against the DB arrays before it reaches the client. `relevant: false` → SPARC
// doesn't fit, show nothing.
export type SparcStepContribution = {
  relevant: boolean;
  capabilities: string[];
  tools: string[];
  how: string;
};

export type ResearcherMini = {
  id: string;
  name: string;
  research_focus: string | null;
  interests: string[] | null;
  profile_slug: string | null;
};
