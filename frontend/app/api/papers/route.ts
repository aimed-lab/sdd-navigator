import { NextResponse } from "next/server";
import type { ExploreItem } from "@/types/explore";

// Proxy for the backend's live literature search (PubMed/OpenAlex/Crossref
// fan-out) — GET /api/papers?q=<query>&limit=<n>. Backs the "Live Literature"
// rail on the episode detail page, which anchors each episode to current papers.
//
// Resilience contract: mirrors the other proxies — never 500s the page. On any
// failure it returns { items: [], error: true } with HTTP 200 so the rail can
// render its own error state without taking the page down.

const EXPLORE_API_URL = process.env.EXPLORE_API_URL ?? "http://localhost:8000";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = url.searchParams.get("limit") ?? "8";

  if (!q.trim()) return NextResponse.json({ query: q, items: [] });

  try {
    const res = await fetch(
      `${EXPLORE_API_URL}/api/papers?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`,
      { cache: "no-store" }
    );
    if (!res.ok) throw new Error(`papers backend responded ${res.status}`);

    const data = (await res.json()) as { items?: ExploreItem[]; error?: string };
    if (data.error) throw new Error(data.error);

    return NextResponse.json({ query: q, items: data.items ?? [] });
  } catch {
    return NextResponse.json({ query: q, items: [], error: true }, { status: 200 });
  }
}
