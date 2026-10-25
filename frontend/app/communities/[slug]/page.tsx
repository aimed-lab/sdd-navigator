// Community detail — /communities/[slug]. A banner header (name, purpose, Join,
// Share, QR code) over a tab bar: Home, Resources, Wiki pages, Events,
// Members, Showcase. Tabs follow the community's configured sections
// (lib/server/communityHome: visibleTabs); the tab is `?tab=`.
//
// Not a redirect for a signed-out visitor: communities are publicly readable.
// What a non-member sees is the community's public_preview level:
//   'minimal'  — name and purpose.
//   'standard' — plus counts and a small feed preview (CommunityPublicPreview).
//   'open'     — also the roster, the Explore feed, and the pinned resource
//                (and its files, once the pinned-resource migration is
//                applied), look-only, with a "Join to get updates" prompt.
// Admins also get the Manage community card (sections, preview level, feed
// config, requests, add-by-email, roster, leave / delete) at the foot of Home.

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
  listMemberLivingPages,
  listMyLivingPageTexts,
  listMemberRoster,
  listPendingRequests,
} from "@/lib/server/communities";
import { listShowcaseByCommunity } from "@/lib/server/showcase";
import { getMyOnboarding } from "@/lib/server/communityJoin";
import { buildSimilarity, hasFocus } from "@/lib/server/communityHome/similarMembers";
import { buildChecklist, showChecklist } from "@/lib/server/communityHome/checklist";
import { resolveExploreSources, resolveSections, SECTION_LABEL } from "@/lib/communityTypes";
import {
  buildUpdates,
  latestDate,
  membersWorkingOn,
  resolveTab,
  viewerAccess,
  visibleTabs,
} from "@/lib/server/communityHome/communityHome";
import { getCurrentUser } from "@/lib/auth";
import { listLinkedTeams } from "@/lib/server/teams/teams";
import { plural } from "@/lib/server/teams/teamRules";
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
import ManageCommunityCard from "@/components/communities/ManageCommunityCard";
import SectionsEditor from "@/components/communities/SectionsEditor";
import ExploreFeedEditor from "@/components/communities/ExploreFeedEditor";
import PublicPreviewEditor from "@/components/communities/PublicPreviewEditor";
import CommunityPublicPreview from "@/components/communities/CommunityPublicPreview";
import CommunityHeader from "@/components/communities/CommunityHeader";
import CommunityTabs from "@/components/communities/CommunityTabs";
import PinnedResourceCard from "@/components/communities/PinnedResourceCard";
import WelcomeChecklist from "@/components/communities/WelcomeChecklist";
import IsOpenEditor from "@/components/communities/IsOpenEditor";
import UpdatesList from "@/components/communities/UpdatesList";
import LivingPagesList from "@/components/communities/LivingPagesList";
import { DigestCard, MembersWorkingOnCard, UpcomingEventsCard } from "@/components/communities/HomeSideCards";

export const dynamic = "force-dynamic"; // depends on the session

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const community = await getCommunityBySlug(slug);
  return { title: community ? `${community.name} · SmartDrugDiscovery` : "Community · SmartDrugDiscovery" };
}

