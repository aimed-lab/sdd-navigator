import { NextResponse } from "next/server";
import type { Episode, PodcastResponse } from "@/types/podcast";

// Proxy for the Python explore backend's wiki bridge. GET /api/podcast?q=<query>
// -> { query, count, episodes }. The backend exposes GET/POST /api/wiki, which
// runs the same search_wiki() that the MCP tool uses (tokenized match over
// title/description/concepts/tags; empty query lists all episodes, newest first).
//
// This route also FLATTENS the backend's generic Item envelope — the wiki_pages
// row arrives under `raw` — into the flat Episode shape the page consumes.
//
// Resilience contract: mirrors /api/explore — this route NEVER 500s the page. On
// any failure it returns { episodes: [], error: true } with HTTP 200 so the UI
// renders a clean error state instead of crashing.

const EXPLORE_API_URL = process.env.EXPLORE_API_URL ?? "http://localhost:8000";

// The backend Item envelope; only the fields this route reads are typed.
type WikiItem = {
  id?: string;
  title?: string;
  summary?: string | null;
  raw?: Record<string, unknown>;
};

const asString = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function toEpisode(item: WikiItem): Episode {
  const raw = item.raw ?? {};
  const num = raw.episode_number;
  return {
    id: String(item.id ?? raw.id ?? ""),
    slug: asString(raw.slug) ?? "",
    title: item.title ?? asString(raw.title) ?? "Untitled episode",
    // Only a real number becomes a badge — never coerce a missing value to 0.
    episode_number: typeof num === "number" && Number.isFinite(num) ? num : null,
    description: asString(raw.description) ?? item.summary ?? null,
    summary: asStringArray(raw.summary),
    concepts: Array.isArray(raw.concepts)
      ? (raw.concepts as unknown[]).flatMap((c) =>
          c && typeof c === "object"
            ? [
                {
                  title: asString((c as Record<string, unknown>).title) ?? "",
                  bullets: asStringArray((c as Record<string, unknown>).bullets),
                },
              ]
            : []
        )
      : [],
    tags: asStringArray(raw.tags),
    episode_url: asString(raw.episode_url),
    image_url: asString(raw.image_url),
  };
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";

  try {
    const url = `${EXPLORE_API_URL}/api/wiki?q=${encodeURIComponent(q)}&limit=200`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`wiki backend responded ${res.status}`);

    const data = (await res.json()) as { episodes?: WikiItem[]; error?: string };
    // The backend reports its own failures in-band with HTTP 200.
    if (data.error) throw new Error(data.error);

    const episodes = (data.episodes ?? []).map(toEpisode).filter((e) => e.slug);
    return NextResponse.json<PodcastResponse>({ query: q, count: episodes.length, episodes });
  } catch {
    return NextResponse.json<PodcastResponse>(
      { query: q, count: 0, episodes: [], error: true },
      { status: 200 }
    );
  }
}
