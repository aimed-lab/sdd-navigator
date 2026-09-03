import type { CommunityRole, MemberRosterEntry } from "@/lib/server/communities";

// The member-facing roster, grouped by role — a community exists so members
// can find each other, so an ACTIVE member sees a card per person (name,
// role, and institution when they have one — never an email; see
// listMemberRoster's own comment on why), not just a count. A non-member
// (or a signed-out visitor) sees no cards at all: the section's item count
// (member count) lives in the CollapsibleSection header wrapped around this
// (app/communities/[slug]/page.tsx), which IS public, same as before this
// feature existed — only the roster itself is member-only.
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

function MemberCard({ member }: { member: MemberRosterEntry }) {
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
    </div>
  );
}

export default function MembersSection({
  isMember,
  roster,
}: {
  isMember: boolean;
  roster: MemberRosterEntry[];
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
                <MemberCard key={m.user_id} member={m} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
