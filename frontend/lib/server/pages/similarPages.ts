// Is there already a PUBLIC page near-identical to one someone is about to
// create? Shared by GET /api/pages/similar (the website's assistant) and the
// agent's create_page preview. Read through the caller's own client; the query
// itself filters to public pages.

import { isNearDuplicate, MAX_SEED_CHARS, MAX_TITLE_CHARS } from "@/lib/server/assistant/assistantReply";
import type { ActingDb } from "@/lib/server/pages/actingContext";

/** A word to narrow the database query: the longest alphanumeric token. The
 *  precise decision is made in code by isNearDuplicate(). */
function searchWord(text: string): string {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  words.sort((a, b) => b.length - a.length);
  return words[0] ?? "";
}

export async function findSimilarPublicPage(
  db: ActingDb,
  titleIn: string,
  seedIn: string
): Promise<{ slug: string; title: string } | null> {
  const title = titleIn.trim().slice(0, MAX_TITLE_CHARS);
  const seed = seedIn.trim().slice(0, MAX_SEED_CHARS);
  const word = searchWord(`${title} ${seed}`);
  if (!word || !db) return null;

  const { data, error } = await db
    .from("pages")
    .select("slug, title, seed_input")
    .eq("visibility", "public")
    .or(`title.ilike.%${word}%,seed_input.ilike.%${word}%`)
    .limit(50);
  if (error) {
    console.error("findSimilarPublicPage failed", error);
    return null;
  }
  const match = ((data ?? []) as { slug: string; title: string; seed_input: string }[]).find((p) =>
    isNearDuplicate({ title, seed }, { title: p.title, seed: p.seed_input })
  );
  return match ? { slug: match.slug, title: match.title } : null;
}
