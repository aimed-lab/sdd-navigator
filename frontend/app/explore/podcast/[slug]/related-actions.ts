"use server";

// Thin Server Action wrapper so RelatedEpisodesRail (a client component,
// deliberately loading independently of the main episode content — see its
// own file) can call the real Supabase-backed scoring in lib/server/wiki.ts
// without a REST route in between. All the actual logic lives in wiki.ts,
// alongside the other reads.

import { getRelatedEpisodes, type Concept, type RelatedEpisodesResult } from "@/lib/server/wiki";

export async function fetchRelatedEpisodes(
  slug: string,
  concepts: Concept[],
  tags: string[],
  limit?: number
): Promise<RelatedEpisodesResult> {
  return getRelatedEpisodes(slug, concepts, tags, limit);
}
