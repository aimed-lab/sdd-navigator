import type { CommunityRole, MemberRosterEntry } from "@/lib/server/communities";
import FocusField from "./FocusField";

// The member-facing roster, grouped by role — a community exists so members
// can find each other, so an ACTIVE member sees a card per person (name,
// role, institution when they have one, and what they work on in this
// community — never an email; see listMemberRoster's own comment on why),
// not just a count. A non-member (or a signed-out visitor) sees no cards at
// all: the section's item count (member count) lives in the
// CollapsibleSection header wrapped around this
// (app/communities/[slug]/page.tsx), which IS public, same as before this
// feature existed — only the roster itself is member-only.
//
// FOCUS ("what they work on"): editable inline, but only on the viewer's
// OWN card (member.user_id === viewerUserId) — everyone else's shows as
// plain text. An admin can also set any member's focus, but that happens
// from the admin-only "Manage community" roster (MemberRoster.tsx), not
// here, same split as every other admin-vs-member-facing pair in this
// feature (listCommunityMembers vs listMemberRoster).
//
// No avatars, per spec — a plain name + role card, three per row on
// desktop, one on mobile.
//
// This is NOT the admin roster: emails, role dropdowns, and Remove stay
// exactly where they've always been — inside the admin-only "Manage
// community" card (components/communities/MemberRoster.tsx).
const ROLE_LABEL: Record<CommunityRole, string> = {
  admin: "Admin",
  lead: "Lead",
  member: "Member",
};

// Display order for the grouped headings — admins, then leads, then
// members, matching the spec exactly (and the roster's own "admins first"
// sort — see listMemberRoster). Each group internally keeps whatever order
// it already had in `roster` (alphabetical, per that same sort), since
// filtering by role preserves relative order.
const GROUP_ORDER: CommunityRole[] = ["admin", "lead", "member"];
const GROUP_LABEL: Record<CommunityRole, string> = {
  admin: "Admins",
  lead: "Leads",
  member: "Members",
};

function MemberCard({
  member,
  communityId,
  slug,
  viewerUserId,
}: {
  member: MemberRosterEntry;
  communityId: string;
  slug: string;
  viewerUserId: string | null;
}) {
  const isSelf = member.user_id === viewerUserId;
  return (
    <div className="rounded-xl bg-surface-container-low p-4">
      <p className="font-label-md text-label-md text-on-background truncate">
        {member.display_name}
      </p>
      <p className="mt-0.5 font-body-sm text-body-sm text-secondary truncate">
        {ROLE_LABEL[member.role]}
      </p>
      {member.institution && (
        <p className="mt-1 font-body-sm text-body-sm text-secondary/70 truncate">
          {member.institution}
        </p>
      )}
      {/* Fixed to two text-body-sm lines (20px each) whether or not a
          member has filled this in — a grid of cards must not go ragged
          depending on who's written a focus line and who hasn't. Matches
          CommunityCard's own line-clamp-2 treatment of `description`, but
          unlike that one, the height is reserved unconditionally rather
          than only when there's content to clamp. */}
      <div className="mt-1 min-h-[2.5rem]">
        {isSelf ? (
          <FocusField communityId={communityId} slug={slug} focus={member.focus} />
        ) : (
          member.focus && (
            <p className="font-body-sm text-body-sm text-secondary/70 line-clamp-2">
              {member.focus}
            </p>
          )
        )}
      </div>
    </div>
  );
}

export default function MembersSection({
  isMember,
  roster,
  communityId,
  slug,
  viewerUserId,
}: {
  isMember: boolean;
  roster: MemberRosterEntry[];
  communityId: string;
  slug: string;
  /** The signed-in viewer's own user id, or null when signed out — decides
   *  which card (if any) gets the inline focus editor. */
  viewerUserId: string | null;
}) {
  if (!isMember) {
    return (
      <p className="font-body-md text-body-md text-secondary">
        Join this community to see who&apos;s in it.
      </p>
    );
  }

  if (roster.length === 0) {
    return <p className="font-body-md text-body-md text-secondary">Nothing here yet.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {GROUP_ORDER.map((role) => {
        const group = roster.filter((m) => m.role === role);
        if (group.length === 0) return null;
        return (
          <div key={role}>
            <span className="block font-label-sm text-label-sm text-secondary/70 uppercase mb-2">
              {GROUP_LABEL[role]}
            </span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {group.map((m) => (
                <MemberCard
                  key={m.user_id}
                  member={m}
                  communityId={communityId}
                  slug={slug}
                  viewerUserId={viewerUserId}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
