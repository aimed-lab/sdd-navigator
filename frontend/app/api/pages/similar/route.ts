import { NextResponse } from "next/server";
import { getDb } from "@/lib/auth";
import { findSimilarPublicPage } from "@/lib/server/pages/similarPages";

// GET /api/pages/similar?title=...&seed=... — is there already a PUBLIC page
// that is near-identical to a page someone is about to create? Read through
// the caller's own session (public pages are readable signed out), so it can
// only ever see public pages. Returns { match: { slug, title } | null }.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const db = await getDb();
  const match = await findSimilarPublicPage(
    db,
    url.searchParams.get("title") ?? "",
    url.searchParams.get("seed") ?? ""
  );
  return NextResponse.json({ match });
}
