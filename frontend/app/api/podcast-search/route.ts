import { NextResponse } from "next/server";
import { searchEpisodes } from "@/lib/server/explore/podcastSearch";
import { getEpisodeSearchIndex } from "@/lib/server/wiki";
import { ASSISTANT_MAX_REQUESTS, ASSISTANT_WINDOW_MS, clientIp, createRateLimiter } from "@/lib/server/rateLimit";

// GET /api/podcast-search?q=<text> -> { hits, failed }
//
// Searches episode titles, descriptions, concepts / tags AND the transcript
// text, and returns each match with a short snippet. The transcripts stay on
// the server; only the matches are sent.

export const dynamic = "force-dynamic";

// Typing fires one request per pause, so this is looser than the assistant's own limit.
const limiter = createRateLimiter(ASSISTANT_WINDOW_MS, ASSISTANT_MAX_REQUESTS * 8);

export async function GET(req: Request) {
  if (limiter.limited(clientIp(req))) {
    return NextResponse.json({ hits: [], failed: true }, { status: 429 });
  }
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 120);
  if (!q) return NextResponse.json({ hits: [], failed: false });

  const index = await getEpisodeSearchIndex();
  if (index.status !== "ok") return NextResponse.json({ hits: [], failed: true });

  return NextResponse.json(
    { hits: searchEpisodes(index.episodes, q).slice(0, 60), failed: false },
    { headers: { "Cache-Control": "no-store" } }
  );
}
