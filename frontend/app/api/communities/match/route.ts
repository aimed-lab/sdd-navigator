import { NextResponse } from "next/server";
import { matchCommunitiesForViewer } from "@/lib/server/communityMatches";
import { ASSISTANT_MAX_REQUESTS, ASSISTANT_WINDOW_MS, clientIp, createRateLimiter } from "@/lib/server/rateLimit";

// GET /api/communities/match?q=<topic> -> { signedIn, matches }
//
// The assistant's "check before creating" step: the top 3 existing communities
// for a topic, with member count, why each matched, and (only where the viewer
// may see the roster) who runs it. Read only; joining and creating happen
// through the existing actions after the researcher clicks.

export const dynamic = "force-dynamic"; // depends on the session

const limiter = createRateLimiter(ASSISTANT_WINDOW_MS, ASSISTANT_MAX_REQUESTS);

export async function GET(req: Request) {
  if (limiter.limited(clientIp(req))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 200);
  if (q.length < 3) return NextResponse.json({ signedIn: false, matches: [] });
  try {
    return NextResponse.json(await matchCommunitiesForViewer(q), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("GET /api/communities/match failed", e);
    return NextResponse.json({ signedIn: false, matches: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
