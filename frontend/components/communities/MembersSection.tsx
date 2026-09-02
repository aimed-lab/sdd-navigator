import type { MemberRosterEntry } from "@/lib/server/communities";

// The "members" section. A community exists so members can find each
// other, so an ACTIVE member sees who's actually in it — name (or email,
// only when there's no name) and role, admins first then alphabetical
// (`roster`, from listMemberRoster()/community_member_roster() — a
// SECURITY DEFINER RPC gated by membership in the database, not just this
// `isMember` check). A non-member (or a signed-out visitor) sees the
// activity counts only, same as before this feature existed.
//
// This is NOT the admin roster: emails, role dropdowns, and Remove stay
// exactly where they've always been — inside the admin-only "Manage
// community" card (components/communities/MemberRoster.tsx).
const ROLE_LABEL: Record<string, string> = { admin: "Admin", lead: "Lead" };

export default function MembersSection({
  memberCount,
  joinedLast7d,
  isMember,
  roster,
}: {
  memberCount: number;
  joinedLast7d: number;
  isMember: boolean;
  roster: MemberRosterEntry[];
}) {
  return (
    <section>
      <h2 className="font-headline-md text-headline-md text-on-background mb-2">Members</h2>
      <p className="font-body-md text-body-md text-secondary">
        {memberCount} {memberCount === 1 ? "member" : "members"}
        {joinedLast7d > 0 &&
          `, ${joinedLast7d} joined in the last 7 days`}
        .
      </p>

      {isMember && roster.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {roster.map((m) => (
            <li
              key={m.user_id}
              className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-low px-4 py-2.5"
            >
              <span className="font-body-md text-body-md text-on-background truncate">
                {m.display_name}
              </span>
              {ROLE_LABEL[m.role] && (
                <span className="shrink-0 font-label-sm text-label-sm text-secondary">
                  {ROLE_LABEL[m.role]}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
