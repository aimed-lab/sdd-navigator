// Community detail — /communities/[slug]. Purpose, request/leave, the
// project list, and — admin only — the pending-requests queue, add-by-email,
// and the member roster (roles + remove). Not a redirect for a signed-out
// visitor: communities are publicly readable, same as /communities itself.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  claimPendingCommunityMemberships,
  getCommunityBySlug,
  getCommunityFeedPreview,
  getCommunityStats,
  getMembership,
  listAnnouncements,
  listCommunityFeedItems,
  listCommunityMembers,
  listCommunityProjects,
  listCommunityResources,
  listMemberRoster,
  listPendingRequests,
} from "@/lib/server/communities";
import { listShowcaseByCommunity } from "@/lib/server/showcase";
import { resolveExploreSources, resolveSections, SECTION_LABEL } from "@/lib/communityTypes";
import { getCurrentUser } from "@/lib/auth";
import JoinLeaveControl from "@/components/communities/JoinLeaveControl";
import AddMemberByEmailForm from "@/components/communities/AddMemberByEmailForm";
import PendingRequestsPanel from "@/components/communities/PendingRequestsPanel";
import MemberRoster from "@/components/communities/MemberRoster";
import CommunityProjectsList from "@/components/communities/CommunityProjectsList";
import MembersSection from "@/components/communities/MembersSection";
import AnnouncementsSection from "@/components/communities/AnnouncementsSection";
import ResourcesSection from "@/components/communities/ResourcesSection";
import ExploreSection from "@/components/communities/ExploreSection";
import EmptySection from "@/components/communities/EmptySection";
import CollapsibleSection from "@/components/communities/CollapsibleSection";
import ShowcaseCard from "@/components/promote/ShowcaseCard";
import DeleteCommunityButton from "@/components/communities/DeleteCommunityButton";
import CopyLinkButton from "@/components/communities/CopyLinkButton";
import LeaveButton from "@/components/communities/LeaveButton";
import ManageCommunityCard from "@/components/communities/ManageCommunityCard";
import SectionsEditor from "@/components/communities/SectionsEditor";
import ExploreFeedEditor from "@/components/communities/ExploreFeedEditor";
import PublicPreviewEditor from "@/components/communities/PublicPreviewEditor";
import CommunityPublicPreview from "@/components/communities/CommunityPublicPreview";

export const dynamic = "force-dynamic"; // depends on the session

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const community = await getCommunityBySlug(slug);
  return { title: community ? `${community.name} · SmartDrugDiscovery` : "Community · SmartDrugDiscovery" };
}

