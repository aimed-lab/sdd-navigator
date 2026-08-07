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

/** The "Explore for this project" query text. The backend's explore()
 *  already runs LLM scope extraction over free text, so the project's own
 *  NAME and DESCRIPTION — the richest signal available, full sentences
 *  the extractor can actually parse — are the input, not thrown away in
 *  favor of a bare keyword string. target/indication/modality (as its
 *  human label, not the raw enum value) are still valuable, so they're
 *  APPENDED as context rather than replacing the free text, in case the
 *  description doesn't happen to mention one of them by name. Falls back
 *  to the name alone when description is empty, which never leaves the
 *  query blank — a project can't exist without a name. */
export function buildProjectExploreQuery(project: {
  name: string;
  description: string | null;
  target: string | null;
  indication: string | null;
  modality: string | null;
}): string {
  const modalityLabel = project.modality
    ? MODALITY_LABEL[project.modality as Modality] ?? project.modality
    : null;
  const contextParts = [project.target, project.indication, modalityLabel]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);

  const base = [project.name.trim(), project.description?.trim()]
    .filter((s): s is string => !!s)
    .join(". ");

  return contextParts.length ? `${base} (${contextParts.join(", ")})` : base;
}

/** The full href for "Explore for this project" — the built query as the
 *  route param, plus project_id/project_name as query string so Explore
 *  knows saves from this visit belong to this project (see
 *  app/explore/[topic]/page.tsx). */
export function buildProjectExploreHref(project: {
  id: string;
  name: string;
  description: string | null;
  target: string | null;
  indication: string | null;
  modality: string | null;
}): string {
  const query = buildProjectExploreQuery(project);
  const params = new URLSearchParams({ project_id: project.id, project_name: project.name });
  return `/explore/${encodeURIComponent(query)}?${params.toString()}`;
}
