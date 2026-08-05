// lib/projectTypes.ts — Projects types + constants, shared by server and client.
//
// Dependency-free, same reason as lib/collabTypes.ts: a "use client" form needs
// the VALUE constants (MODALITIES/STAGES for two <select>s), and importing them
// from lib/server/projects.ts would drag its `next/headers` dependency into the
// client bundle. Rule: anything a client component imports as a VALUE belongs
// here, not in lib/server/projects.ts.

// Exact option values from the Stitch create-project forms
// (frontend/design/projects/STRUCTURE.md, screens 2 and 3) — kept identical to
// the projects.modality CHECK constraint in
// database/migrations/2026-08-05_projects_program_details.sql so the form and
// the database always agree on the same strings.
export const MODALITIES = [
  "small_molecule",
  "biologic",
  "protac",
  "aso_rna",
  "cell_therapy",
  "other",
] as const;
export type Modality = (typeof MODALITIES)[number];

export const MODALITY_LABEL: Record<Modality, string> = {
  small_molecule: "Small molecule",
  biologic: "Biologic",
  protac: "PROTAC",
  aso_rna: "ASO / RNA",
  cell_therapy: "Cell therapy",
  other: "Other",
};

export const PROJECT_STAGES = [
  "target_id",
  "hit_finding",
  "lead_opt",
  "preclinical",
  "ind_enabling",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STAGE_LABEL: Record<ProjectStage, string> = {
  target_id: "Target identification",
  hit_finding: "Hit finding",
  lead_opt: "Lead optimization",
  preclinical: "Preclinical",
  ind_enabling: "IND-enabling",
};

// The one real challenge value the app currently writes. Plain string on the
// `projects.challenge_key` column (see 2026-08-04_projects.sql) — not an enum —
// so next year's challenge is a value, not a migration. This constant is just
// the one this UI currently knows how to create.
export const COLABOFEST_CHALLENGE_KEY = "colabofest_2026";

/** One project as listed on /projects. Never carries lead_id or any member's
 *  user_id — `is_lead` is the server-computed boolean the client is allowed to
 *  see; see lib/server/projects.ts:listMyProjects. */
export type MyProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  is_lead: boolean;
  deadline: string | null;
  challenge_key: string | null;
  proposal_submitted: boolean;
};

export type CreateProjectInput = {
  name: string;
  description: string;
  deadline?: string | null;
  challenge_key?: string | null;
  target?: string | null;
  indication?: string | null;
  modality?: Modality | null;
  stage?: ProjectStage | null;
};
