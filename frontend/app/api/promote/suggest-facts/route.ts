import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { suggestKeyFacts } from "@/lib/server/promote/suggestKeyFacts";
import { RateLimitedError } from "@/lib/server/promote/groqCall";
import { canonicalType } from "@/lib/server/promote/showcaseKinds";
import { createRateLimiter } from "@/lib/server/rateLimit";
import { ServerConfigError } from "@/lib/server/supabaseServer";

// POST /api/promote/suggest-facts  { type, headline, standfirst, body }
//   -> { facts: [{label, value} x 3] }
//
// Backs the edit page's "Suggest key facts" button. Signed-in only (it spends
// model tokens) and rate limited per user. WRITES NOTHING: the author reviews the
// suggestions and saves them with the rest of the item.

export const maxDuration = 60;

const limiter = createRateLimiter(60_000, 8);

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to use this." }, { status: 401 });
  if (limiter.limited(user.id)) {
    return NextResponse.json({ error: "Too many requests. Try again in a minute.", retryable: true }, { status: 429 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* validated below */
  }
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const headline = str(body.headline, 300);
  const standfirst = str(body.standfirst, 1000);
  const text = str(body.body, 20000);
  if (!headline.trim() && !text.trim()) {
    return NextResponse.json({ error: "Write a headline and some text first." }, { status: 400 });
  }

  try {
    const facts = await suggestKeyFacts(canonicalType(str(body.type, 40)), headline, standfirst, text);
    return NextResponse.json({ facts });
  } catch (e) {
    if (e instanceof RateLimitedError) return NextResponse.json({ error: e.message, retryable: true }, { status: 503 });
    if (e instanceof ServerConfigError) return NextResponse.json({ error: "Suggestions are not configured." }, { status: 500 });
    console.error("promote/suggest-facts failed", e);
    return NextResponse.json({ error: "Couldn't suggest facts right now. Try again in a moment.", retryable: true }, { status: 503 });
  }
}
