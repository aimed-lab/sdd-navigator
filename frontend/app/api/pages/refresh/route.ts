import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getPagesServiceRoleClient } from "@/lib/server/pages/pagesDb";
import { makeSupabaseRefreshDeps, runRefresh, type BackendRefreshResult } from "@/lib/server/pages/pageRefresh";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";

// POST /api/pages/refresh — the scheduled refresh of wiki pages. Called
// hourly by .github/workflows/refresh-pages.yml; each run refreshes up to 3
// pages that are due (see lib/server/pages/pageRefresh.ts for the rules).
//
// PROTECTED BY A SECRET, not a user session: nobody is signed in during a
// scheduled run. `Authorization: Bearer <PAGES_REFRESH_SECRET>`; with the
// variable unset the route answers 503 rather than running open. Like the
// rest of this feature it reads and writes with the server-only service-role
// client (getPagesServiceRoleClient, the same construction as
// lib/server/supabaseServer.ts's getServiceRoleClient()), which bypasses RLS.

// A run does up to 3 sequential backend searches, each of which can take a
// while; give the platform room.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Constant-time check of the bearer token. Both sides are hashed first so
 *  timingSafeEqual always compares equal-length buffers and the length of the
 *  secret is not leaked either. */
function bearerMatches(header: string | null, secret: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? "");
  if (!match) return false;
  const a = createHash("sha256").update(match[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

async function callBackend(args: {
  topic: string;
  knownItemIds: string[];
  notes: { slug: string; title: string; body: string }[];
}): Promise<BackendRefreshResult> {
  const res = await fetch(`${EXPLORE_API_URL}/api/page-refresh`, {
    method: "POST",
    headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ topic: args.topic, known_item_ids: args.knownItemIds, notes: args.notes }),
  });
  if (!res.ok) throw new Error(`agent backend responded ${res.status}`);
  return (await res.json()) as BackendRefreshResult;
}

export async function POST(req: Request) {
  const secret = process.env.PAGES_REFRESH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Page refresh is not configured." }, { status: 503 });
  }
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const db = getPagesServiceRoleClient();
  if (!db) {
    return NextResponse.json(
      { error: "Server misconfigured: pages feature has no service-role Supabase client." },
      { status: 500 }
    );
  }

  const summary = await runRefresh(makeSupabaseRefreshDeps(db, callBackend));
  return NextResponse.json(summary);
}
