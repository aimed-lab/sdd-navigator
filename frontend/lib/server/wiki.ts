// lib/server/wiki.ts — reads from `wiki_pages` (public, anon).
//
// getWikiPage, getRelatedEpisodes, and listEpisodes are all LIVE, backing the
// podcast pages directly against Supabase (no Python backend in the loop).

import { getAnonServerClient } from "@/lib/server/supabaseServer";

// One concept block within a wiki page.
export type Concept = { title: string; bullets: string[] };

// `concepts` is a jsonb column; the column TYPE allows either an array of
// {title,bullets} objects or an array of bare strings (see the union below).
// Checked every live row (64/64, 2026-07) and all of them are the object
// shape — but that's the CURRENT data, not a schema guarantee, so this is
// normalized at read time rather than assumed. A bare string becomes a
// concept with a title and no bullets; anything that's neither a string nor
// a well-formed {title,bullets} object is dropped rather than crashing the
// page on a malformed row.
//
// Not exported: every call site (getWikiPage, getRelatedEpisodes,
// listEpisodes) lives in this same module.
function normalizeConcepts(raw: unknown): Concept[] {
  if (!Array.isArray(raw)) return [];
  const out: Concept[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      if (entry.trim()) out.push({ title: entry, bullets: [] });
      continue;
    }
    if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const title = typeof obj.title === "string" ? obj.title : null;
      if (!title) continue; // no title -> not a usable concept, drop it
      const bullets = Array.isArray(obj.bullets)
        ? obj.bullets.filter((b): b is string => typeof b === "string")
        : [];
      out.push({ title, bullets });
    }
  }
  return out;
}

// Full wiki page row as selected for the episode detail page, with
// `concepts` already normalized to the strict Concept[] shape above.
export type WikiPage = {
  id: string;
  slug: string;
  title: string;
  episode_number: number;
  transcript: string;
  concepts: Concept[];
  tags: string[];
  episode_url: string;
  description: string;
  summary: string[];
  image_url: string | null;
};

// Discriminates the three outcomes the episode detail page needs to render
// distinctly: a real 404 (no row for this slug) vs. a read failure (network/
// query error — the row may well exist) vs. success. Collapsing these to a
// single null, as an earlier version of this function did, made "the
// episode doesn't exist" and "the database didn't respond" indistinguishable
// to the caller.
export type WikiPageResult =
  | { status: "ok"; page: WikiPage }
  | { status: "missing" }
  | { status: "error" };

// A compact related-episode row (sidebar list on the topic page).
export type RelatedEpisode = {
  episode_number: number;
  title: string;
  slug: string;
  image_url: string | null;
};

export type RelatedEpisodesResult =
  | { status: "ok"; episodes: RelatedEpisode[] }
  | { status: "error" };

// One episode card as rendered by the podcast grid. Column shape matches the
// podcast page's existing usage (tags/description treated as present).
// `concepts` is included even though the card itself never renders it — the
// grid's client-side search filters over concept titles too (title +
// description + concept titles + tags), so the field has to travel with the
// row or the search would silently ignore concepts.
export type EpisodeCard = {
  id: string;
  episode_number: number;
  title: string;
  tags: string[];
  description: string;
  slug: string;
  image_url: string | null;
  concepts: Concept[];
};

// Discriminates a read failure from a genuinely empty table — a query error
// must not render as "no episodes" (see EpisodesResult below).
export type EpisodesResult =
  | { status: "ok"; episodes: EpisodeCard[] }
  | { status: "error" };

// Fetch a single wiki page by slug. Distinguishes "no such episode" from "the
// read failed" (see WikiPageResult) — .maybeSingle() is what makes that
// possible: unlike .single(), it returns { data: null, error: null } for zero
// matching rows instead of raising, so a genuine 404 and a genuine failure
// never look the same to the caller.
export async function getWikiPage(slug: string): Promise<WikiPageResult> {
  const supabase = getAnonServerClient();
  if (!supabase) return { status: "error" };

  const { data, error } = await supabase
    .from("wiki_pages")
    .select("id,slug,title,episode_number,transcript,concepts,tags,episode_url,description,summary,image_url")
    .eq("slug", slug)
    .maybeSingle();

  if (error) return { status: "error" };
  if (!data) return { status: "missing" };

  return {
    status: "ok",
    page: { ...data, concepts: normalizeConcepts(data.concepts) } as WikiPage,
  };
}

