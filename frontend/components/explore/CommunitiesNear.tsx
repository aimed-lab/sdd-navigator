// "Communities near your work": three cards in the community card style (the
// viewer's own communities first, otherwise the largest), and a link to all.

import Link from "next/link";
import CommunityCard from "@/components/communities/CommunityCard";
import SectionHeading from "@/components/explore/SectionHeading";
import { pickCommunities } from "@/lib/server/explore/exploreLayout";
import type { CommunitySummaryItem } from "@/lib/server/communities";

export default function CommunitiesNear({ items }: { items: CommunitySummaryItem[] }) {
  const picked = pickCommunities(items, 3);
  if (picked.length === 0) return null;
  return (
    <section id="communities" aria-label="Communities near your work" className="scroll-mt-24">
      <div className="flex items-end justify-between gap-3 mb-4">
        <SectionHeading title="Communities near your work" className="" />
        <Link href="/communities" className="font-label-md text-label-md text-primary hover:underline underline-offset-4 shrink-0 pb-1">
          All communities →
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {picked.map(({ community, member, role, pending }) => (
          <CommunityCard
            key={community.id}
            community={community}
            member={member}
            role={role ?? undefined}
            pending={pending}
            memberCount={community.member_count ?? 0}
          />
        ))}
      </div>
    </section>
  );
}