export default async function CommunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; join?: string; editFocus?: string; sort?: string }>;
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

  const orderedSections = resolveSections(community.sections);
  const isMember = membership.state === "active";
  const viewer = { isMember, publicPreview: community.public_preview };
  const access = viewerAccess(viewer);

  const tabs = visibleTabs(orderedSections, viewer);
  const tab = resolveTab(query.tab, tabs);
  const sectionOn = (key: string) => orderedSections.some((s) => s.key === key && s.enabled);

  // 'standard': the small preview card for a non-member. Replaced outright by
  // the real content under 'open'.
  const showPublicPreview = !isMember && community.public_preview === "standard";
  const feedPreview = showPublicPreview
    ? await getCommunityFeedPreview(community.id)
    : { count: 0, items: [] };

  // Admin-only reads (they degrade to [] for anyone else anyway).
  const [pendingRequests, members, projects, linkedTeams] = await Promise.all([
    membership.isAdmin ? listPendingRequests(community.id) : Promise.resolve([]),
    membership.isAdmin ? listCommunityMembers(community.id) : Promise.resolve([]),
    isMember ? listCommunityProjects(community.id) : Promise.resolve([]),
    // Teams linked to this community: name and size only, for members.
    isMember && tab === "home" ? listLinkedTeams(community.id) : Promise.resolve([]),
  ]);

  // The roster, when this viewer may see it. Its length (not the public stat)
  // is the member count whenever the roster is visible, so the header matches
  // what the Members tab lists (hidden staff rows are not in it).
  const memberRoster = access.seesMembers ? await listMemberRoster(community.id) : [];
  const memberCount = access.seesMembers ? memberRoster.length : stats.memberCount;
  const authorNames: Record<string, string> = Object.fromEntries(
    memberRoster.filter((m) => m.user_id).map((m) => [m.user_id as string, m.display_name])
  );

  // Wiki pages made by members (public ones, plus team pages this viewer can
  // read — the pages table's own RLS decides). Only where the roster is visible.
  const livingPages = access.seesMembers
    ? await listMemberLivingPages(memberRoster.flatMap((m) => (m.user_id ? [m.user_id] : [])))
    : [];

  // Members working on similar things: only for an active member who has set
  // what they work on. Uses the roster and pages this viewer may already read,
  // plus their own pages. Everyone else sees today's view.
  const myRow = user ? memberRoster.find((m) => m.user_id === user.id) : undefined;
  const viewerHasFocus = isMember && hasFocus(myRow?.focus);
  const similarity =
    viewerHasFocus && (tab === "home" || tab === "members")
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

  // The pinned resource and the updates stream, where this viewer may see them.
  const pinned = access.seesPinned ? await getPinnedResource(community.id) : null;
  const needUpdates = tab === "home" && access.seesUpdates;
  const [announcements, feedItems] = await Promise.all([
    tab === "home" && access.seesUpdates ? listAnnouncements(community.id) : Promise.resolve([]),
    access.seesUpdates && (tab === "home" || tab === "resources") ? listCommunityFeedItems(community.id) : Promise.resolve([]),
  ]);
  const resources = tab === "resources" && access.seesResources ? await listCommunityResources(community.id) : [];
  const showcaseEntries = tab === "showcase" ? await listShowcaseByCommunity(community.id) : [];

  const updates = needUpdates ? buildUpdates(announcements, feedItems) : [];
  const updatedAt = latestDate([
    community.explore_refreshed_at,
    announcements[0]?.created_at,
    pinned?.updated_at,
    ...livingPages.map((p) => p.last_refreshed_at ?? p.updated_at),
  ]);

  const isLastAdmin =
    membership.isAdmin && !members.some((m) => m.role === "admin" && m.user_id !== user?.id);

  const hrefFor = (t: string) => `/communities/${slug}?tab=${t}`;
  // Where "Join to get updates" goes: sign in (back to the join prompt) when
  // signed out, else straight to the join prompt.
  const joinHref =
    membership.state === "signed_out"
      ? `/login?callbackUrl=${encodeURIComponent(`/communities/${slug}?join=1`)}`
      : `/communities/${slug}?join=1`;
  // A signed-out visitor of an OPEN community gets the email form (opened by
  // ?join=1) in the header instead of this notice.
  const emailJoinOffered = membership.state === "signed_out" && community.is_open;
  const showJoinNotice =
    query.join === "1" && !isMember && membership.state !== "pending" && !emailJoinOffered;

  // Welcome checklist: members in their first 14 days, until dismissed.
  const onboarding = isMember && tab === "home" ? await getMyOnboarding(community.id) : null;
  const checklist =
    onboarding &&
    showChecklist({ isMember, joinedAt: onboarding.joinedAt, dismissed: onboarding.dismissed })
      ? buildChecklist({
          slug,
          focus: onboarding.focus,
          progress: onboarding.progress,
          ownsLivingPage: onboarding.ownsLivingPage,
        })
      : null;

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
          <p className="rounded-xl bg-primary/10 text-primary px-4 py-3 font-body-md text-body-md">
            You opened a join link.{" "}
            {membership.state === "signed_out"
              ? "Sign in to join this community."
              : community.is_open
                ? "Use the Join button above to join."
                : "Use the button above to send a request to join."}
          </p>
        )}

        <CommunityTabs slug={slug} tabs={tabs} active={tab} />

        {tab === "home" && (
          <h2 className="font-headline-sm text-headline-sm text-on-background">
            What&apos;s happening in {community.name}
          </h2>
        )}

        {/* ── Home ───────────────────────────────────────────────────── */}
        {tab === "home" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col gap-6 min-w-0">
              {showPublicPreview && (
                <CommunityPublicPreview memberCount={stats.memberCount} feedPreview={feedPreview} />
              )}
              {checklist && (
                <WelcomeChecklist
                  communityId={community.id}
                  slug={community.slug}
                  items={checklist.items}
                  done={checklist.done}
                  total={checklist.total}
                />
              )}
              {pinned && <PinnedResourceCard resource={pinned} trackCommunityId={isMember ? community.id : undefined} />}
              {access.seesUpdates ? (
                <UpdatesList
                  updates={updates}
                  linked={isMember}
                  showJoinPrompt={access.joinPrompt}
                  joinHref={isMember ? "" : joinHref}
                />
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

              {isMember && sectionOn("announcements") && (
                <AnnouncementsSection
                  title={SECTION_LABEL.announcements}
                  communityId={community.id}
                  slug={community.slug}
                  isAdmin={membership.isAdmin}
                  announcements={announcements}
                  authorNames={authorNames}
                />
              )}

              {isMember && sectionOn("projects") && (
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

              {isMember && (
                <CollapsibleSection title="Teams" count={linkedTeams.length} defaultOpen>
                  {linkedTeams.length === 0 ? (
                    <p className="font-body-md text-body-md text-secondary">
                      No teams yet. A team lead can link their team here from the team&apos;s settings. Only the team&apos;s name
                      and size show; what a team shares stays private.
                    </p>
                  ) : (
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {linkedTeams.map((t) => (
                        <li
                          key={t.team_id}
                          className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest px-4 py-3 flex items-center justify-between gap-3"
                        >
                          <span className="font-label-lg text-label-lg text-on-background break-words">{t.name}</span>
                          <span className="font-body-sm text-body-sm text-secondary shrink-0">
                            {plural(t.member_count, "member")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CollapsibleSection>
              )}
            </div>

            <aside className="flex flex-col gap-6 min-w-0">
              {sectionOn("events") && <UpcomingEventsCard />}
              {access.seesMembers && (
                <MembersWorkingOnCard
                  rows={membersWorkingOn(memberRoster)}
                  membersHref={tabs.includes("members") ? hrefFor("members") : null}
                  similar={similarity ? similarity.items : null}
                  focusHref={isMember && !viewerHasFocus && tabs.includes("members") ? `${hrefFor("members")}&editFocus=1` : null}
                />
              )}
              <DigestCard />
            </aside>
          </div>
        )}

        {/* ── Resources (hand-curated) and the Explore feed ──────────── */}
        {tab === "resources" && (
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
            {sectionOn("explore") && (
              <ExploreSection
                title={SECTION_LABEL.explore}
                feedItems={feedItems}
                // Only a member gets click-through / bookmark; a non-member
                // on an 'open' community sees the same items, look-only.
                interactive={isMember}
              />
            )}
            {access.joinPrompt && (
              <p className="font-body-md text-body-md text-secondary">
                <Link href={isMember ? hrefFor("resources") : joinHref} className="text-primary hover:underline underline-offset-4">
                  Join to get updates
                </Link>{" "}
                and open the community&apos;s shared files.
              </p>
            )}
          </div>
        )}

        {/* ── Wiki pages made by members ───────────────────────────── */}
        {tab === "pages" && <LivingPagesList pages={livingPages} />}

        {/* ── Events (empty for now) ─────────────────────────────────── */}
        {tab === "events" && (
          <div className="rounded-2xl glass-panel p-6">
            <h2 className="font-headline-sm text-headline-sm text-on-background mb-1">Events</h2>
            <p className="font-body-md text-body-md text-secondary">
              No events yet. Talks and meetups will be listed here.
            </p>
          </div>
        )}

        {/* ── Members ────────────────────────────────────────────────── */}
        {tab === "members" && (
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
            {isMember && sectionOn("who_can_help") && (
              <CollapsibleSection title={SECTION_LABEL.who_can_help}>
                <EmptySection />
              </CollapsibleSection>
            )}
          </div>
        )}

        {/* ── Showcase (public) ──────────────────────────────────────── */}
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

        {membership.isAdmin && tab === "home" && (
          <ManageCommunityCard>
            <SectionsEditor
              communityId={community.id}
              slug={community.slug}
              sections={orderedSections}
            />

            <IsOpenEditor communityId={community.id} slug={community.slug} isOpen={community.is_open} />

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
          </ManageCommunityCard>
        )}
      </div>
    </PageShell>
  );
}