// Lowercased, deduped set of an episode's "topic terms" — its concept titles
// plus its tags. This is the vocabulary related-ness is scored against;
// bullets are deliberately excluded (too granular/noisy for an overlap
// score at the episode level).
function topicTerms(concepts: Concept[], tags: string[]): Set<string> {
  const out = new Set<string>();
  for (const c of concepts) {
    const t = c.title.trim().toLowerCase();
    if (t) out.add(t);
  }
  for (const tag of tags) {
    const t = tag.trim().toLowerCase();
    if (t) out.add(t);
  }
  return out;
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const term of a) if (b.has(term)) n++;
  return n;
}

// Real topical relatedness, computed here rather than fetched pre-scored:
// scores every OTHER episode by how many of ITS concept titles + tags
// overlap with the SOURCE episode's (both lowercased, deduped sets), and
// returns the top `limit` by overlap count. Ties broken by episode_number
// desc (recency). When nothing overlaps at all, every candidate scores 0 and
// the overlap-desc sort degenerates to a plain recency sort — that IS the
// "fall back to recency" behavior, not a separate code path, because
// (0, recency) ordering among all-zero scores is exactly recency ordering.
//
// Takes the source episode's OWN concepts/tags rather than re-fetching them
// by slug — the caller (the episode detail page) already has them from
// getWikiPage, so this avoids a second round-trip for data already in hand.
export async function getRelatedEpisodes(
  slug: string,
  sourceConcepts: Concept[],
  sourceTags: string[],
  limit = 4
): Promise<RelatedEpisodesResult> {
  const supabase = getAnonServerClient();
  if (!supabase) return { status: "error" };

  const { data, error } = await supabase
    .from("wiki_pages")
    .select("episode_number,title,slug,image_url,concepts,tags")
    .neq("slug", slug);

  if (error) return { status: "error" };

  const sourceTerms = topicTerms(sourceConcepts, sourceTags);

  const scored = (data ?? []).map((row) => {
    const rowTerms = topicTerms(normalizeConcepts(row.concepts), (row.tags as string[]) ?? []);
    return { row, overlap: overlapCount(sourceTerms, rowTerms) };
  });

  scored.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return (b.row.episode_number ?? 0) - (a.row.episode_number ?? 0);
  });

  const episodes: RelatedEpisode[] = scored.slice(0, limit).map(({ row }) => ({
    episode_number: row.episode_number,
    title: row.title,
    slug: row.slug,
    image_url: row.image_url,
  }));

  return { status: "ok", episodes };
}

// List all episodes, newest episode_number first (podcast grid). Same
// ordering as before, plus `concepts` (needed for client-side search — see
// EpisodeCard) normalized the SAME way getWikiPage does, so a concept title
// reads identically whether it came from the detail page or the grid.
// Returns EpisodesResult so a read failure is distinguishable from a
// genuinely empty table — collapsing both to [] would render a failed query
// as "no episodes", which is exactly the misreport this migration is meant
// to remove.
export async function listEpisodes(): Promise<EpisodesResult> {
  const supabase = getAnonServerClient();
  if (!supabase) return { status: "error" };

  const { data, error } = await supabase
    .from("wiki_pages")
    .select("id, slug, title, episode_number, description, tags, image_url, concepts")
    .order("episode_number", { ascending: false });

  if (error) return { status: "error" };

  const episodes = (data ?? []).map((row) => ({
    ...row,
    concepts: normalizeConcepts(row.concepts),
  })) as EpisodeCard[];

  return { status: "ok", episodes };
}
