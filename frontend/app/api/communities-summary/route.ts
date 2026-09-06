import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listCommunities, listMyMemberships } from "@/lib/server/communities";

// GET /api/communities-summary -> { signedIn, yours, others }
//
// Feeds the compact Communities section at the top of /explore
// (components/explore/CommunitiesSection.tsx). Explore is a client
// component ("use client", wrapped in Suspense for useSearchParams — see
// app/explore/page.tsx), so it can't import lib/server/communities.ts
// directly the way the server-rendered /communities page does; this route
// is the same fetch-on-mount pattern the nav's own unseen-inbox badge
// already uses (see components/Nav.tsx's useUnseenInbox), not a new idiom.
//
// Same split /communities itself uses — "yours" (active membership) vs
// "others" (everything else, with a `pending` flag) — computed from ONE
// listMyMemberships() call, not a per-community membership check.

export const dynamic = "force-dynamic"; // depends on the session

export async function GET() {
  try {
    const [user, communities, memberships] = await Promise.all([
      getCurrentUser(),
      listCommunities(),
      listMyMemberships(),
    ]);

    const yours = communities
      .filter((c) => memberships[c.id]?.status === "active")
      .map((c) => ({ community: c, role: memberships[c.id]?.role ?? null }));

    const others = communities
      .filter((c) => memberships[c.id]?.status !== "active")
      .map((c) => ({ community: c, pending: memberships[c.id]?.status === "pending" }));

    return NextResponse.json(
      { signedIn: !!user, yours, others },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    // A failing widget must never break Explore — report an empty summary
    // and move on, same discipline as the inbox badge's own route.
    console.error("communities-summary failed", e);
    return NextResponse.json(
      { signedIn: false, yours: [], others: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
