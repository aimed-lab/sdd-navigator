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

// Optional, nullable — see database/migrations/2026-07-28_collab_posts_funding_status.sql.
// NULL means "the poster didn't say", not a fourth state; every reader (the
// form, the card) must treat it as "render nothing", never "Unknown".
export const FUNDING_STATUSES = ["funded", "applying", "unfunded"] as const;
export type FundingStatus = (typeof FUNDING_STATUSES)[number];

export const FUNDING_STATUS_LABEL: Record<FundingStatus, string> = {
  funded: "Funded",
  applying: "Grant applying",
  unfunded: "Unfunded",
};

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
  /** Optional, nullable — null means unspecified. Render nothing when null,
   *  never a placeholder like "Unknown". */
  funding_status: FundingStatus | null;
  created_at: string;
  owner: CollabOwner | null;
  interested: number;
  /** Computed server-side (session user vs. the row's owner_id) — owner_id
   *  itself is never sent to the browser, just this yes/no. The client uses
   *  it only to decide whether to SHOW the delete affordance; the actual
   *  gate is the collab_posts_delete_own RLS policy, enforced again in
   *  Postgres regardless of what this flag says. */
  is_owner: boolean;
  /** Optional community tag (database/migrations/2026-08-20_communities.sql).
   *  Null for an ordinary, uncommunitied post. */
  community_id: string | null;
};

export type CreateCollabPostInput = {
  title: string;
  description?: string;
  research_areas?: string[];
  haves?: string[];
  needs?: string[];
  stage?: Stage;
  funding_status?: FundingStatus | null;
  // The one-click bridge from a project's Checklist section (see
  // database/migrations/2026-08-04_projects.sql: collab_posts.checklist_item_id,
  // ON DELETE SET NULL). Optional — a normal board post has none.
  checklist_item_id?: string | null;
  // Optional community tag — see communities.ts / 2026-08-20_communities.sql.
  // RLS (can_post_to_community) is the real gate on whether this id is
  // actually postable by the caller; this is just the value carried through.
  community_id?: string | null;
};
