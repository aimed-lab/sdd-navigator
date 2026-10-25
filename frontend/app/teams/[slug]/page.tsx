// A team's page — /teams/[slug]. Simple and calm: a green hero (label, name,
// one line, avatars, QR), "What do you want to do?" with four tiles, then cards:
// Team wiki pages and Shared documents (left), People and Team news (right). Nothing public: no
// Explore feed, no tabs.
//
// Someone who is not on the team (a QR scan, a shared link) sees only the
// team's name and description and one button to join. Team content is
// members-only in the database (RLS), not just hidden here.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  claimPendingCommunityMemberships,
  getCommunityBySlug,
  getMembership,
  getPinnedResourceId,
  listAnnouncements,
  listCommunityMembers,
  listCommunityResources,
  listMemberRoster,
} from "@/lib/server/communities";
import { getTeamJoinInfo, listCommunitiesToLink, listTeamCommunities, listTeamPages } from "@/lib/server/teams/teams";
import { PageShell } from "@/components/PageHeader";
import TeamHeader from "@/components/teams/TeamHeader";
import TeamJoinCard from "@/components/teams/TeamJoinCard";
import TeamTiles from "@/components/teams/TeamTiles";
import { TeamPanelProvider } from "@/components/teams/TeamPanelContext";
import TeamSettings from "@/components/teams/TeamSettings";
import { DocumentsShelf, NewsList, PagesShelf, PeopleShelf } from "@/components/teams/TeamShelves";

export const dynamic = "force-dynamic"; // depends on the session

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const team = await getCommunityBySlug(slug);
  return { title: team ? `${team.name} · Team · SmartDrugDiscovery` : "Team · SmartDrugDiscovery" };
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ join?: string; created?: string; skipped?: string; settings?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  // Team rows are readable only by their members and site admins, so this is
  // null for everyone else, and for an unknown slug.
  const team = await getCommunityBySlug(slug);
  if (team && team.kind !== "team") redirect(`/communities/${slug}`);

  // Link anyone added by email before they had an account, then read their row.
  await claimPendingCommunityMemberships();
  const [user, membership] = await Promise.all([
    getCurrentUser(),
    team ? getMembership(team.id) : Promise.resolve(null),
  ]);

  // Not on the team: name, description, one button. A visitor gets these from
  // get_team_join_info (the only thing a team link reveals); an unknown slug 404s.
  if (!team || !membership || membership.state !== "active") {
    const info = team
      ? { id: team.id, name: team.name, description: team.description }
      : await getTeamJoinInfo(slug);
    if (!info) notFound();
    return (
      <PageShell narrow>
        <TeamJoinCard
          teamId={info.id}
          slug={slug}
          name={info.name}
          description={info.description}
          state={membership?.state ?? (user ? "none" : "signed_out")}
          autoOpen={query.join === "1"}
          autoJoin={query.join === "signin"}
        />
      </PageShell>
    );
  }

  const isLead = membership.isAdmin;
  const [roster, resources, pinnedId, pages, announcements, members, linked, linkable] = await Promise.all([
    listMemberRoster(team.id),
    listCommunityResources(team.id),
    getPinnedResourceId(team.id),
    listTeamPages(team.id),
    listAnnouncements(team.id),
    isLead ? listCommunityMembers(team.id) : Promise.resolve([]),
    isLead ? listTeamCommunities(team.id) : Promise.resolve([]),
    isLead ? listCommunitiesToLink() : Promise.resolve([]),
  ]);

  const names: Record<string, string> = Object.fromEntries(
    roster.filter((m) => m.user_id).map((m) => [m.user_id as string, m.display_name])
  );
  const skipped = Number(query.skipped) || 0;

  return (
    <PageShell className="flex flex-col gap-6 !max-w-[1120px]">
      <div>
        <Link
          href="/teams"
          className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Your teams
        </Link>
      </div>

      {query.created === "1" && (
        <p role="status" className="rounded-xl bg-primary/10 text-primary px-4 py-3 font-body-md text-body-md">
          Team created. You are its Lead. Scan or share the QR code to bring people in.
          {skipped > 0 ? ` ${skipped} email${skipped === 1 ? "" : "s"} could not be added; try them again in Team settings.` : ""}
        </p>
      )}

      <TeamPanelProvider>
        <TeamHeader
          team={team}
          memberCount={roster.length}
          memberNames={roster.map((m) => m.display_name)}
          isLead={isLead}
        />

        <TeamTiles teamId={team.id} slug={team.slug} name={team.name} isLead={isLead} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 flex flex-col gap-6 min-w-0">
            <PagesShelf teamId={team.id} teamName={team.name} slug={team.slug} pages={pages} names={names} />
            <DocumentsShelf
              teamId={team.id}
              slug={team.slug}
              resources={resources}
              pinnedId={pinnedId}
              viewerId={user?.id ?? ""}
              isLead={isLead}
              names={names}
            />
          </div>
          <div className="flex flex-col gap-6 min-w-0">
            <PeopleShelf teamId={team.id} roster={roster} viewerUserId={user?.id ?? ""} isLead={isLead} />
            <NewsList teamId={team.id} slug={team.slug} items={announcements} isLead={isLead} />
          </div>
        </div>
      </TeamPanelProvider>

      {isLead && (
        <TeamSettings
          team={team}
          members={members}
          viewerUserId={user?.id ?? ""}
          linked={linked}
          linkable={linkable}
          defaultOpen={query.settings === "1"}
        />
      )}
    </PageShell>
  );
}
