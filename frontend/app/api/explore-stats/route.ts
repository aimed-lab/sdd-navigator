// GET /api/explore-stats — the one real number the Explore page's stats line
// shows: how many podcast episodes exist (same wiki_pages read as
// /explore/podcast and the homepage). `episodes` is null when the read fails,
// and the page then hides that figure instead of guessing.

import { NextResponse } from "next/server";
import { listEpisodes } from "@/lib/server/wiki";

export async function GET() {
  try {
    const result = await listEpisodes();
    return NextResponse.json({ episodes: result.status === "ok" ? result.episodes.length : null });
  } catch {
    return NextResponse.json({ episodes: null });
  }
}
