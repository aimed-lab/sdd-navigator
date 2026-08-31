import Link from "next/link";
import type { Community, CommunityRole } from "@/lib/server/communities";

// One card, two contexts: "yours" (no join affordance — you're already in,
// clicking the card is the action) and "other" (shows a Request-to-join
// state so the two sections read differently at a glance, per spec: "cards
// you are not in show 'Request to join'; ones you are in do not").
// Requesting itself happens on the community's own page (JoinLeaveControl),
// not from the card — this stays a plain link everywhere except the label.
export default function CommunityCard({
  community,
  member,
  role,
  pending,
}: {
  community: Community;
  /** True if the viewer is an active member (admin/lead/member) already. */
  member: boolean;
  /** The viewer's role when `member` is true — only ever read then.
   *  "Admin" vs "Member" here, matching the detail page's own badge
   *  (JoinLeaveControl); a lead reads as "Member" on the card the same way
   *  it does everywhere a lead is just an ordinary active member with
   *  posting rights, not membership-management rights. */
  role?: CommunityRole;
  /** True if the viewer has an outstanding request into this community. */
  pending: boolean;
}) {
  return (
    <Link
      href={`/communities/${community.slug}`}
      className="glass-card rounded-xl p-6 flex flex-col gap-3 hover:border-primary/40 transition-colors"
    >
      <h3 className="font-headline-sm text-headline-sm text-on-background">{community.name}</h3>
      {community.description && (
        <p className="font-body-sm text-body-sm text-secondary line-clamp-2">
          {community.description}
        </p>
      )}
      <div className="mt-auto pt-2">
        {member ? (
          <span className="inline-flex items-center gap-1.5 font-label-sm text-label-sm text-primary">
            <span className="material-symbols-outlined text-base">check_circle</span>
            {role === "admin" ? "Admin" : "Member"}
          </span>
        ) : pending ? (
          <span className="inline-flex items-center gap-1.5 font-label-sm text-label-sm text-secondary">
            <span className="material-symbols-outlined text-base">hourglass_empty</span>
            Request pending
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-label-sm text-label-sm text-primary">
            Request to join
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </span>
        )}
      </div>
    </Link>
  );
}
