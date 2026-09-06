"use client";

// The compact Communities section at the TOP of /explore, above the search
// box and the source tabs — Communities is no longer its own nav pillar
// (see components/Nav.tsx); this is how it's reached instead. Same content
// /communities shows (your communities, then other communities you could
// join, the same CommunityCard), but kept to a single horizontal-scroll row
// per group rather than the full page's wrapping grid — the source tabs
// below still need to be visible without scrolling, and a card grid that
// grows with however many communities exist would push them down.
//
// Fetched client-side from /api/communities-summary rather than imported
// from lib/server/communities.ts directly: this file is rendered inside
// app/explore/page.tsx, which is "use client" (useSearchParams needs that),
// and a client component can't import a server-only module — same reason
// the nav's unseen-inbox badge fetches its own count from a route instead
// of calling lib/server/inbox.ts inline.
//
// id="communities" is what app/communities/[slug]/page.tsx's "All
// communities" back link now points at (/explore#communities) instead of
// the no-longer-in-the-nav /communities page.

import { useEffect, useState } from "react";
import Link from "next/link";
import CommunityCard from "@/components/communities/CommunityCard";
import type { Community, CommunityRole } from "@/lib/server/communities";

type YourEntry = { community: Community; role: CommunityRole | null };
type OtherEntry = { community: Community; pending: boolean };
type Summary = { signedIn: boolean; yours: YourEntry[]; others: OtherEntry[] };

/** One horizontal-scroll row of fixed-width cards — what keeps this
 *  section's HEIGHT constant regardless of how many communities exist,
 *  unlike the full /communities page's wrapping grid. */
function CardRow({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-4 overflow-x-auto no-scrollbar pb-1">{children}</div>;
}

export default function CommunitiesSection() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/communities-summary", { cache: "no-store" });
        const json = (await res.json()) as Summary;
        if (!cancelled) setSummary(json);
      } catch {
        // A failed fetch just means the section renders nothing — same
        // "never break the page over a widget" rule as the inbox badge.
        if (!cancelled) setSummary({ signedIn: false, yours: [], others: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to show yet (still loading) or nothing to show at all (no
  // communities exist) — either way, no empty section furniture above the
  // search box.
  if (!summary || (summary.yours.length === 0 && summary.others.length === 0)) return null;

  return (
    <section id="communities" className="max-w-container-max mx-auto mb-10 scroll-mt-24">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-headline-md text-headline-md text-on-background">Communities</h2>
        <Link
          href="/communities"
          className="font-label-md text-label-md text-primary hover:underline underline-offset-4 shrink-0"
        >
          All communities
        </Link>
      </div>

      {summary.signedIn && summary.yours.length > 0 && (
        <div className="mb-4">
          <p className="font-label-sm text-label-sm text-secondary uppercase mb-2">
            Your communities
          </p>
          <CardRow>
            {summary.yours.map(({ community, role }) => (
              <div key={community.id} className="w-64 shrink-0">
                <CommunityCard community={community} member role={role ?? undefined} pending={false} />
              </div>
            ))}
          </CardRow>
        </div>
      )}

      {summary.others.length > 0 && (
        <div>
          <p className="font-label-sm text-label-sm text-secondary uppercase mb-2">
            Other communities
          </p>
          <CardRow>
            {summary.others.map(({ community, pending }) => (
              <div key={community.id} className="w-64 shrink-0">
                <CommunityCard community={community} member={false} pending={pending} />
              </div>
            ))}
          </CardRow>
        </div>
      )}
    </section>
  );
}
