// lib/server/researchers.ts — public researcher directory + profiles (anon).
//
// listPublicResearchers + getResearcherProfile are LIVE (migrated from
// researchers/page.tsx and researchers/[slug]/page.tsx in Step 4a — same
// queries, same is_public=true filters, same ordering/limits).
//
// RLS NOTE: relies on the live DB permitting the ANON role to SELECT users rows
// where is_public=true (and to read researcher_works) — confirmed working via
// the logged-out /researchers directory. This module never uses the service-role
// key to bypass RLS.

import { getAnonServerClient } from "@/lib/server/supabaseServer";

// ── Directory (listPublicResearchers) ─────────────────────────────────────────

// One public researcher row for the directory grid.
export type ResearcherCard = {
  id: string;
  name: string;
  affiliation: string | null;
  institution: string | null;
  bio: string | null;
  research_focus: string | null;
  interests: string[] | null;
  is_public: boolean;
  profile_slug: string | null;
};

// A single researcher_works row (only the columns the directory counts by).
export type ResearcherWorkRow = { user_id: string; type: string };

// A public lab_resources row for the directory (owner_id so the client can group
// resources under their researcher card). contact_info is NEVER selected here —
// it is revealed only through the auth-gated /contact route.
export type LabResourceCard = {
  id: string;
  owner_id: string;
  category: string;
  fields: Record<string, unknown>;
};

// The three raw query results, so the client keeps its exact per-user
// aggregation (work counts + resource grouping) as presentation, not data access.
export type PublicResearchersResult = {
  researchers: ResearcherCard[];
  works: ResearcherWorkRow[];
  resources: LabResourceCard[];
};

// Fetch the public researcher directory + all researcher_works rows + all public
// lab_resources, in parallel. users filtered to is_public=true, ordered by name;
// researcher_works selecting (user_id, type); lab_resources selecting the public
// columns (no contact_info). Degrades to empty arrays.
export async function listPublicResearchers(): Promise<PublicResearchersResult> {
  const supabase = getAnonServerClient();
  if (!supabase) return { researchers: [], works: [], resources: [] };

  const [resRes, worksRes, resourcesRes] = await Promise.all([
    supabase
      .from("users")
      .select(
        // NOTE: email is deliberately EXCLUDED — it is PII and must never reach
        // this public (anon-readable) directory payload. Researcher-to-researcher
        // contact is moving on-platform; no mailto path depends on it anymore.
        "id, name, affiliation, institution, bio, research_focus, interests, is_public, profile_slug",
      )
      .eq("is_public", true)
      .order("name"),
    supabase.from("researcher_works").select("user_id, type"),
    // Public lab-resource rows — NEVER select contact_info here (that lives only
    // on the auth-gated /contact route).
    supabase.from("lab_resources").select("id, owner_id, category, fields"),
  ]);

  return {
    researchers: (resRes.data ?? []) as ResearcherCard[],
    works: (worksRes.data ?? []) as ResearcherWorkRow[],
    resources: (resourcesRes.data ?? []) as LabResourceCard[],
  };
}

// ── Public profile (getResearcherProfile) ─────────────────────────────────────

// Full public profile row (the 13 columns the profile page selects by slug).
export type ResearcherProfileRow = {
  id: string;
  name: string;
  affiliation: string | null;
  institution: string | null;
  country: string | null;
  bio: string | null;
  research_focus: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  interests: string[] | null;
  is_public: boolean;
  profile_slug: string | null;
};

// A full researcher_works row (select * on the profile page).
export type ResearcherWorkFull = {
  id: string;
  user_id: string;
  type: "paper" | "tool" | "dataset";
  title: string;
  journal: string | null;
  year: number | null;
  url: string | null;
  description: string | null;
  created_at: string;
};

// The reduced "related researchers" row (7 columns the sidebar selects).
export type RelatedResearcher = {
  id: string;
  name: string;
  affiliation: string | null;
  institution: string | null;
  research_focus: string | null;
  profile_slug: string | null;
  interests: string[] | null;
};

// One of this researcher's registered lab resources, for the profile page. No
// contact_info — each resource's Connect button reveals that via the auth-gated
// /contact route, per-resource.
export type ProfileLabResource = {
  id: string;
  category: string;
  fields: Record<string, unknown>;
  created_at: string;
};

// Full public profile payload: the researcher, their works, their registered lab
// resources, and the related-pool candidates. The client still does the
// interest-overlap sort + top-3 slice.
export type ResearcherProfile = {
  profile: ResearcherProfileRow;
  works: ResearcherWorkFull[];
  resources: ProfileLabResource[];
  related: RelatedResearcher[];
};

// Fetch one public researcher profile by slug (+ works + related pool). Returns
// null when the profile is missing OR not public, so the caller renders the
// not-found state exactly as before. Both is_public=true filters, the slug
// filter, the works ordering, and the related neq/limit move verbatim.
export async function getResearcherProfile(slug: string): Promise<ResearcherProfile | null> {
  const supabase = getAnonServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("users")
    .select(
      // email deliberately EXCLUDED (PII) — see listPublicResearchers. This
      // payload is anon-readable, so it must not carry the researcher's email.
      "id, name, affiliation, institution, country, bio, research_focus, linkedin_url, website_url, interests, is_public, profile_slug",
    )
    .eq("profile_slug", slug)
    .eq("is_public", true)
    .maybeSingle();

  if (error || !data) return null;

  const profile = data as ResearcherProfileRow;

  const [worksRes, resourcesRes, relatedRes] = await Promise.all([
    supabase
      .from("researcher_works")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false }),
    // This researcher's registered lab resources (public columns only — no
    // contact_info; that's revealed per-resource via the auth-gated /contact route).
    supabase
      .from("lab_resources")
      .select("id, category, fields, created_at")
      .eq("owner_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("users")
      .select("id, name, affiliation, institution, research_focus, profile_slug, interests")
      .eq("is_public", true)
      .neq("id", profile.id)
      .limit(10),
  ]);

  return {
    profile,
    works: (worksRes.data ?? []) as ResearcherWorkFull[],
    resources: (resourcesRes.data ?? []) as ProfileLabResource[],
    related: (relatedRes.data ?? []) as RelatedResearcher[],
  };
}