export default async function CommunityDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const community = await getCommunityBySlug(slug);
  if (!community) notFound();

  // Claim any community_members row added by email before this account
  // existed or before it was ever linked — normally done by
  // listCommunities() (via the SAME RPC), but a direct link or a QR code
  // straight to this page never goes through that. Must finish before
  // getMembership() below reads this viewer's row, so it's awaited here,
  // not folded into the Promise.all — a race between the two would read
  // stale (still-unlinked) membership state.
  await claimPendingCommunityMemberships();

  const [user, membership, projects, stats] = await Promise.all([
    getCurrentUser(),
    getMembership(community.id),
    listCommunityProjects(community.id),
    getCommunityStats(community.id),
  ]);

  // NULL community.sections -> the full default order, every section
  // enabled (see resolveSections' own comment) — every community that
  // predates this feature renders exactly as it did before, unchanged.
  const orderedSections = resolveSections(community.sections);

  // Admin-only reads — listPendingRequests/listCommunityMembers already
  // degrade to [] for a non-admin caller (RLS), so this isn't the real
  // gate, just avoids firing them for a viewer who can't see anything back.
  const [pendingRequests, members] = membership.isAdmin
    ? await Promise.all([listPendingRequests(community.id), listCommunityMembers(community.id)])
    : [[], []];

  const isMember = membership.state === "active";

  // What a non-member sees before joining
  // (2026-09-18_community_public_preview.sql, extended by
  // 2026-09-20_community_public_roster.sql) — three levels now:
  //   'minimal'  — name and purpose only.
  //   'standard' — the above plus member/feed COUNTS and a 3-4 item feed
  //                PREVIEW (CommunityPublicPreview below).
  //   'open'     — the SAME Members and Explore sections a member sees,
  //                full roster (names/institution/focus, no Connect) and
  //                full feed (every item, but look-only — no click-
  //                through, no bookmark, no "Show all"). Replaces the
  //                'standard' preview card entirely, doesn't add to it.
  // Applies to ANY non-member — signed out or signed in — not just a
  // signed-out visitor; `isMember` alone (not session presence) is what
  // this branches on throughout the page.
  const openPreview = !isMember && community.public_preview === "open";
  const showPublicPreview = !isMember && community.public_preview === "standard";

  // Members AND Explore share one gate: an active member always sees
  // both; a non-member sees both together only under 'open', never one
  // without the other (there's no partial state in the spec this
  // implements). listMemberRoster/listCommunityFeedItems both now work
  // signed-out too (see their own comments) — RLS/the RPC's own WHERE
  // clause is what actually decides whether anything comes back for a
  // non-member, this flag just decides whether to bother asking.
  const canSeeMembersAndFeed = isMember || openPreview;

  // Member-facing roster (name + role, admins first) for the Members
  // section below. listMemberRoster degrades to [] for anyone the RPC
  // doesn't cover (not a member, and not an 'open' community) — fetched
  // only when it might show something, same "avoid firing it for a viewer
  // who can't see anything back" reasoning as the admin-only reads above.
  const memberRoster = canSeeMembersAndFeed ? await listMemberRoster(community.id) : [];

  // The Members section header's own count — deliberately NOT
  // stats.memberCount whenever the real roster is visible.
  // getCommunityStats() / community_member_stats() is a public,
  // signed-out-safe activity number (COUNT(*) WHERE status = 'active')
  // used all over the app — the /communities grid, the home page,
  // CommunityCard — and it has no idea `hidden` exists; it counts a
  // hidden staff row same as anyone else's. Whenever the roster itself is
  // visible (a member, or a non-member on an 'open' community), the
  // header above it has to match what's rendered below it, or it reads
  // as the exact bug this section fixes ("says twelve, renders eleven")
  // — so this is memberRoster.length (the SAME hidden-aware,
  // signed-up-included list MembersSection renders) whenever
  // canSeeMembersAndFeed, and only falls back to the public stat for a
  // non-member who can't see the roster at all, who never sees
  // roster.length in the first place (memberRoster is [] for them, not a
  // smaller true count).
  const membersSectionCount = canSeeMembersAndFeed ? memberRoster.length : stats.memberCount;

  // getCommunityFeedPreview goes through the SAME community_feed_items
  // table listCommunityFeedItems reads below, via RLS
  // ("Community feed items: public preview select") rather than a
  // service-role bypass — see that function's own comment. Only ever the
  // 'standard' case's capped 3-4 items; 'open' uses the full
  // listCommunityFeedItems read instead (below), same as a member gets.
  const feedPreview = showPublicPreview
    ? await getCommunityFeedPreview(community.id)
    : { count: 0, items: [] };

  // Announcements — same "only fetch when isMember" reasoning as
  // memberRoster above; a non-member's fetch would return [] anyway
  // (community_announcements' own is_community_member() SELECT policy),
  // this just avoids firing it for a viewer who can't see anything back.
  // Author names are resolved through the SAME roster fetched above
  // (community_member_roster), never a raw email — see AnnouncementsSection's
  // own comment on why.
  const announcements = isMember ? await listAnnouncements(community.id) : [];

  // Resources — same "only fetch when isMember" reasoning as announcements.
  // added_by isn't resolved to a name here right now: ResourcesSection
  // doesn't render "Added by" (see its own comment on why and when it
  // comes back), so there's nothing here that needs authorNames yet.
  const resources = isMember ? await listCommunityResources(community.id) : [];

  // The stored Explore feed — gated on canSeeMembersAndFeed, not isMember
  // alone, so an 'open' community's non-member also gets the full feed
  // (rendered non-interactively — see ExploreSection's own `interactive`
  // prop below). Rendered by its own Explore section (ExploreSection),
  // separate from Resources — see that component's own comment for why
  // the two split.
  const feedItems = canSeeMembersAndFeed ? await listCommunityFeedItems(community.id) : [];

  // Showcase — UNLIKE resources/announcements/the feed above, fetched
  // unconditionally, not only for an active member: this lists PUBLISHED
  // Promote articles (listShowcaseByCommunity's own .eq("published", true)),
  // which stay publicly readable regardless of community membership — see
  // database/migrations/2026-09-13_promote_showcase_community.sql. Gating
  // this fetch on isMember the way the others are would wrongly hide a
  // community's own published content from a signed-out visitor.
  const showcaseEntries = await listShowcaseByCommunity(community.id);

  const authorNames: Record<string, string> = Object.fromEntries(
    memberRoster.map((m) => [m.user_id, m.display_name])
  );

  // True only when the viewer IS an admin and the roster (fetched above,
  // admin-only) shows no OTHER active admin. Meaningless for any other
  // role — JoinLeaveControl only ever reads this when membership.role is
  // "admin". Computed here, not in the component, because `members` is
  // only ever fetched for an admin viewer in the first place.
  const isLastAdmin =
    membership.isAdmin && !members.some((m) => m.role === "admin" && m.user_id !== user?.id);

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-6 md:pt-8 pb-16 md:pb-20">
      {/* Way back to the community list — same breadcrumb pattern as
          Explore's own back-to-project link
          (app/explore/[topic]/page.tsx), and the project page's own
          back-to-community link above it. Its own div, outside the gap-12
          section stack below, so its spacing to the header is set directly
          (mb-4, matching the project page's own back-link wrapper) instead
          of inherited from that stack's gap. */}
      <div className="mb-4">
        {/* Communities is a category of Explore now, not its own nav
            destination (see components/explore/CommunitiesResultsSection.tsx) —
            this returns there rather than to /communities, which still
            works as a URL but is no longer where anyone arrives from. */}
        <Link
          href="/explore#communities"
          className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          All communities
        </Link>
      </div>

      <div className="flex flex-col gap-12">
        <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 border-b border-outline-variant/30 pb-6">
          <div>
            <h1 className="font-display-lg text-[40px] leading-tight text-on-background">
              {community.name}
            </h1>
            {community.description && (
              <p className="mt-2 font-body-md text-body-md text-secondary max-w-2xl">
                {community.description}
              </p>
            )}
          </div>
          <div className="flex flex-col items-start sm:items-end gap-3 shrink-0">
            <JoinLeaveControl
              communityId={community.id}
              communityName={community.name}
              slug={community.slug}
              isOpen={community.is_open}
              membership={membership}
            />
            {/* Any active member, not just admins — the point is members
                can bring people in themselves. */}
            {isMember && <CopyLinkButton slug={community.slug} />}
          </div>
        </section>

        {/* The pitch for a non-member on a 'standard' community — see
            CommunityPublicPreview's own comment on why this sits here
            (right under the header, before anyone has to click into a
            section) rather than as one more CollapsibleSection. Absent
            entirely, not an empty version of itself, when public_preview
            is 'minimal' (nothing to show), the viewer is already a member
            (who sees the real sections below instead), OR public_preview
            is 'open' — there, the real Members/Explore sections below
            replace this card outright rather than sitting alongside it. */}
        {showPublicPreview && (
          <CommunityPublicPreview memberCount={stats.memberCount} feedPreview={feedPreview} />
        )}

        {/* Enabled sections, in the configured order (default: every
            section, projects first — the same position it's always
            rendered in), each a card (CollapsibleSection — glass-panel,
            same disclosure idiom as ManageCommunityCard below, which is
            deliberately on a quieter surface than these). Projects starts
            open; everything else starts closed. Only "projects", "members",
            "announcements", "resources", and "explore" have real content
            today, per spec; the rest render a "nothing here yet"
            placeholder deliberately, not as something to hide — and have
            no count or action to show while collapsed, unlike those five.

            Resources (hand-curated) and Explore (Explore's generated
            findings) are deliberately TWO sections, not one — a community
            can enable either independently: curated tools with no feed, or
            a feed with nothing curated yet. See ResourcesSection.tsx's own
            comment for why they split.

            Announcements, Resources, and Explore each render themselves
            (own their own CollapsibleSection) rather than being wrapped
            here. Announcements/Resources need that because their header
            action ("New announcement" / "Add resource") and create/add
            form share one piece of client state (see their own comments);
            Explore has no add form at all — it renders itself only so its
            "no items yet" copy and per-kind grouping live next to the data
            they describe, not scattered into this switch. Projects doesn't
            need any of that: its action is a plain link, so the page
            (server) builds it and hands it straight to CollapsibleSection's
            `action` prop here.

            NON-MEMBER FILTER: a signed-out visitor (or any non-member) is
            member-gated OUT of every section here except "showcase" —
            projects, announcements, and resources all resolve to an empty
            fetch for them (their own RLS policies, not a check here), so
            rendering those headers just shows a collapsed disclosure with
            nothing behind it: something to click that goes nowhere,
            telling a visitor the community is emptier than it is.
            "showcase" is the one exception because its own read
            (listShowcaseByCommunity) is deliberately public regardless of
            membership — see that fetch's own comment above. "members" and
            "explore" join it too, but ONLY when canSeeMembersAndFeed
            ('open' — see that flag's own comment): those two DO have real
            content for such a non-member, unlike the others. The
            'standard' preview card above is what replaces everything this
            filter still removes at that level. */}
        {orderedSections
          .filter((s) => s.enabled)
          .filter(
            (s) =>
              isMember ||
              s.key === "showcase" ||
              (canSeeMembersAndFeed && (s.key === "members" || s.key === "explore"))
          )
          .map((s) => {
            switch (s.key) {
              case "projects":
                return (
                  <CollapsibleSection
                    key={s.key}
                    title={SECTION_LABEL[s.key]}
                    defaultOpen
                    action={
                      isMember ? (
                        <Link
                          href={`/projects/new?community=${community.id}`}
                          className="btn-outline px-4 py-2 rounded-lg font-label-sm text-label-sm flex items-center gap-1.5 shrink-0"
                        >
                          <span className="material-symbols-outlined text-[18px]">add</span>
                          New project
                        </Link>
                      ) : null
                    }
                  >
                    <CommunityProjectsList projects={projects} />
                  </CollapsibleSection>
                );
              case "members":
                // Reachable for a non-member again, but only when
                // canSeeMembersAndFeed (the sections filter above already
                // enforces that) — `canView` is what actually lets
                // MembersSection render real cards instead of "Join to
                // see"; `isMember` stays separate so a non-member on an
                // 'open' community still gets no Connect button and no
                // self-editing controls (see that component's own comment).
                return (
                  <CollapsibleSection
                    key={s.key}
                    title={SECTION_LABEL[s.key]}
                    count={membersSectionCount}
                  >
                    <MembersSection
                      canView={canSeeMembersAndFeed}
                      isMember={isMember}
                      roster={memberRoster}
                      communityId={community.id}
                      slug={slug}
                      viewerUserId={user?.id ?? null}
                    />
                  </CollapsibleSection>
                );
              case "announcements":
                return (
                  <AnnouncementsSection
                    key={s.key}
                    title={SECTION_LABEL[s.key]}
                    communityId={community.id}
                    slug={community.slug}
                    isAdmin={membership.isAdmin}
                    announcements={announcements}
                    authorNames={authorNames}
                  />
                );
              case "resources":
                return (
                  <ResourcesSection
                    key={s.key}
                    title={SECTION_LABEL[s.key]}
                    communityId={community.id}
                    slug={community.slug}
                    isAdmin={membership.isAdmin}
                    resources={resources}
                  />
                );
              case "explore":
                return (
                  <ExploreSection
                    key={s.key}
                    title={SECTION_LABEL[s.key]}
                    feedItems={feedItems}
                    // Only a real member gets the interactive view
                    // (click-through, bookmark, "Show all") — a non-member
                    // on an 'open' community sees the same items but
                    // strictly look-only, per spec.
                    interactive={isMember}
                  />
                );
              case "showcase":
                return (
                  <CollapsibleSection
                    key={s.key}
                    title={SECTION_LABEL[s.key]}
                    count={showcaseEntries.length}
                  >
                    {showcaseEntries.length === 0 ? (
                      <EmptySection />
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {showcaseEntries.map((e) => (
                          <ShowcaseCard key={e.id} entry={e} />
                        ))}
                      </div>
                    )}
                  </CollapsibleSection>
                );
              default:
                return (
                  <CollapsibleSection key={s.key} title={SECTION_LABEL[s.key]}>
                    <EmptySection />
                  </CollapsibleSection>
                );
            }
          })}

        {membership.isAdmin && (
          <ManageCommunityCard>
            <SectionsEditor
              communityId={community.id}
              slug={community.slug}
              sections={orderedSections}
            />

            <PublicPreviewEditor
              communityId={community.id}
              slug={community.slug}
              level={community.public_preview}
            />

            <ExploreFeedEditor
              communityId={community.id}
              slug={community.slug}
              sources={resolveExploreSources(community.explore_sources)}
              topics={community.explore_topics}
              refreshedAt={community.explore_refreshed_at}
              paperScope={community.explore_paper_scope}
              grantActivityCodes={community.explore_grant_activity_codes}
            />

            <div className="flex flex-col gap-3 border-t border-outline-variant/20 pt-8">
              <h3 className="font-label-lg text-label-lg text-on-background">Pending requests</h3>
              <PendingRequestsPanel requests={pendingRequests} slug={community.slug} />
            </div>

            <AddMemberByEmailForm communityId={community.id} slug={community.slug} />

            <div className="flex flex-col gap-3">
              <h3 className="font-label-lg text-label-lg text-on-background">
                Members ({members.length})
              </h3>
              <MemberRoster
                communityId={community.id}
                slug={community.slug}
                members={members}
                viewerUserId={user?.id ?? ""}
              />
            </div>

            {/* Below the member list, separated — Leave and Delete
                community are the two "leave this behind" actions,
                together on one line. Leave is here (not in the header
                corner) because that corner was stacking too many
                controls; it only ever moves here for an ADMIN — a
                non-admin member never sees this card at all (admin-only),
                so their own Leave stays up in the header
                (JoinLeaveControl). */}
            <div className="border-t border-outline-variant/20 pt-6 flex items-center gap-6">
              <LeaveButton
                communityId={community.id}
                communityName={community.name}
                slug={community.slug}
                isLastAdmin={isLastAdmin}
              />
              <DeleteCommunityButton
                communityId={community.id}
                communityName={community.name}
                memberCount={members.length}
                projectCount={projects.length}
              />
            </div>
          </ManageCommunityCard>
        )}
      </div>
    </div>
  );
}
