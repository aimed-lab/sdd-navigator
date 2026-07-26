// lib/showcaseTypes.ts — Promote showcase types + constants, shared by server
// and client.
//
// Dependency-free by design, same reason as lib/collabTypes.ts: client
// components need the VALUE constants (SHOWCASE_TYPES for the filter chips and
// the submit form's select), and importing those from lib/server/showcase.ts
// would drag its transitive `next/headers` dependency into the client bundle.
// Type-only imports get erased; value imports do not.
//
// Rule: anything a "use client" component imports as a VALUE belongs here.

export const SHOWCASE_TYPES = [
  "case_study",
  "paper",
  "white_paper",
  "achievement",
] as const;
export type ShowcaseType = (typeof SHOWCASE_TYPES)[number];

/** Human labels for the type chips / select. */
export const SHOWCASE_TYPE_LABEL: Record<ShowcaseType, string> = {
  case_study: "Case study",
  paper: "Paper",
  white_paper: "White paper",
  achievement: "Achievement",
};

export type ShowcaseOwner = {
  id: string;
  name: string | null;
  affiliation: string | null;
};

export type ShowcaseEntry = {
  id: string;
  type: ShowcaseType;
  title: string;
  description: string;
  authors: string;
  link: string | null;
  image_url: string | null;
  tags: string[];
  created_at: string;
  owner: ShowcaseOwner | null;
};

export type CreateShowcaseInput = {
  type: ShowcaseType;
  title: string;
  description?: string;
  authors?: string;
  link?: string | null;
  tags?: string[];
};

// ── generator (public, no auth) ───────────────────────────────────────────────

export type PromoTone = "plain-impact" | "peer-technical" | "narrative" | "milestone";

export type PromoVariantView = {
  tone: PromoTone;
  hook: string;
  body: string;
  hashtags: string[];
  closingTag: string;
};

export type GeneratorResult = {
  paper: {
    title: string;
    authors: string[];
    sourceUrl: string;
    doi: string | null;
    pmid: string | null;
    publishedDate: string | null;
  };
  variants: PromoVariantView[];
  fundingPitch: string;
  laySummary: string;
};

export const TONE_LABEL: Record<PromoTone, string> = {
  "plain-impact": "Plain impact",
  "peer-technical": "Peer / technical",
  narrative: "Narrative",
  milestone: "Milestone",
};
