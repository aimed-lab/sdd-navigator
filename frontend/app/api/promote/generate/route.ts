import { NextResponse } from "next/server";
import { ServerConfigError } from "@/lib/server/supabaseServer";
import { fetchPaperById } from "@/lib/server/promote/fetchPaper";
import { generatePromoArticle } from "@/lib/server/promote/generateArticle";
import { RateLimitedError } from "@/lib/server/promote/groqCall";
import {
  STALE_TTL_GENERATOR,
  TTL_GENERATOR,
  normalizeKey,
  serverCache,
} from "@/lib/serverCache";
import type { GeneratorResult } from "@/lib/showcaseTypes";

// POST /api/promote/generate  { input: "<DOI | PMID | paper URL>" }
//   -> { paper, headline, standfirst, articleBody }
//
// PUBLIC on purpose — no auth. Reads open paper metadata (bioRxiv / Crossref /
// PubMed) and returns a generated article DRAFT. It WRITES NOTHING to the
// database and publishes nothing — turning a draft into a shareable page at
// /promote/[slug] is a separate, signed-in step through
// app/promote/actions.ts (createArticleDraftAction / publishArticleAction).
// Only the "paper" category in the /promote/submit picker calls this route at
// all; every other category is written by hand (components/promote/SubmitFlow.tsx).
//
// RATE-LIMIT DISCIPLINE. Each miss makes one Groq call (up to 3,072 of a
// 12,000-tokens-per-minute budget — this used to be two calls/~6,144 tokens
// before the funding-pitch/lay-summary generator was removed), which
// measurably 500'd under light concurrency before the defences below existed.
// Three defences, in order of how much they do:
//   1. CACHE — the same paper never costs tokens twice. Keyed on the NORMALIZED
//      identifier, so "10.1126/SCIENCE.1225829" and " 10.1126/science.1225829 "
//      are one entry. Single-flight means two simultaneous requests for the same
//      paper make ONE Groq call, not two.
//   2. RETRY — groqCall.ts retries once on a 429, absorbing two DIFFERENT papers
//      colliding in one minute.
//   3. FRIENDLY FAILURE — a genuine rate-limit returns 503 with a message the UI
//      shows verbatim, never a bare 500.

export const maxDuration = 60;

/** The cache key. Lower-cased and whitespace-stripped so trivially different
 *  spellings of one identifier share an entry. */
const cacheKeyFor = (input: string) => normalizeKey("promote-generate", input);

async function generate(input: string): Promise<GeneratorResult | null> {
  const paper = await fetchPaperById(input);
  if (!paper) return null;

  const article = await generatePromoArticle(paper);

  return {
    paper: {
      title: paper.title,
      authors: paper.authors,
      sourceUrl: paper.sourceUrl,
      doi: paper.doi,
      pmid: paper.pmid,
      publishedDate: paper.publishedDate,
      journal: paper.journal,
    },
    headline: article.headline,
    standfirst: article.standfirst,
    articleBody: article.articleBody,
  };
}

/** Sentinel so a "paper not found" result is cached-through as a 404 rather than
 *  throwing (and therefore never cached, re-hitting the sources every time). */
class NotFoundError extends Error {}

export async function POST(req: Request) {
  let input = "";
  try {
    const body = await req.json();
    if (body && typeof body.input === "string") input = body.input.trim();
  } catch {
    // fall through to the empty-input 400
  }

  if (!input) {
    return NextResponse.json(
      { error: "Enter a DOI, PubMed ID, or paper URL." },
      { status: 400 }
    );
  }

  const key = cacheKeyFor(input);
  const cached = await serverCache.has(key);

  try {
    const result = await serverCache.getOrCompute<GeneratorResult>(
      key,
      async () => {
        const r = await generate(input);
        if (!r) throw new NotFoundError();
        return r;
      },
      TTL_GENERATOR,
      STALE_TTL_GENERATOR
    );

    // `cached` is sampled BEFORE the call so the header reflects whether this
    // request paid for Groq — useful in the UI and for verifying the cache.
    return NextResponse.json(result, { headers: { "x-cache": cached ? "HIT" : "MISS" } });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json(
        { error: "Couldn't find that paper. Check the DOI, PMID or URL and try again." },
        { status: 404 }
      );
    }
    if (e instanceof RateLimitedError) {
      // 503, not 500: this is "come back shortly", not "something is broken".
      return NextResponse.json({ error: e.message, retryable: true }, { status: 503 });
    }
    if (e instanceof ServerConfigError) {
      return NextResponse.json({ error: "Generator is not configured." }, { status: 500 });
    }
    console.error("promote/generate failed", e);
    return NextResponse.json(
      {
        error: "The generator is busy right now — try again in a moment.",
        retryable: true,
      },
      { status: 503 }
    );
  }
}
