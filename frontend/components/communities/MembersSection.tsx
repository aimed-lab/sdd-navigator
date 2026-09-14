import type { CommunityRole, MemberRosterEntry } from "@/lib/server/communities";
import ConnectButton from "./ConnectButton";
import FocusField from "./FocusField";
import HiddenToggle from "./HiddenToggle";

// The member-facing roster, grouped by role — a community exists so members
// can find each other, so an ACTIVE member sees a card per person (name,
// role, institution when they have one, and what they work on in this
// community — never an email; see listMemberRoster's own comment on why),
// not just a count.
//
// `canView` vs `isMember` — TWO DIFFERENT QUESTIONS. `canView` decides
// whether the roster renders AT ALL: true for an active member, and ALSO
// true for a non-member when the community's public_preview is 'open'
// (2026-09-20_community_public_roster.sql) — an open community's roster is
// deliberately readable by anyone with the link, the entire point of that
// setting. `isMember` stays narrower and gates the two things that must
// stay member-only regardless of `canView`: the Connect button (revealing
// an email should require membership, not just roster visibility) and the
// self-editing controls (FocusField/HiddenToggle — a non-member obviously
// isn't a row in this roster to begin with, but the gate is explicit
// below rather than relying on that coincidence).
//
// FOCUS ("what they work on"): editable inline, but only on the viewer's
// OWN card (member.user_id === viewerUserId) — everyone else's shows as
// plain text. An admin can also set any member's focus, but that happens
// from the admin-only "Manage community" roster (MemberRoster.tsx), not
// here, same split as every other admin-vs-member-facing pair in this
// feature (listCommunityMembers vs listMemberRoster).
//
// NOT SIGNED UP YET: an imported roster (added by email, before anyone's
// signed in) shows up here too now — listMemberRoster's own comment on why
// — marked with the same wording the admin panel already uses
// ("invited — not signed up yet") rather than rendered as an ordinary
// member or silently dropped. `member.user_id` is null for these rows, so
// they can never be `isSelf` and never get the focus editor — there's no
// session to own that update yet.
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
  isMember,
}: {
  member: MemberRosterEntry;
  communityId: string;
  slug: string;
  viewerUserId: string | null;
  /** True only for an ACTIVE member of this community — gates Connect and
   *  the self-editing controls, independent of whether the roster itself
   *  is visible (see this file's own top comment on `canView` vs
   *  `isMember`). */
  isMember: boolean;
}) {
  // `isMember &&` is belt-and-suspenders, not load-bearing on its own: a
  // non-member viewer's user_id can never actually match a row in this
  // roster (they aren't a member), but being explicit here means that
  // stays true even if this component is ever reused somewhere that
  // invariant doesn't hold.
  const isSelf = isMember && member.user_id === viewerUserId;
  return (
    <div className="rounded-xl bg-surface-container-low p-4">
      <p className="font-label-md text-label-md text-on-background truncate">
        {member.display_name}
      </p>
      <p className="mt-0.5 font-body-sm text-body-sm text-secondary truncate">
        {ROLE_LABEL[member.role]}
        {!member.signed_up && (
          <span className="italic text-secondary/70"> · invited — not signed up yet</span>
        )}
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
      {isSelf ? (
        <>
          {member.hidden && (
            <p className="mt-1.5 font-body-sm text-body-sm text-secondary/70 italic">
              Only visible to you — hidden from everyone else in this roster.
            </p>
          )}
          <HiddenToggle communityId={communityId} slug={slug} hidden={member.hidden} />
        </>
      ) : (
        // Connect reveals this member's email only once clicked — see
        // ConnectButton's own comment on why that's a separate on-demand
        // read rather than something already in `member`. Gated on
        // `isMember`, not just "not self": a non-member viewer (an open
        // community's roster is visible to them, but they aren't a row in
        // it — see this file's own comment on `canView` vs `isMember`)
        // gets no Connect button at all — revealing an email requires
        // actually being a member, not just being able to see the roster.
        isMember && <ConnectButton communityId={communityId} memberId={member.member_id} />
      )}
    </div>
  );
}

export default function MembersSection({
  canView,
  isMember,
  roster,
  communityId,
  slug,
  viewerUserId,
}: {
  /** Whether the roster renders at all — true for an active member, and
   *  ALSO true for a non-member when this community's public_preview is
   *  'open'. See this file's own top comment on why this is a separate
   *  question from `isMember`. */
  canView: boolean;
  isMember: boolean;
  roster: MemberRosterEntry[];
  communityId: string;
  slug: string;
  /** The signed-in viewer's own user id, or null when signed out — decides
   *  which card (if any) gets the inline focus editor. */
  viewerUserId: string | null;
}) {
  if (!canView) {
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
                  key={m.member_id}
                  member={m}
                  communityId={communityId}
                  slug={slug}
                  viewerUserId={viewerUserId}
                  isMember={isMember}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
