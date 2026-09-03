// Community detail — /communities/[slug]. Purpose, request/leave, the
// project list, and — admin only — the pending-requests queue, add-by-email,
// and the member roster (roles + remove). Not a redirect for a signed-out
// visitor: communities are publicly readable, same as /communities itself.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCommunityBySlug,
  getCommunityStats,
  getMembership,
  listAnnouncements,
  listCommunityMembers,
  listCommunityProjects,
  listCommunityResources,
  listMemberRoster,
  listPendingRequests,
} from "@/lib/server/communities";
import { resolveSections, SECTION_LABEL } from "@/lib/communityTypes";
import { getCurrentUser } from "@/lib/auth";
import JoinLeaveControl from "@/components/communities/JoinLeaveControl";
import AddMemberByEmailForm from "@/components/communities/AddMemberByEmailForm";
import PendingRequestsPanel from "@/components/communities/PendingRequestsPanel";
import MemberRoster from "@/components/communities/MemberRoster";
import CommunityProjectsList from "@/components/communities/CommunityProjectsList";
import MembersSection from "@/components/communities/MembersSection";
import AnnouncementsSection from "@/components/communities/AnnouncementsSection";
import ResourcesSection from "@/components/communities/ResourcesSection";
import EmptySection from "@/components/communities/EmptySection";
import CollapsibleSection from "@/components/communities/CollapsibleSection";
import DeleteCommunityButton from "@/components/communities/DeleteCommunityButton";
import CopyLinkButton from "@/components/communities/CopyLinkButton";
import LeaveButton from "@/components/communities/LeaveButton";
import ManageCommunityCard from "@/components/communities/ManageCommunityCard";
import SectionsEditor from "@/components/communities/SectionsEditor";

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

  // Member-facing roster (name + role, admins first) for the Members
  // section below. listMemberRoster degrades to [] for anyone who isn't an
  // active member (community_member_roster's own is_community_member() gate
  // in the database, not just this check) — fetched only for an active
  // member, same "avoid firing it for a viewer who can't see anything back"
  // reasoning as the admin-only reads above.
  const memberRoster = isMember ? await listMemberRoster(community.id) : [];

  // Announcements — same "only fetch when isMember" reasoning as
  // memberRoster above; a non-member's fetch would return [] anyway
  // (community_announcements' own is_community_member() SELECT policy),
  // this just avoids firing it for a viewer who can't see anything back.
  // Author names are resolved through the SAME roster fetched above
  // (community_member_roster), never a raw email — see AnnouncementsSection's
  // own comment on why.
  const announcements = isMember ? await listAnnouncements(community.id) : [];

  // Resources — same "only fetch when isMember" reasoning, same author-name
  // source as announcements (the SAME roster fetched above), just under a
  // name that matches how ResourcesSection reads it ("who added it" rather
  // than "who wrote it").
  const resources = isMember ? await listCommunityResources(community.id) : [];

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
        <Link
          href="/communities"
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

        {/* Enabled sections, in the configured order (default: every
            section, projects first — the same position it's always
            rendered in), each a card (CollapsibleSection — glass-panel,
            same disclosure idiom as ManageCommunityCard below, which is
            deliberately on a quieter surface than these). Projects starts
            open; everything else starts closed. Only "projects", "members",
            "announcements", and "resources" have real content today, per
            spec; the rest render a "nothing here yet" placeholder
            deliberately, not as something to hide — and have no count or
            action to show while collapsed, unlike the other four.

            Announcements and Resources each render themselves rather than
            being wrapped here — their header action ("New announcement" /
            "Add resource") and their create/add form share one piece of
            client state, which has to live in that one component (see
            their own comments). Projects doesn't need that: its action is
            a plain link, so the page (server) builds it and hands it
            straight to CollapsibleSection's `action` prop. */}
        {orderedSections
          .filter((s) => s.enabled)
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
                return (
                  <CollapsibleSection
                    key={s.key}
                    title={SECTION_LABEL[s.key]}
                    count={stats.memberCount}
                  >
                    <MembersSection isMember={isMember} roster={memberRoster} />
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
                    addedByNames={authorNames}
                  />
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
