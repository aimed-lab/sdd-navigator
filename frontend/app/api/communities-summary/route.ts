import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listCommunities, listMyMemberships, searchCommunities } from "@/lib/server/communities";
import type { CommunitySummaryItem } from "@/lib/server/communities";

// GET /api/communities-summary[?q=<text>] -> { signedIn, communities }
//
// Feeds the Communities category in Explore (app/explore/page.tsx and
// app/explore/[topic]/page.tsx — the pinned row on "All" and the dedicated
// grid on the Communities chip). Explore is a client component ("use
// client", wrapped in Suspense for useSearchParams), so it can't import
// lib/server/communities.ts directly the way the server-rendered
// /communities page does; this route is the same fetch-on-mount pattern
// the nav's own unseen-inbox badge already uses (see components/Nav.tsx's
// useUnseenInbox), not a new idiom.
//
// `q`, when present and non-blank, scopes to searchCommunities(q) (name /
// purpose / explore_topics — see that function's own comment) instead of
// every community — this is what makes communities show up in a real
// Explore search ("pancreatic cancer" -> matching communities alongside
// papers and trials), not just the blank-query landing view.
//
// ONE FLAT LIST now, not "yours"/"others" — the two-heading split is gone
// (see components/communities/CommunityCard.tsx's badge redesign); each
// item still carries the caller's membership state (member/role/pending)
// so the card can render its own badge, computed from ONE
// listMyMemberships() call, not a per-community membership check.

export const dynamic = "force-dynamic"; // depends on the session

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() ?? "";

    const [user, matched, memberships] = await Promise.all([
      getCurrentUser(),
      q ? searchCommunities(q) : listCommunities(),
      listMyMemberships(),
    ]);

    const communities: CommunitySummaryItem[] = matched.map((community) => {
      const m = memberships[community.id];
      const member = m?.status === "active";
      return {
        community,
        member,
        role: member ? m.role : null,
        pending: m?.status === "pending",
      };
    });

    return NextResponse.json(
      { signedIn: !!user, communities },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    // A failing widget must never break Explore — report an empty summary
    // and move on, same discipline as the inbox badge's own route.
    console.error("communities-summary failed", e);
    return NextResponse.json(
      { signedIn: false, communities: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
