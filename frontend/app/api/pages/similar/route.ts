import { NextResponse } from "next/server";
import { getDb } from "@/lib/auth";
import { MAX_SEED_CHARS, MAX_TITLE_CHARS, isNearDuplicate } from "@/lib/server/assistant/assistantReply";

// GET /api/pages/similar?title=...&seed=... — is there already a PUBLIC page
// that is near-identical to a page someone is about to create? Read through
// the caller's own session (public pages are readable signed out), so it can
// only ever see public pages. Returns { match: { slug, title } | null }.

export const dynamic = "force-dynamic";

/** A word to narrow the database query: the longest alphanumeric token. The
 *  precise decision is made in code by isNearDuplicate(). */
function searchWord(text: string): string {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  words.sort((a, b) => b.length - a.length);
  return words[0] ?? "";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const title = (url.searchParams.get("title") ?? "").trim().slice(0, MAX_TITLE_CHARS);
  const seed = (url.searchParams.get("seed") ?? "").trim().slice(0, MAX_SEED_CHARS);
  const word = searchWord(`${title} ${seed}`);
  if (!word) return NextResponse.json({ match: null });

  const db = await getDb();
  if (!db) return NextResponse.json({ match: null });

  const { data, error } = await db
    .from("pages")
    .select("slug, title, seed_input")
    .eq("visibility", "public")
    .or(`title.ilike.%${word}%,seed_input.ilike.%${word}%`)
    .limit(50);
  if (error) {
    console.error("GET /api/pages/similar failed", error);
    return NextResponse.json({ match: null });
  }

  const match = ((data ?? []) as { slug: string; title: string; seed_input: string }[]).find((p) =>
    isNearDuplicate({ title, seed: seed }, { title: p.title, seed: p.seed_input })
  );
  return NextResponse.json({ match: match ? { slug: match.slug, title: match.title } : null });
}
