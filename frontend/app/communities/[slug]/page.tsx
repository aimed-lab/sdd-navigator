// Community detail — /communities/[slug]. A banner header (name, purpose, Join,
// Share, QR code), then:
//
//   A MEMBER sees tiles under the banner: Announcements, Events, Members
//   (Investigators on SPARC), Resources, Pinned (when something is pinned) and, for
//   admins, a dashed Manage tile. A tile opens its section on this page with
//   ?view=announcements|events|members|resources|manage (the old ?tab= links still
//   work: they map to the matching view). With no ?view: the pinned card, "Latest"
//   (announcements, upcoming events, recent joins) and "Upcoming" / people. Manage
//   holds everything the old collapsible Manage panel had.
//
//   A NON-MEMBER sees what they saw before (the tab bar and the public preview,
//   by the community's public_preview level):
//     'minimal'  — name and purpose.
//     'standard' — plus counts and a small feed preview (CommunityPublicPreview).
//     'open'     — also the roster, the Explore feed, and the pinned resource
//                  (and its files), look-only, with a "Join to get updates" prompt.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  claimPendingCommunityMemberships,
  getCommunityBySlug,
  getCommunityFeedPreview,
  getCommunityStats,
  getMembership,
  getPinnedResource,
  listAnnouncements,
  listCommunityFeedItems,
  listCommunityMembers,
  listCommunityProjects,
  listCommunityResources,
  getCommunityCreatedAt,
  listMemberLivingPages,
  listMyLivingPageTexts,
  listMemberRoster,
  listPendingRequests,
} from "@/lib/server/communities";
import { listCommunityEvents } from "@/lib/server/communityEvents";
import { listShowcaseByCommunity } from "@/lib/server/showcase";
import { buildSimilarity, hasFocus } from "@/lib/server/communityHome/similarMembers";
import { resolveExploreSources, resolveSections, SECTION_LABEL } from "@/lib/communityTypes";
import {
  buildUpdates,
  latestDate,
  membersWorkingOn,
  plural,
  resolveTab,
  viewerAccess,
  visibleTabs,
} from "@/lib/server/communityHome/communityHome";
import {
  buildLatest,
  memberTileLabel,
  newCount,
  nextEventLabel,
  resolveView,
  shortPinnedLabel,
  splitEvents,
  type CommunityView,
} from "@/lib/server/communityHome/tiles";
import { getCurrentUser } from "@/lib/auth";
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
import { PageShell } from "@/components/PageHeader";
import DeleteCommunityButton from "@/components/communities/DeleteCommunityButton";
import LeaveButton from "@/components/communities/LeaveButton";
import SectionsEditor from "@/components/communities/SectionsEditor";
import ExploreFeedEditor from "@/components/communities/ExploreFeedEditor";
import PublicPreviewEditor from "@/components/communities/PublicPreviewEditor";
import CommunityPublicPreview from "@/components/communities/CommunityPublicPreview";
import CommunityHeader from "@/components/communities/CommunityHeader";
import CommunityTabs from "@/components/communities/CommunityTabs";
import PinnedResourceCard from "@/components/communities/PinnedResourceCard";
import IsOpenEditor from "@/components/communities/IsOpenEditor";
import UpdatesList from "@/components/communities/UpdatesList";
import LivingPagesList from "@/components/communities/LivingPagesList";
import { DigestCard, MembersWorkingOnCard, UpcomingEventsCard } from "@/components/communities/HomeSideCards";
import CommunityTiles, { type TileSpec } from "@/components/communities/CommunityTiles";
import CommunityHome from "@/components/communities/CommunityHome";
import EventsSection from "@/components/communities/EventsSection";
import { IconArrowLeft } from "@/components/communities/CommunityIcons";

