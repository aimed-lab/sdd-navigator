import { NextResponse } from "next/server";
import { ServerConfigError } from "@/lib/server/supabaseServer";
import { generateStructuredArticle } from "@/lib/server/promote/generateStructuredArticle";
import { RateLimitedError } from "@/lib/server/promote/groqCall";
import { STALE_TTL_GENERATOR, TTL_GENERATOR, normalizeKey, serverCache } from "@/lib/serverCache";
import { SHOWCASE_TYPES, type ShowcaseType, type StructuredGeneratorResult } from "@/lib/showcaseTypes";

// POST /api/promote/generate-structured
//   { type, oneLiner, contrast, specifics: string[], context, audience }
//   -> { headline, standfirst, articleBody, linkedinPost }
//
// PUBLIC on purpose, same posture as /api/promote/generate — no auth, writes
// nothing, just drafts. This is the entry point for every NON-paper type
// (talk/poster/award/tool/event/other): five short answers, no fetch, no
// GitHub URL required — see lib/showcaseTypes.ts's own header on why the
// shape of the questions is what does the work, not sourced content.
//
// SAME RATE-LIMIT DISCIPLINE as /api/promote/generate: cached + single-
// flighted (keyed on the normalized JSON of the five answers, so a double
// submit of the identical form never pays for a second Groq call), one
// retry on 429 inside groqCall.ts, a 503 (not a bare 500) on genuine
// rate-limiting.

export const maxDuration = 60;

type Body = {
  type?: string;
  oneLiner?: string;
  contrast?: string;
  specifics?: string[];
  context?: string;
  audience?: string;
};

function isNonPaperType(t: string): t is Exclude<ShowcaseType, "paper"> {
  return t !== "paper" && (SHOWCASE_TYPES as readonly string[]).includes(t);
}

/** The cache key — the whole answer set, normalized. Two different people
 *  writing the same five answers is vanishingly unlikely, so this exists to
 *  absorb a double-click/retry on the SAME submission, not to dedupe across
 *  people the way the DOI cache key does. */
function cacheKeyFor(type: string, oneLiner: string, contrast: string, specifics: string[], context: string, audience: string) {
  return normalizeKey(
    "promote-generate-structured",
    JSON.stringify([type, oneLiner, contrast, specifics, context, audience])
  );
}

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // fall through to the validation error below
  }

  const type = typeof body.type === "string" ? body.type : "";
  const oneLiner = typeof body.oneLiner === "string" ? body.oneLiner.trim() : "";
  const contrast = typeof body.contrast === "string" ? body.contrast.trim() : "";
  const specifics = Array.isArray(body.specifics)
    ? body.specifics.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean)
    : [];
  const context = typeof body.context === "string" ? body.context.trim() : "";
  const audience = typeof body.audience === "string" ? body.audience.trim() : "";

  if (!isNonPaperType(type)) {
    return NextResponse.json({ error: "Choose what you're sharing." }, { status: 400 });
  }
  if (!oneLiner || !contrast || specifics.length < 3 || !context || !audience) {
    return NextResponse.json(
      { error: "Answer all five questions (at least three specifics) to generate a post." },
      { status: 400 }
    );
  }

  const key = cacheKeyFor(type, oneLiner, contrast, specifics, context, audience);
  const cached = await serverCache.has(key);

  try {
    const result = await serverCache.getOrCompute<StructuredGeneratorResult>(
      key,
      () => generateStructuredArticle(type, { oneLiner, contrast, specifics, context, audience }),
      TTL_GENERATOR,
      STALE_TTL_GENERATOR
    );

    return NextResponse.json(result, { headers: { "x-cache": cached ? "HIT" : "MISS" } });
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return NextResponse.json({ error: e.message, retryable: true }, { status: 503 });
    }
    if (e instanceof ServerConfigError) {
      return NextResponse.json({ error: "Generator is not configured." }, { status: 500 });
    }
    if (e instanceof Error && e.message.startsWith("Answer at least")) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("promote/generate-structured failed", e);
    return NextResponse.json(
      { error: "The generator is busy right now — try again in a moment.", retryable: true },
      { status: 503 }
    );
  }
}
