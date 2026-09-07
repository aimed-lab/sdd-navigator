import Link from "next/link";
import type { Community, CommunityRole } from "@/lib/server/communities";

/** Admin/Member/Pending, or nothing at all when the viewer has no
 *  relationship to this community yet — "nothing" is a real, intentional
 *  state here, not a missing case: a badge would otherwise be lying about
 *  a relationship that doesn't exist. A lead reads as "Member", same as
 *  the community's own detail page (JoinLeaveControl) — a lead is an
 *  ordinary active member with posting rights, not membership-management
 *  rights, so it isn't a distinct badge state. */
function membershipBadge(
  member: boolean,
  role: CommunityRole | undefined,
  pending: boolean
): { label: string; icon: string; className: string } | null {
  if (member) {
    return {
      label: role === "admin" ? "Admin" : "Member",
      icon: "check_circle",
      className: "bg-primary/10 text-primary",
    };
  }
  if (pending) {
    return { label: "Pending", icon: "hourglass_empty", className: "bg-surface-container-low text-secondary" };
  }
  return null;
}

// One card, everywhere a community is listed (Explore's Communities
// category, /communities) — no more separate "yours"/"others" rendering:
// the badge above says which, if either, applies. The join action
// (Request to join) stays ON the card, in its own slot below the member
// count, and only shows when there's actually something to request (not a
// member, not already pending) — requesting itself still happens on the
// community's own page (JoinLeaveControl), not from here; this stays a
// plain link everywhere except that one line.
export default function CommunityCard({
  community,
  member,
  role,
  pending,
  memberCount,
}: {
  community: Community;
  /** True if the viewer is an active member (admin/lead/member) already. */
  member: boolean;
  /** The viewer's role when `member` is true — only ever read then. */
  role?: CommunityRole;
  /** True if the viewer has an outstanding request into this community. */
  pending: boolean;
  /** Active member count — what actually tells a visitor whether this
   *  community has anyone in it yet, alongside the badge and purpose. */
  memberCount: number;
}) {
  const badge = membershipBadge(member, role, pending);

  return (
    <Link
      href={`/communities/${community.slug}`}
      className="relative glass-card rounded-xl p-6 flex flex-col gap-3 hover:border-primary/40 transition-colors"
    >
      {badge && (
        <span
          className={`absolute top-4 right-4 inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-label-sm text-label-sm shrink-0 ${badge.className}`}
        >
          <span className="material-symbols-outlined text-sm">{badge.icon}</span>
          {badge.label}
        </span>
      )}

      <h3 className="font-headline-sm text-headline-sm text-on-background pr-24">
        {community.name}
      </h3>

      {community.description && (
        <p className="font-body-sm text-body-sm text-secondary line-clamp-2">
          {community.description}
        </p>
      )}

      <div className="flex items-center gap-1.5 font-label-sm text-label-sm text-secondary">
        <span className="material-symbols-outlined text-base">group</span>
        {memberCount} {memberCount === 1 ? "member" : "members"}
      </div>

      {!member && !pending && (
        <div className="mt-auto pt-2">
          <span className="inline-flex items-center gap-1.5 font-label-sm text-label-sm text-primary">
            Request to join
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </span>
        </div>
      )}
    </Link>
  );
}
