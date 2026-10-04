// Communities in the Explore All view: serif heading and Community-tint tiles,
// sized to their content. Replaces the old CommunityCard grid here only (the
// shared CommunitiesResultsSection still serves the topic pages). A member
// count is shown only when it is 10 or more; below that nothing is shown.

import Link from "next/link";
import SectionHeading from "@/components/explore/SectionHeading";
import { TYPE_STYLES } from "@/lib/typeStyles";
import type { CommunitySummaryItem } from "@/lib/server/communities";

const MIN_MEMBERS_TO_SHOW = 10;

export default function CommunityTiles({ items }: { items: CommunitySummaryItem[] }) {
  if (items.length === 0) return null;
  const t = TYPE_STYLES.community;

  return (
    <section id="communities" className="scroll-mt-24">
      <div className="flex items-end justify-between gap-3 mb-6">
        <SectionHeading
          title="Communities"
          subtitle="Groups working on shared problems."
          className=""
        />
        <Link
          href="/communities"
          className="font-label-md text-label-md text-primary hover:underline underline-offset-4 shrink-0 pb-1"
        >
          All communities →
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
        {items.map(({ community, member, pending }) => {
          const count = community.member_count ?? 0;
          const status = member ? "Member" : pending ? "Request sent" : null;
          return (
            <Link
              key={community.id}
              href={`/communities/${community.slug}`}
              className="tile block p-5"
              style={{ background: t.bg }}
            >
              <p className="type-label" style={{ color: t.fg }}>
                {["Community", status].filter(Boolean).join(" · ")}
              </p>
              <h3 className="mt-3 font-title text-[20px] leading-tight font-medium text-on-background">
                {community.name}
              </h3>
              {community.description && (
                <p className="mt-1.5 text-[13px] leading-snug text-on-background/70 line-clamp-2">
                  {community.description}
                </p>
              )}
              {count >= MIN_MEMBERS_TO_SHOW && (
                <p className="mt-3 text-xs text-on-background/60">{count} members</p>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
