// lib/server/communities.ts — reads for the `communities` table
// (database/migrations/2026-08-20_communities.sql).
//
// PUBLIC READ ONLY — the communities SELECT policy is USING(true), so this
// runs through the anon server client, same posture as lib/server/collaborate.ts's
// listResources(). There is no create/join action in this module: communities
// are a small, curated list (seeded by the migration) and community_members
// rows are managed by the service role / derived for ColaboFest — nothing in
// the frontend writes either table.

import { getAnonServerClient } from "./supabaseServer";

export type Community = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_open: boolean;
};

/** All communities, ordered by name. Degrades to an empty list so the
 *  Collaborate page still renders (without chips) if this read fails. */
export async function listCommunities(): Promise<Community[]> {
  const supabase = getAnonServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("communities")
    .select("id, slug, name, description, is_open")
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data as Community[];
}

/** One community by slug — used to resolve the ?community= URL param into an
 *  id for filtering posts/resources. Null when the slug doesn't exist. */
export async function getCommunityBySlug(slug: string): Promise<Community | null> {
  const supabase = getAnonServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("communities")
    .select("id, slug, name, description, is_open")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return null;
  return data as Community;
}
