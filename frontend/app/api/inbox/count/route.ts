import { NextResponse } from "next/server";
import { unseenInboxCount } from "@/lib/server/inbox";

// GET /api/inbox/count -> { count } — the unseen count for the shared nav badge.
//
// A route (not a Server Action) because the consumer is the always-mounted client
// nav, which needs to refetch on navigation rather than on a form submit.
//
// The count is for whoever the SESSION COOKIE says you are: there is no user
// param to pass, and inbox_unseen_count() derives the caller from auth.uid()
// itself. A signed-out request gets 0, not an error — the nav renders for
// everyone and a 401 here would just be noise in the console.
//
// no-store is load-bearing: this response is per-user, so a cached or shared copy
// would show one person's count to another. Never add revalidation to this route.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const count = await unseenInboxCount();
    return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // A failing badge must never break the nav — report zero and move on.
    console.error("inbox count failed", e);
    return NextResponse.json({ count: 0 }, { headers: { "Cache-Control": "no-store" } });
  }
}
