"use client";

// The Communities block inside Explore results — shared by app/explore/page.tsx
// (pinned first on "All", or the whole view when the Communities chip is
// selected) and app/explore/[topic]/page.tsx (same, but scoped to the
// search). Replaces the old components/explore/CommunitiesSection.tsx block
// that used to sit ABOVE the search box: communities are now a result, not
// a fixture — pinned first among results rather than interleaved (a
// community is somewhere to join, not a document to read; it shouldn't
// turn up as result 47 between two papers), and searchable, via
// /api/communities-summary?q=<query> (see that route's own comment).
//
// id="communities" is kept from the old block — app/communities/[slug]/page.tsx's
// "All communities" back link points at /explore#communities, and this is
// still where that anchor needs to land. The "All communities" link itself
// (-> /communities, the full page) is kept here too, in this section's own
// header, for the same reason: /communities keeps working as a URL, and
// this is how someone finds their way to it from here.
//
// No "Your communities"/"Other communities" split any more — one grid,
// each card carrying its own badge (see CommunityCard's redesign).

import Link from "next/link";
import CommunityCard from "@/components/communities/CommunityCard";
import type { CommunitySummaryItem } from "@/lib/server/communities";

const GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6";

export default function CommunitiesResultsSection({ items }: { items: CommunitySummaryItem[] }) {
  if (items.length === 0) return null;

  return (
    <section id="communities" className="scroll-mt-24">
      <div className="flex items-center justify-between gap-3 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-8 bg-primary rounded-full" />
          <h2 className="font-headline-lg text-headline-lg text-on-background">Communities</h2>
        </div>
        <Link
          href="/communities"
          className="font-label-md text-label-md text-primary hover:underline underline-offset-4 shrink-0"
        >
          All communities
        </Link>
      </div>
      <div className={GRID}>
        {items.map((it) => (
          <CommunityCard
            key={it.community.id}
            community={it.community}
            member={it.member}
            role={it.role ?? undefined}
            pending={it.pending}
            memberCount={it.community.member_count ?? 0}
          />
        ))}
      </div>
    </section>
  );
}
