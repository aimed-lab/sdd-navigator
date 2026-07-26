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
