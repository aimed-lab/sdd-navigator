// lib/collabTypes.ts — Collaborate types + constants, shared by server and client.
//
// This file must stay dependency-free. It exists because client components need
// the VALUE constants (STAGES for a <select>, INTEREST_TYPES for the modal), and
// importing those from lib/server/collab.ts drags its transitive dependency on
// `next/headers` into the client bundle, which fails the build. Type-only
// imports get erased; value imports do not.
//
// Rule: anything a "use client" component imports as a value belongs HERE, not
// in lib/server/collab.ts.

export const STAGES = [
  "concept",
  "early_data",
  "validation",
  "preclinical",
  "seeking_team",
] as const;
export type Stage = (typeof STAGES)[number];

export const INTEREST_TYPES = [
  "can_provide",
  "want_to_join",
  "want_to_use",
  "general",
] as const;
export type InterestType = (typeof INTEREST_TYPES)[number];

/** Short labels for the four interest types, phrased from the POST OWNER's side
 *  — this is what the inbox shows, so "I can provide…" becomes "Can provide".
 *  The modal keeps its own first-person wording. */
export const INTEREST_LABELS: Record<InterestType, string> = {
  can_provide: "Can provide something you need",
  want_to_join: "Wants to join the project",
  want_to_use: "Wants to use what you offer",
  general: "General interest",
};

/** How long a self-provided contact string may be. Generous enough for an email,
 *  a handle, or a short sentence ("email me via the lab office"), short enough
 *  that the field can't be used as free storage. */
export const CONTACT_MAX = 200;

export type BoardFilter = "all" | "offering" | "seeking_team" | "seeking_resources";

export type CollabOwner = {
  id: string;
  name: string | null;
  affiliation: string | null;
  institution: string | null;
  profile_slug: string | null;
};

export type CollabPost = {
  id: string;
  title: string;
  description: string;
  research_areas: string[];
  haves: string[];
  needs: string[];
  stage: Stage;
  created_at: string;
  owner: CollabOwner | null;
  interested: number;
};

export type CreateCollabPostInput = {
  title: string;
  description?: string;
  research_areas?: string[];
  haves?: string[];
  needs?: string[];
  stage?: Stage;
};
