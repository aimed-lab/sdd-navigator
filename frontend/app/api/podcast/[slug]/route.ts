import { NextResponse } from "next/server";
import type { EpisodeDetail } from "@/types/podcast";

// Proxy for one episode's FULL record (transcript included) — the detail page's
// primary fetch. Backed by the Python backend's GET /api/wiki/episode?slug=…,
// which is the only path that selects `transcript` (and only for a single row).
//
// Distinct from /api/podcast (the grid), which must never carry transcripts.
//
// Unlike the list routes this DOES surface 404 — the page needs to tell "no such
// episode" (render notFound) apart from "backend is down" (render retry).

const EXPLORE_API_URL = process.env.EXPLORE_API_URL ?? "http://localhost:8000";

type RawEpisode = Record<string, unknown>;

const asString = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function toDetail(raw: RawEpisode): EpisodeDetail {
  const num = raw.episode_number;
  return {
    id: String(raw.id ?? ""),
    slug: asString(raw.slug) ?? "",
    title: asString(raw.title) ?? "Untitled episode",
    episode_number: typeof num === "number" && Number.isFinite(num) ? num : null,
    description: asString(raw.description),
    summary: asStringArray(raw.summary),
    concepts: Array.isArray(raw.concepts)
      ? (raw.concepts as unknown[]).flatMap((c) =>
          c && typeof c === "object"
            ? [
                {
                  title: asString((c as RawEpisode).title) ?? "",
                  bullets: asStringArray((c as RawEpisode).bullets),
                },
              ]
            : []
        )
      : [],
    tags: asStringArray(raw.tags),
    episode_url: asString(raw.episode_url),
    image_url: asString(raw.image_url),
    transcript: asString(raw.transcript),
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  try {
    const res = await fetch(
      `${EXPLORE_API_URL}/api/wiki/episode?slug=${encodeURIComponent(slug)}`,
      { cache: "no-store" }
    );

    if (res.status === 404) {
      return NextResponse.json({ episode: null, notFound: true }, { status: 404 });
    }
    if (!res.ok) throw new Error(`wiki backend responded ${res.status}`);

    const data = (await res.json()) as { episode?: RawEpisode | null; error?: string };
    if (data.error) throw new Error(data.error);
    if (!data.episode) {
      return NextResponse.json({ episode: null, notFound: true }, { status: 404 });
    }

    return NextResponse.json({ episode: toDetail(data.episode) });
  } catch {
    return NextResponse.json({ episode: null, error: true }, { status: 200 });
  }
}
