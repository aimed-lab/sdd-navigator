// lib/server/wiki.ts — reads from `wiki_pages` (public, anon).
//
// getWikiPage + getRelatedEpisodes are LIVE (migrated from topics/[slug] in
// Step 4a Phase A — same queries, same columns, same filters/ordering). The
// listEpisodes / getLatestEpisode stubs remain for the later podcast + dashboard
// migrations.

import { getAnonServerClient } from "@/lib/server/supabaseServer";

const NOT_IMPLEMENTED = "lib/server/wiki: not implemented yet (Step 4a migration pending)";

// One concept block within a wiki page.
export type Concept = { title: string; bullets: string[] };

// Full wiki page row as selected for the topic article page.
export type WikiPage = {
  id: string;
  slug: string;
  title: string;
  episode_number: number;
  transcript: string;
  concepts: Concept[] | string[];
  tags: string[];
  episode_url: string;
  description: string;
  summary: string[];
  image_url: string | null;
};

// A compact related-episode row (sidebar list on the topic page).
export type RelatedEpisode = {
  episode_number: number;
  title: string;
  slug: string;
  image_url: string | null;
};

// One episode card as rendered by the podcast grid. Column shape matches the
// podcast page's existing usage (tags/description treated as present).
export type EpisodeCard = {
  id: string;
  episode_number: number;
  title: string;
  tags: string[];
  description: string;
  slug: string;
  image_url: string | null;
};

// Fetch a single wiki page by slug. Returns null when the row is missing or the
// read errors, so the caller can render notFound() exactly as before.
export async function getWikiPage(slug: string): Promise<WikiPage | null> {
  const supabase = getAnonServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("wiki_pages")
    .select("id,slug,title,episode_number,transcript,concepts,tags,episode_url,description,summary,image_url")
    .eq("slug", slug)
    .single();

  if (error || !data) return null;
  return data as WikiPage;
}

// Fetch the most-recent episodes other than `slug` (topic-page sidebar). Same
// query as before: exclude this slug, newest episode_number first, capped.
export async function getRelatedEpisodes(slug: string, limit = 3): Promise<RelatedEpisode[]> {
  const supabase = getAnonServerClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("wiki_pages")
    .select("episode_number,title,slug,image_url")
    .neq("slug", slug)
    .order("episode_number", { ascending: false })
    .limit(limit);

  return (data ?? []) as RelatedEpisode[];
}

// List all episodes, newest episode_number first (podcast grid). Same query as
// before: same select columns, same ordering, no limit. Logs a read error and
// degrades to an empty list, matching the page's prior behavior.
export async function listEpisodes(): Promise<EpisodeCard[]> {
  const supabase = getAnonServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("wiki_pages")
    .select("id, slug, title, episode_number, description, tags, image_url")
    .order("episode_number", { ascending: false });

  if (error) console.error(error.message);
  return (data ?? []) as EpisodeCard[];
}

export async function getLatestEpisode(): Promise<EpisodeCard | null> {
  throw new Error(NOT_IMPLEMENTED);
}
