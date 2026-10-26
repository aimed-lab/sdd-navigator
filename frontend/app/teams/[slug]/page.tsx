// A team's page — /teams/[slug]. Simple and calm: a green hero (label, name,
// one line, avatars, QR), "What do you want to do?" with four tiles, then cards:
// Team wiki pages and Shared documents (left), People and Team news (right). Nothing public: no
// Explore feed, no tabs.
//
// Someone who is not on the team (a QR scan, a shared link) sees a preview:
// the same layout with titles only, nothing that opens, and a sign-in or join
// button. It comes from get_team_preview, which never returns links, files,
// page content or names. Team content is members-only in the database (RLS),
// not just hidden here. What they clicked is carried in ?open=<kind>:<id> and
// opened after they have joined.

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
import { getTeamPreview, joinTeam, listCommunitiesToLink, listTeamCommunities, listTeamPages } from "@/lib/server/teams/teams";
import { parseOpen, parseOpenShape, type TileKey } from "@/lib/server/teams/teamPreview";
import { downloadHref } from "@/lib/server/communityHome/communityHome";
import type { TeamPanel } from "@/components/teams/TeamPanelContext";
import { PageShell } from "@/components/PageHeader";
import TeamHeader from "@/components/teams/TeamHeader";
import TeamPreviewView from "@/components/teams/TeamPreview";
import { siteTitle } from "@/lib/siteMode";
import TeamTiles from "@/components/teams/TeamTiles";
import { TeamPanelProvider } from "@/components/teams/TeamPanelContext";
import TeamSettings from "@/components/teams/TeamSettings";
import { DocumentsShelf, NewsList, PagesShelf, PeopleShelf } from "@/components/teams/TeamShelves";

export const dynamic = "force-dynamic"; // depends on the session

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const team = await getCommunityBySlug(slug);
  return { title: siteTitle(team ? `${team.name} · Team` : "Team") };
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ join?: string; open?: string; created?: string; skipped?: string; settings?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  // Team rows are readable only by their members and site admins, so this is
  // null for everyone else, and for an unknown slug.
  const team = await getCommunityBySlug(slug);
  if (team && team.kind !== "team") redirect(`/communities/${slug}`);

  // Link anyone added by email before they had an account, then read their row.
  await claimPendingCommunityMemberships();
  const [user, firstMembership] = await Promise.all([
    getCurrentUser(),
    team ? getMembership(team.id) : Promise.resolve(null),
  ]);

  // Back from SSO sign-in on this team's link (?join=signin): join them now,
  // here on the server, so they land on the full team page. If it fails, show
  // the reason on the join card.
  let joinError: string | null = null;
  if (query.join === "signin" && user && firstMembership?.state !== "active") {
    const joined = await joinTeam(slug);
    // Keep what they clicked (if it is well formed); the member page checks it belongs to this team.
    const keep = parseOpenShape(query.open) ? `?open=${query.open}` : "";
    if (joined.status === "ok") redirect(`/teams/${slug}${keep}`);
    joinError = joined.error;
  }
  const membership = firstMembership;

  // Not on the team: the preview (titles only). An unknown slug or a community 404s.
  if (!team || !membership || membership.state !== "active") {
    const preview = await getTeamPreview(slug);
    if (!preview) notFound();
    return (
      <PageShell className="flex flex-col gap-6 !max-w-[1120px]">
        <TeamPreviewView slug={slug} team={preview} viewer={user ? "none" : "signed_out"} initialError={joinError} />
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

  // Something they clicked before joining (?open=<kind>:<id>), only if it
  // belongs to this team: a page goes to the page, a document to its file or
  // link, a tile opens its panel.
  const target = parseOpen(query.open, {
    docIds: resources.map((r) => r.id),
    pageIds: pages.map((p) => p.pageId),
  });
  if (target?.kind === "page") {
    const p = pages.find((x) => x.pageId.toLowerCase() === target.id);
    if (p) redirect(`/pages/${p.slug}`);
  }
  if (target?.kind === "doc") {
    const r = resources.find((x) => x.id.toLowerCase() === target.id);
    const first = r?.files[0];
    const href = first ? downloadHref(first.url, first.filename) : r?.url;
    if (href) redirect(href);
  }
  const TILE_PANEL: Partial<Record<TileKey, TeamPanel>> = { document: "document", pages: "pages", share: "share" };
  const initialPanel: TeamPanel = target?.kind === "tile" ? (TILE_PANEL[target.id] ?? null) : null;
  const autoOpenLearn = target?.kind === "tile" && target.id === "learn";

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

      <TeamPanelProvider initialPanel={initialPanel}>
        <TeamHeader
          team={team}
          memberCount={roster.length}
          memberNames={roster.map((m) => m.display_name)}
          isLead={isLead}
        />

        <TeamTiles
          teamId={team.id}
          slug={team.slug}
          name={team.name}
          description={team.description}
          isLead={isLead}
          autoOpenLearn={autoOpenLearn}
        />

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
