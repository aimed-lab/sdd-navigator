import Link from "next/link";
import type { Community, CommunityRole } from "@/lib/server/communities";
import { joinModeLabel } from "@/lib/server/communityHome/communityHome";

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
// category, /communities), in the same look as the community page: a green
// band with the name, then the one-line purpose, the member count and how
// people get in ("Open to join" / "Request to join"). The viewer's own
// relationship (Admin / Member / Pending) sits in the band. The whole card is
// a link to the community's page; joining itself happens there.
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
  const mode = joinModeLabel(community.is_open);

  return (
    <Link
      href={`/communities/${community.slug}`}
      className="group rounded-2xl overflow-hidden bg-surface-container-lowest border border-outline-variant/30 hover:border-primary/50 hover:shadow-sm transition-all flex flex-col"
    >
      <div className="bg-primary text-on-primary px-5 py-4 flex items-start justify-between gap-3">
        <h3 className="font-headline-sm text-headline-sm text-on-primary break-words min-w-0">{community.name}</h3>
        {badge && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-label-sm text-label-sm shrink-0 bg-white/90 text-primary">
            <span className="material-symbols-outlined text-sm">{badge.icon}</span>
            {badge.label}
          </span>
        )}
      </div>

      <div className="p-5 flex flex-col gap-3 flex-1">
        <p className="font-body-sm text-body-sm text-secondary line-clamp-1 min-h-[1.25rem]">
          {community.description ?? ""}
        </p>

        <div className="mt-auto flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 font-label-sm text-label-sm text-secondary">
            <span className="material-symbols-outlined text-base">group</span>
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </span>
          <span
            className={
              "px-2.5 py-1 rounded-full font-label-sm text-label-sm " +
              (member || community.is_open
                ? "bg-primary/10 text-primary"
                : "border border-outline-variant/50 text-secondary")
            }
          >
            {/* A member has already joined: "Request to join" / "Open to join"
                would be wrong, so the card just says Open. */}
            {member ? "Open" : mode}
          </span>
        </div>
      </div>
    </Link>
  );
}
