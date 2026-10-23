import { NextResponse } from "next/server";
import { listMyPages } from "@/lib/server/pages/pageView";

// GET /api/pages/mine -> { signedIn, pages: [{ slug, title, visibility, newItems }] }
//
// The viewer's own wiki pages (plus team pages they belong to) with how many
// items arrived in the last 7 days, for Explore's "Your wiki" card.
// Same data as /pages (listMyPages); the owner id is never included.

export const dynamic = "force-dynamic"; // depends on the session

export async function GET() {
  try {
    const res = await listMyPages();
    if (res.status !== "ok") {
      return NextResponse.json({ signedIn: res.status !== "signed_out", pages: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const pages = res.pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      visibility: p.visibility,
      newItems: p.newItems,
    }));
    return NextResponse.json({ signedIn: true, pages }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("GET /api/pages/mine failed", e);
    return NextResponse.json({ signedIn: false, pages: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
