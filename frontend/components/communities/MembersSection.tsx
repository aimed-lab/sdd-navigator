// The "members" section's real content — activity counts only (never
// emails, never a roster), pulled from getCommunityStats
// (lib/server/communities.ts), the same public SECURITY DEFINER RPC the
// header row's stats already used before this feature existed. The full
// member roster (with email) stays where it's always been — inside the
// admin-only "Manage community" card — this section is what a non-admin
// member (or a signed-out visitor, if enabled) gets instead: how alive the
// community is, not who's in it.
export default function MembersSection({
  memberCount,
  joinedLast7d,
}: {
  memberCount: number;
  joinedLast7d: number;
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
    </section>
  );
}
