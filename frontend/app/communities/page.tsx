// Communities list — /communities. Two sections per spec: the communities
// you're in, and other communities. Unlike /projects, this does NOT redirect
// a signed-out visitor — communities are publicly readable (same posture as
// /collaborate), only requesting to join needs a session, and that's
// enforced on the community's own page and by RLS, not by hiding this list.
//
// SERVER component. listMyMemberships() is one query for the whole page
// (not one getMembership() per card) — see its own comment.

import { getCurrentUser } from "@/lib/auth";
import { listCommunities, listMyMemberships } from "@/lib/server/communities";
import CommunityCard from "@/components/communities/CommunityCard";
import CreateCommunitySection from "@/components/communities/CreateCommunitySection";

export const dynamic = "force-dynamic"; // depends on the session

export const metadata = { title: "Communities · SmartDrugDiscovery" };

export default async function CommunitiesPage() {
  const [user, communities, memberships] = await Promise.all([
    getCurrentUser(),
    listCommunities(),
    listMyMemberships(),
  ]);

  const yours = communities.filter((c) => memberships[c.id]?.status === "active");
  const others = communities.filter((c) => memberships[c.id]?.status !== "active");

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-20 flex flex-col gap-12">
      <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 border-b border-outline-variant/30 pb-6">
        <h1 className="font-display-lg text-[40px] leading-tight text-on-background">
          Communities
        </h1>
        {user ? (
          <CreateCommunitySection />
        ) : (
          <a
            href="/login?callbackUrl=%2Fcommunities"
            className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            Sign in to create one
          </a>
        )}
      </section>

      {user && (
        <section className="flex flex-col gap-6">
          <h2 className="font-headline-md text-headline-md text-on-background">Your communities</h2>
          {yours.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
              {yours.map((c) => (
                <CommunityCard
                  key={c.id}
                  community={c}
                  member
                  role={memberships[c.id]?.role}
                  pending={false}
                />
              ))}
            </div>
          ) : (
            <p className="font-body-sm text-body-sm text-secondary">
              You're not in any communities yet — request to join one below, or create your own.
            </p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-6">
        <h2 className="font-headline-md text-headline-md text-on-background">Other communities</h2>
        {others.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
            {others.map((c) => (
              <CommunityCard
                key={c.id}
                community={c}
                member={false}
                pending={memberships[c.id]?.status === "pending"}
              />
            ))}
          </div>
        ) : (
          <p className="font-body-sm text-body-sm text-secondary">
            {communities.length === 0 ? "No communities yet." : "That's everyone — no other communities."}
          </p>
        )}
      </section>
    </div>
  );
}