export const dynamic = "force-dynamic"; // depends on the session

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const community = await getCommunityBySlug(slug);
  return { title: community ? `${community.name} · SmartDrugDiscovery` : "Community · SmartDrugDiscovery" };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function CommunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; view?: string; new?: string; join?: string; editFocus?: string; sort?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const community = await getCommunityBySlug(slug);
  if (!community) notFound();
  // A team has its own page; an old or shared /communities link lands there.
  if (community.kind === "team") redirect(`/teams/${slug}`);

  // Claim any community_members row added by email before this account
  // existed (a direct link or a QR code straight to this page never goes
  // through listCommunities()). Awaited BEFORE getMembership() reads this
  // viewer's row, not folded into the Promise.all: a race would read stale,
  // still-unlinked membership state.
  await claimPendingCommunityMemberships();

  const [user, membership, stats] = await Promise.all([
    getCurrentUser(),
    getMembership(community.id),
    getCommunityStats(community.id),
  ]);

  const now = new Date();
  const orderedSections = resolveSections(community.sections);
  const isMember = membership.state === "active";
  const viewer = { isMember, publicPreview: community.public_preview };
  const access = viewerAccess(viewer);
  const sectionOn = (key: string) => orderedSections.some((s) => s.key === key && s.enabled);

  // Which sections this viewer can open. A member picks one with ?view= (or the old
  // ?tab=); a non-member keeps the tab bar.
  const available: CommunityView[] = [];
  if (isMember) {
    if (sectionOn("announcements")) available.push("announcements");
    if (sectionOn("events")) available.push("events");
    if (access.seesMembers && sectionOn("members")) available.push("members");
    if (access.seesResources && (sectionOn("resources") || sectionOn("explore"))) available.push("resources");
    if (access.seesMembers) available.push("pages");
    if (sectionOn("showcase")) available.push("showcase");
    if (membership.isAdmin) available.push("manage");
  }
  const view = isMember ? resolveView(query.view, query.tab, available) : null;

  const tabs = visibleTabs(orderedSections, viewer);
  const tab = resolveTab(query.tab, tabs); // non-members only

  // 'standard': the small preview card for a non-member. Replaced outright by
  // the real content under 'open'.
  const showPublicPreview = !isMember && community.public_preview === "standard";
  const feedPreview = showPublicPreview
    ? await getCommunityFeedPreview(community.id)
    : { count: 0, items: [] };

  // Admin-only reads (they degrade to [] for anyone else anyway).
  const [pendingRequests, members, projects] = await Promise.all([
    membership.isAdmin ? listPendingRequests(community.id) : Promise.resolve([]),
    membership.isAdmin ? listCommunityMembers(community.id) : Promise.resolve([]),
    isMember ? listCommunityProjects(community.id) : Promise.resolve([]),
  ]);

  // The roster, when this viewer may see it. Its length (not the public stat)
  // is the member count whenever the roster is visible, so the header matches
  // what the Members view lists (hidden staff rows are not in it).
  const memberRoster = access.seesMembers ? await listMemberRoster(community.id) : [];
  const memberCount = access.seesMembers ? memberRoster.length : stats.memberCount;
  const authorNames: Record<string, string> = Object.fromEntries(
    memberRoster.filter((m) => m.user_id).map((m) => [m.user_id as string, m.display_name])
  );

  // Wiki pages made by members while this community has existed (public ones, plus
  // team pages this viewer can read — the pages table's own RLS decides). Only where
  // the roster is visible.
  const livingPages = access.seesMembers
    ? await listMemberLivingPages(
        memberRoster.flatMap((m) => (m.user_id ? [m.user_id] : [])),
        await getCommunityCreatedAt(community.id)
      )
    : [];

  // Members working on similar things (the Members view), for an active member who
  // has set what they work on.
  const myRow = user ? memberRoster.find((m) => m.user_id === user.id) : undefined;
  const viewerHasFocus = isMember && hasFocus(myRow?.focus);
  const similarity =
    viewerHasFocus && view === "members"
      ? buildSimilarity({
          isMember,
          viewerUserId: user?.id ?? null,
          myFocus: myRow?.focus ?? null,
          myPageTexts: await listMyLivingPageTexts(),
          roster: memberRoster,
          pages: livingPages,
          max: 5,
        })
      : null;
  // "Closest to you" is the default order when it is available.
  const memberOrder: "closest" | "role" = similarity && query.sort !== "role" ? "closest" : "role";

  // The pinned resource, announcements and events, where this viewer may see them.
  const pinned = access.seesPinned ? await getPinnedResource(community.id) : null;
  const wantAnnouncements = isMember || (tab === "home" && access.seesUpdates);
  const wantFeed = access.seesUpdates && (isMember ? view === "resources" : tab === "home" || tab === "resources");
  const wantResources = access.seesResources && (isMember ? sectionOn("resources") : tab === "resources");
  const [announcements, events, feedItems, resources] = await Promise.all([
    wantAnnouncements ? listAnnouncements(community.id) : Promise.resolve([]),
    isMember && sectionOn("events") ? listCommunityEvents(community.id) : Promise.resolve([]),
    wantFeed ? listCommunityFeedItems(community.id) : Promise.resolve([]),
    wantResources ? listCommunityResources(community.id) : Promise.resolve([]),
  ]);
  // Showcase entries: for its view, and for a member's home (to know whether to link it).
  const showcaseEntries =
    (isMember ? view === "showcase" || (!view && sectionOn("showcase")) : tab === "showcase")
      ? await listShowcaseByCommunity(community.id)
      : [];

  const updates = !isMember && tab === "home" && access.seesUpdates ? buildUpdates(announcements, feedItems) : [];
  const updatedAt = latestDate([
    community.explore_refreshed_at,
    announcements[0]?.created_at,
    pinned?.updated_at,
    ...livingPages.map((p) => p.last_refreshed_at ?? p.updated_at),
  ]);

  const isLastAdmin =
    membership.isAdmin && !members.some((m) => m.role === "admin" && m.user_id !== user?.id);

  const base = `/communities/${slug}`;
  const hrefFor = (t: string) => (isMember ? `${base}?view=${t}` : `${base}?tab=${t}`);
  // Where "Join to get updates" goes: sign in (back to the join prompt) when
  // signed out, else straight to the join prompt.
  const joinHref =
    membership.state === "signed_out"
      ? `/login?callbackUrl=${encodeURIComponent(`${base}?join=1`)}`
      : `${base}?join=1`;
  // A signed-out visitor of an OPEN community gets the email form (opened by
  // ?join=1) in the header instead of this notice.
  const emailJoinOffered = membership.state === "signed_out" && community.is_open;
  const showJoinNotice =
    query.join === "1" && !isMember && membership.state !== "pending" && !emailJoinOffered;

  // ── the member's tiles and home ─────────────────────────────────────────────
  const pinnedHref = pinned ? (pinned.files[0]?.url ?? pinned.url) : null;
  const tiles: TileSpec[] = [];
  if (isMember) {
    if (available.includes("announcements")) {
      const fresh = newCount(announcements, now);
      tiles.push({
        key: "announcements",
        label: "Announcements",
        short: "News",
        small: plural(announcements.length, "post"),
        badge: fresh > 0 ? `${fresh} new` : null,
        href: hrefFor("announcements"),
      });
    }
    if (available.includes("events")) {
      tiles.push({ key: "events", label: "Events", small: nextEventLabel(events, now), href: hrefFor("events") });
    }
    if (available.includes("members")) {
      tiles.push({
        key: "members",
        label: memberTileLabel(slug),
        short: "People",
        small: plural(memberCount, "member"),
        href: hrefFor("members"),
      });
    }
    if (available.includes("resources")) {
      tiles.push({ key: "resources", label: "Resources", small: plural(resources.length, "resource"), href: hrefFor("resources") });
    }
    if (pinned && pinnedHref) {
      tiles.push({ key: "pinned", label: shortPinnedLabel(pinned.title), small: "Open ↗", href: pinnedHref, external: true });
    }
    if (membership.isAdmin) {
      tiles.push({
        key: "manage",
        label: "Manage",
        small: pendingRequests.length > 0 ? plural(pendingRequests.length, "request") : "Admins",
        badge: pendingRequests.length > 0 ? String(pendingRequests.length) : null,
        href: hrefFor("manage"),
        dashed: true,
      });
    }
  }

  const upcomingEvents = splitEvents(events, now).upcoming;
  const showPagesLink = available.includes("pages") && livingPages.length > 0;
  const showShowcaseLink = available.includes("showcase") && sectionOn("showcase") && showcaseEntries.length > 0;
  // "X joined" lines: only an admin can read join dates (the roster has none).
  const joins = membership.isAdmin
    ? members
        .filter((m) => !m.hidden && m.user_id !== user?.id)
        .map((m) => ({
          id: m.id,
          name: (m.user_id && authorNames[m.user_id]) || m.display_name || (m.email ?? "A new member").split("@")[0],
          at: m.approved_at ?? m.joined_at ?? "",
        }))
        .filter((j) => j.at && now.getTime() - Date.parse(j.at) <= 30 * DAY_MS)
    : [];
  const latest = buildLatest(
    {
      announcements: announcements.map((a) => ({ id: a.id, title: a.title, created_at: a.created_at, author: authorNames[a.author_id] ?? null })),
      events: events.map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at, created_at: e.created_at })),
      joins,
    },
    now,
    6
  );
  const people = memberRoster.slice(0, 5).map((m) => ({ id: m.member_id, name: m.display_name, sub: m.institution ?? m.focus ?? null }));

  return (
    <PageShell>
      <div className="mb-4">
        {/* Communities is a category of Explore now, not its own nav
            destination — this returns there. */}
        <Link
          href="/explore#communities"
          className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          All communities
        </Link>
      </div>

      <div className="flex flex-col gap-6">
        <CommunityHeader
          community={community}
          membership={membership}
          memberNames={memberRoster.map((m) => m.display_name)}
          memberCount={memberCount}
          pageCount={access.seesMembers ? livingPages.length : null}
          updatedAt={updatedAt}
          autoOpenJoin={query.join === "1"}
        />

        {showJoinNotice && (
          <p className="rounded-xl bg-surface-container-low text-primary px-4 py-3 font-body-md text-body-md">
            You opened a join link.{" "}
            {membership.state === "signed_out"
              ? "Sign in to join this community."
              : community.is_open
                ? "Use the Join button above to join."
                : "Use the button above to send a request to join."}
          </p>
        )}

        {/* ═══ A MEMBER: tiles and the section they opened ═══════════════ */}
        {isMember && (
          <>
            <CommunityTiles slug={slug} view={view} tiles={tiles} />

            {view && (
              <div>
                <Link
                  href={base}
                  scroll={false}
                  className="inline-flex items-center gap-1 font-label-md text-label-md text-primary hover:underline underline-offset-4"
                >
                  <IconArrowLeft /> Community home
                </Link>
              </div>
            )}

            {!view && (
              <>
                {pinned && <PinnedResourceCard resource={pinned} trackCommunityId={community.id} />}
                <CommunityHome
                  slug={slug}
                  latest={latest}
                  isAdmin={membership.isAdmin}
                  upcoming={upcomingEvents}
                  people={people}
                  showEvents={available.includes("events")}
                  showMembers={available.includes("members")}
                  membersLabel={memberTileLabel(slug)}
                />
                {sectionOn("projects") && (
                  <CollapsibleSection
                    title={SECTION_LABEL.projects}
                    defaultOpen
                    action={
                      <Link
                        href={`/projects/new?community=${community.id}`}
                        className="btn-outline px-4 py-2 rounded-lg font-label-sm text-label-sm flex items-center gap-1.5 shrink-0"
                      >
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        New project
                      </Link>
                    }
                  >
                    <CommunityProjectsList projects={projects} />
                  </CollapsibleSection>
                )}
                {/* Only a section that is turned on and has something in it gets a link. */}
                {(showPagesLink || showShowcaseLink) && (
                  <p className="font-body-md text-body-md text-secondary text-center">
                    {showPagesLink && (
                      <Link href={hrefFor("pages")} className="text-primary hover:underline underline-offset-4">
                        Wiki pages
                      </Link>
                    )}
                    {showPagesLink && showShowcaseLink && " · "}
                    {showShowcaseLink && (
                      <Link href={hrefFor("showcase")} className="text-primary hover:underline underline-offset-4">
                        Showcase
                      </Link>
                    )}
                  </p>
                )}
              </>
            )}

            {view === "announcements" && (
              <AnnouncementsSection
                title={SECTION_LABEL.announcements}
                communityId={community.id}
                slug={community.slug}
                defaultOpen
                isAdmin={membership.isAdmin}
                announcements={announcements}
                authorNames={authorNames}
                startCreating={query.new === "1"}
              />
            )}

            {view === "events" && (
              <section className="flex flex-col gap-3">
                <div>
                  <h2 className="font-title text-[22px] leading-8 text-on-background">Events</h2>
                  <p className="font-body-md text-body-md text-secondary">Talks, meetups and deadlines for this community.</p>
                </div>
                <EventsSection
                  communityId={community.id}
                  slug={community.slug}
                  isAdmin={membership.isAdmin}
                  events={events}
                  now={now.toISOString()}
                />
              </section>
            )}

            {view === "members" && (
              <div className="flex flex-col gap-6">
                <CollapsibleSection title={SECTION_LABEL.members} count={memberCount} defaultOpen>
                  <MembersSection
                    canView={access.seesMembers}
                    isMember={isMember}
                    roster={memberRoster}
                    communityId={community.id}
                    slug={slug}
                    viewerUserId={user?.id ?? null}
                    editFocusOnLoad={query.editFocus === "1"}
                    similar={similarity ? similarity.all : null}
                    order={memberOrder}
                    orderHrefs={{ closest: `${hrefFor("members")}&sort=closest`, role: `${hrefFor("members")}&sort=role` }}
                  />
                </CollapsibleSection>
                {sectionOn("who_can_help") && (
                  <CollapsibleSection title={SECTION_LABEL.who_can_help}>
                    <EmptySection />
                  </CollapsibleSection>
                )}
              </div>
            )}

            {view === "resources" && (
              <div className="flex flex-col gap-6">
                {sectionOn("resources") && (
                  <ResourcesSection
                    title={SECTION_LABEL.resources}
                    communityId={community.id}
                    slug={community.slug}
                    defaultOpen
                    isAdmin={membership.isAdmin}
                    resources={resources}
                    pinnedId={pinned?.id ?? null}
                  />
                )}
                {sectionOn("explore") && <ExploreSection title={SECTION_LABEL.explore} feedItems={feedItems} interactive />}
              </div>
            )}

            {view === "pages" && <LivingPagesList pages={livingPages} />}

            {view === "showcase" && (
              <CollapsibleSection title={SECTION_LABEL.showcase} count={showcaseEntries.length} defaultOpen>
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
            )}

            {/* Everything the old collapsible Manage panel had, for admins. */}
            {view === "manage" && membership.isAdmin && (
              <section className="rounded-2xl border border-[#e8e4da] bg-white p-5 md:p-6 flex flex-col gap-10">
                <h2 className="font-title text-[22px] leading-8 text-on-background">Manage community</h2>

                <SectionsEditor communityId={community.id} slug={community.slug} sections={orderedSections} />

                <IsOpenEditor communityId={community.id} slug={community.slug} isOpen={community.is_open} />

                <PublicPreviewEditor communityId={community.id} slug={community.slug} level={community.public_preview} />

                {sectionOn("explore") && (
                  <ExploreFeedEditor
                    communityId={community.id}
                    slug={community.slug}
                    sources={resolveExploreSources(community.explore_sources)}
                    topics={community.explore_topics}
                    refreshedAt={community.explore_refreshed_at}
                    paperScope={community.explore_paper_scope}
                    grantActivityCodes={community.explore_grant_activity_codes}
                  />
                )}

                <div className="flex flex-col gap-3 border-t border-outline-variant/20 pt-8">
                  <h3 className="font-label-lg text-label-lg text-on-background">Pending requests</h3>
                  <PendingRequestsPanel requests={pendingRequests} slug={community.slug} />
                </div>

                <AddMemberByEmailForm communityId={community.id} slug={community.slug} />

                <div className="flex flex-col gap-3">
                  <h3 className="font-label-lg text-label-lg text-on-background">Members ({members.length})</h3>
                  <MemberRoster
                    communityId={community.id}
                    slug={community.slug}
                    members={members}
                    viewerUserId={user?.id ?? ""}
                  />
                </div>

                {/* Leave and Delete community, together below the member list. A
                    non-admin's own Leave stays in the header (JoinLeaveControl). */}
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
              </section>
            )}
          </>
        )}

        {/* ═══ A NON-MEMBER: what they saw before ═══════════════════════ */}
        {!isMember && (
          <>
            <CommunityTabs slug={slug} tabs={tabs} active={tab} />

            {tab === "home" && (
              <h2 className="font-headline-sm text-headline-sm text-on-background">What&apos;s happening in {community.name}</h2>
            )}

            {tab === "home" && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 flex flex-col gap-6 min-w-0">
                  {showPublicPreview && <CommunityPublicPreview memberCount={stats.memberCount} feedPreview={feedPreview} />}
                  {pinned && <PinnedResourceCard resource={pinned} />}
                  {access.seesUpdates ? (
                    <UpdatesList updates={updates} linked={false} showJoinPrompt={access.joinPrompt} joinHref={joinHref} />
                  ) : (
                    !showPublicPreview && (
                      <section className="rounded-2xl glass-panel p-5 flex flex-col gap-2">
                        <h2 className="font-headline-sm text-headline-sm text-on-background">Updates</h2>
                        <p className="font-body-md text-body-md text-secondary">
                          Join to get this community&apos;s announcements and new findings.
                        </p>
                      </section>
                    )
                  )}
                </div>

                <aside className="flex flex-col gap-6 min-w-0">
                  {sectionOn("events") && <UpcomingEventsCard />}
                  {access.seesMembers && (
                    <MembersWorkingOnCard
                      rows={membersWorkingOn(memberRoster)}
                      membersHref={tabs.includes("members") ? hrefFor("members") : null}
                      similar={null}
                      focusHref={null}
                    />
                  )}
                  <DigestCard />
                </aside>
              </div>
            )}

            {tab === "resources" && (
              <div className="flex flex-col gap-6">
                {sectionOn("resources") && (
                  <ResourcesSection
                    title={SECTION_LABEL.resources}
                    communityId={community.id}
                    slug={community.slug}
                    defaultOpen
                    isAdmin={false}
                    resources={resources}
                    pinnedId={pinned?.id ?? null}
                  />
                )}
                {sectionOn("explore") && <ExploreSection title={SECTION_LABEL.explore} feedItems={feedItems} interactive={false} />}
                {access.joinPrompt && (
                  <p className="font-body-md text-body-md text-secondary">
                    <Link href={joinHref} className="text-primary hover:underline underline-offset-4">
                      Join to get updates
                    </Link>{" "}
                    and open the community&apos;s shared files.
                  </p>
                )}
              </div>
            )}

            {tab === "pages" && <LivingPagesList pages={livingPages} />}

            {tab === "events" && (
              <div className="rounded-2xl glass-panel p-6">
                <h2 className="font-headline-sm text-headline-sm text-on-background mb-1">Events</h2>
                <p className="font-body-md text-body-md text-secondary">
                  No events yet. Talks and meetups will be listed here.
                </p>
              </div>
            )}

            {tab === "members" && (
              <div className="flex flex-col gap-6">
                <CollapsibleSection title={SECTION_LABEL.members} count={memberCount} defaultOpen>
                  <MembersSection
                    canView={access.seesMembers}
                    isMember={false}
                    roster={memberRoster}
                    communityId={community.id}
                    slug={slug}
                    viewerUserId={user?.id ?? null}
                    editFocusOnLoad={false}
                    similar={null}
                    order="role"
                    orderHrefs={{ closest: `${hrefFor("members")}&sort=closest`, role: `${hrefFor("members")}&sort=role` }}
                  />
                </CollapsibleSection>
              </div>
            )}

            {tab === "showcase" && (
              <CollapsibleSection title={SECTION_LABEL.showcase} count={showcaseEntries.length} defaultOpen>
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
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
