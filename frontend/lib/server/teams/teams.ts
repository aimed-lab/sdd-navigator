// lib/server/teams/teams.ts — everything a team needs that the community code
// does not already do. A team is a `communities` row with kind = 'team'
// (database/migrations/2026-10-28_teams.sql); members, roles, resources, files,
// news, the pinned resource and the QR join all come from lib/server/
// communities.ts. This file adds: creating a team, "your teams", wiki pages
// curated into a team (team_pages), and linking a team to a community
// (community_teams).
//
// Every call here uses the signed-in person's own session, so row level
// security is the real gate; the checks in code are for clear messages.

import { unstable_noStore as noStore } from "next/cache";
import { getSession, requireCurrentUser } from "@/lib/auth";
import {
  addCommunityMemberByEmail,
  createCommunity,
  getCommunityById,
  getCommunityBySlug,
  getMembership,
  type Community,
} from "@/lib/server/communities";
import { getAnonServerClient } from "@/lib/server/supabaseServer";
import {
  joinErrorMessage,
  joinResultMessage,
  LINK_MESSAGE,
  canCuratePage,
  canLinkTeam,
  canUnlinkTeam,
  visibilityAfterCurate,
  curateNote,
  parseEmails,
  parseTeamName,
  type CuratedHow,
} from "./teamRules";
import { normalizePreview, type TeamPreview } from "./teamPreview";

// ── reading a team ──────────────────────────────────────────────────────────

/** The team with this slug, or null when there is none or it is a community. */
export async function getTeamBySlug(slug: string): Promise<Community | null> {
  const row = await getCommunityBySlug(slug);
  return row && row.kind === "team" ? row : null;
}

export type TeamSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  role: string;
  member_count: number;
};

type EmbeddedCommunity = { id: string; slug: string; name: string; description: string | null; kind: string };

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** Teams the signed-in person is an active member of, by name. */
export async function listMyTeams(): Promise<TeamSummary[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];

  const { data, error } = await session.db
    .from("community_members")
    .select("role, communities(id, slug, name, description, kind)")
    .eq("user_id", session.user.id)
    .eq("status", "active");
  if (error || !data) return [];

  const rows = (data as { role: string; communities: EmbeddedCommunity | EmbeddedCommunity[] | null }[])
    .map((r) => ({ role: r.role, c: one(r.communities) }))
    .filter((r): r is { role: string; c: EmbeddedCommunity } => !!r.c && r.c.kind === "team");
  if (rows.length === 0) return [];

  const counts = await memberCounts(session.db);
  return rows
    .map((r) => ({
      id: r.c.id,
      slug: r.c.slug,
      name: r.c.name,
      description: r.c.description,
      role: r.role,
      member_count: counts.get(r.c.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The signed-in person's own teams, newest first, at most `limit`. Session
 *  client, so RLS returns only teams they are an active member of. Empty when
 *  signed out. */
export async function listMyTeamsNewest(limit: number): Promise<{ slug: string; name: string }[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];

  const { data, error } = await session.db
    .from("community_members")
    .select("communities(slug, name, kind, created_at)")
    .eq("user_id", session.user.id)
    .eq("status", "active");
  if (error || !data) return [];

  type Row = { slug: string; name: string; kind: string; created_at: string };
  return (data as { communities: Row | Row[] | null }[])
    .map((r) => one(r.communities))
    .filter((c): c is Row => !!c && c.kind === "team")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, limit)
    .map((c) => ({ slug: c.slug, name: c.name }));
}

async function memberCounts(db: { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> }) {
  const res = await db.rpc("community_member_counts");
  const out = new Map<string, number>();
  if (res.error || !Array.isArray(res.data)) return out;
  for (const r of res.data as { community_id: string; member_count: number | string }[]) {
    out.set(r.community_id, Number(r.member_count) || 0);
  }
  return out;
}

// ── a visitor with a team link ──────────────────────────────────────────────

export type TeamJoinInfo = { id: string; name: string; description: string | null; member_count: number };

/** What a person with a team link may see: id, name, description, size. Works
 *  signed out. Null for an unknown slug or for a community. Team rows are not
 *  public, so this goes through get_team_join_info (SECURITY DEFINER). */
export async function getTeamJoinInfo(slug: string): Promise<TeamJoinInfo | null> {
  const session = await getSession();
  const db = session ? session.db : getAnonServerClient();
  if (!db) return null;
  const { data, error } = await db.rpc("get_team_join_info", { p_slug: slug });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const r = data[0] as { id: string; name: string; description: string | null; member_count: number | string };
  return { id: r.id, name: r.name, description: r.description, member_count: Number(r.member_count) || 0 };
}

/** What a visitor who is not on the team may see: name, description, size and the
 *  titles (with a type) of its documents and wiki pages. Through the database
 *  function get_team_preview, which never returns links, files, page content or
 *  names. Null for an unknown slug or a community. */
export async function getTeamPreview(slug: string): Promise<TeamPreview | null> {
  const session = await getSession();
  const db = session ? session.db : getAnonServerClient();
  if (!db) return null;
  const { data, error } = await db.rpc("get_team_preview", { p_slug: slug });
  if (error) {
    console.error("getTeamPreview failed", error);
    return null;
  }
  return normalizePreview(data);
}

/** Join a team by its slug (signed in). The database function links an invite
 *  sent to the person's email, or adds them as a member. */
export async function joinTeam(slug: string): Promise<SimpleResult> {
  const { db } = await requireCurrentUser();
  const { data, error } = await db.rpc("join_team", { p_slug: slug });
  if (error) {
    console.error("joinTeam failed", error);
    return { status: "error", error: joinErrorMessage(error) };
  }
  const res = joinResultMessage(data);
  return res.ok ? { status: "ok" } : { status: "error", error: res.error };
}

// ── create a team ───────────────────────────────────────────────────────────

export type CreateTeamResult =
  | { status: "ok"; id: string; slug: string; added: number; problems: string[] }
  | { status: "error"; error: string };

/** Make a team: the signed-in person becomes its lead, then each invited email
 *  is added the same way a community admin adds a member by email (a person
 *  with an account is linked now; anyone else is linked when they sign up with
 *  that email). One bad address does not undo the team; it is reported. */
export async function createTeam(input: { name: unknown; emails?: unknown }): Promise<CreateTeamResult> {
  const name = parseTeamName(input.name);
  if (!name.ok) return { status: "error", error: name.error };

  const emails = parseEmails(input.emails ?? "");
  if (emails.invalid.length > 0) {
    return {
      status: "error",
      error: `These don't look like email addresses: ${emails.invalid.slice(0, 5).join(", ")}. Fix them or clear the box.`,
    };
  }
  if (emails.tooMany) return { status: "error", error: "That is a lot of people. Add up to 50 now and the rest later." };

  const created = await createCommunity({ name: name.name, purpose: "", kind: "team" });
  if (created.status !== "ok") return { status: "error", error: created.error };

  let added = 0;
  const problems: string[] = [];
  for (const email of emails.valid) {
    const res = await addCommunityMemberByEmail(created.id, email);
    if (res.status === "ok") added += 1;
    else if (!/already/i.test(res.error)) problems.push(email);
  }
  return { status: "ok", id: created.id, slug: created.slug, added, problems };
}

// ── team details ────────────────────────────────────────────────────────────

export const TEAM_DESCRIPTION_MAX = 160;

export type SimpleResult = { status: "ok" } | { status: "error"; error: string };
export type CurateResult = { status: "ok"; switchedToTeam: boolean } | { status: "error"; error: string };

/** Rename a team or change its one-line description. Leads only (the
 *  "Communities: admin update" policy is the real gate). */
export async function updateTeamDetails(
  teamId: string,
  input: { name?: unknown; description?: unknown }
): Promise<SimpleResult> {
  const { db } = await requireCurrentUser();
  const membership = await getMembership(teamId);
  if (!membership.isAdmin) return { status: "error", error: "Only a team lead can change this." };

  const patch: { name?: string; description?: string | null } = {};
  if (input.name !== undefined) {
    const name = parseTeamName(input.name);
    if (!name.ok) return { status: "error", error: name.error };
    patch.name = name.name;
  }
  if (input.description !== undefined) {
    const d = typeof input.description === "string" ? input.description.replace(/\s+/g, " ").trim() : "";
    if (d.length > TEAM_DESCRIPTION_MAX) {
      return { status: "error", error: `Keep the description under ${TEAM_DESCRIPTION_MAX} letters.` };
    }
    patch.description = d || null;
  }
  if (Object.keys(patch).length === 0) return { status: "ok" };

  const { data, error } = await db.from("communities").update(patch).eq("id", teamId).select("id");
  if (error || !data || data.length === 0) {
    console.error("updateTeamDetails failed", error);
    return { status: "error", error: "Couldn't save that. Please try again." };
  }
  return { status: "ok" };
}

// ── wiki pages curated into a team ──────────────────────────────────────────

export type TeamPage = {
  pageId: string;
  slug: string;
  title: string;
  how: CuratedHow;
  addedBy: string | null;
  createdAt: string;
  canRemove: boolean;
};

type PageEmbed = { id: string; slug: string; title: string; visibility: string; owner_id: string | null };

/** The team's shelf of wiki pages, newest first. Members only (RLS): a
 *  non-member gets an empty list. */
export async function listTeamPages(teamId: string): Promise<TeamPage[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];
  const { db, user } = session;

  const { data, error } = await db
    .from("team_pages")
    .select("page_id, how, added_by, created_at, pages(id, slug, title, visibility, owner_id)")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];

  const membership = await getMembership(teamId);
  const out: TeamPage[] = [];
  for (const r of data as {
    page_id: string;
    how: string;
    added_by: string | null;
    created_at: string;
    pages: PageEmbed | PageEmbed[] | null;
  }[]) {
    const page = one(r.pages);
    if (!page) continue;
    out.push({
      pageId: r.page_id,
      slug: page.slug,
      title: page.title,
      how: r.how === "made" ? "made" : "curated",
      addedBy: r.added_by,
      createdAt: r.created_at,
      canRemove: r.added_by === user.id || membership.isAdmin,
    });
  }
  return out;
}

export type PageChoice = {
  id: string;
  slug: string;
  title: string;
  visibility: string;
  own: boolean;
  /** "Team members will be able to read this page." for your own private page. */
  note: string | null;
};

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** Pages the person could add to this team, by title, at most 20: their own
 *  (any visibility) plus anyone's PUBLIC pages. With nothing typed, only their
 *  own recent pages. Pages already on the team are left out. One query, so
 *  own public pages can't crowd out other people's. RLS ("Pages: read") still
 *  decides what is visible; can_curate_page decides what can be added. */
export async function searchPagesForTeam(teamId: string, query: string): Promise<PageChoice[]> {
  const { db, user } = await requireCurrentUser();
  const q = query.trim().slice(0, 80);

  const { data: already } = await db.from("team_pages").select("page_id").eq("team_id", teamId);
  const skip = new Set(((already ?? []) as { page_id: string }[]).map((r) => r.page_id));

  let search = db.from("pages").select("id, slug, title, visibility, owner_id");
  search = q
    ? search.or(`owner_id.eq.${user.id},visibility.eq.public`).ilike("title", likePattern(q))
    : search.eq("owner_id", user.id);
  // Over-fetch a little: pages already on the team are dropped below.
  const { data } = await search.order("created_at", { ascending: false }).limit(40);

  const out: PageChoice[] = [];
  for (const p of (data ?? []) as PageEmbed[]) {
    if (skip.has(p.id)) continue;
    out.push({
      id: p.id,
      slug: p.slug,
      title: p.title,
      visibility: p.visibility,
      own: p.owner_id === user.id,
      note: curateNote({ visibility: p.visibility, ownerId: p.owner_id }, user.id),
    });
    if (out.length === 20) break;
  }
  return out;
}

/** Add a page to the team. Any team member, for a page they can read (the
 *  insert policy checks both). The page itself is not changed. */
export async function addPageToTeam(teamId: string, pageId: string, how: CuratedHow = "curated"): Promise<CurateResult> {
  const { user, db } = await requireCurrentUser();
  const membership = await getMembership(teamId);

  // Can this person read the page? Their own session answers: RLS returns the
  // row only when can_read_page() says yes.
  const { data: page } = await db.from("pages").select("id, visibility, owner_id").eq("id", pageId).maybeSingle();
  const visibility = ((page as { visibility?: string } | null)?.visibility ?? "private") as "private" | "team" | "public";
  const isOwner = (page as { owner_id?: string | null } | null)?.owner_id === user.id;
  if (!canCuratePage({ isMember: membership.state === "active", canRead: !!page, visibility, isOwner })) {
    return {
      status: "error",
      error: "You can add your own pages, and other people's public pages.",
    };
  }

  // The database switches the owner's private page to 'team' as part of this
  // insert (trigger team_pages_share_private); visibilityAfterCurate is the
  // same rule, used here only to report it.
  const { error } = await db
    .from("team_pages")
    .insert({ team_id: teamId, page_id: pageId, added_by: user.id, how });
  if (error) {
    if (error.code === "23505") return { status: "ok", switchedToTeam: false }; // already on the team
    console.error("addPageToTeam failed", error);
    return { status: "error", error: "Couldn't add that page. Please try again." };
  }
  return { status: "ok", switchedToTeam: visibilityAfterCurate(visibility, isOwner) !== visibility };
}

/** Take a page off the team: whoever added it, or a team lead. */
export async function removePageFromTeam(teamId: string, pageId: string): Promise<SimpleResult> {
  const { db } = await requireCurrentUser();
  const { data, error } = await db
    .from("team_pages")
    .delete()
    .eq("team_id", teamId)
    .eq("page_id", pageId)
    .select("page_id");
  if (error) {
    console.error("removePageFromTeam failed", error);
    return { status: "error", error: "Couldn't remove that page. Please try again." };
  }
  if (!data || data.length === 0) {
    return { status: "error", error: "Only the person who added this page, or a team lead, can remove it." };
  }
  return { status: "ok" };
}

// ── linking a team to a community ───────────────────────────────────────────

export type LinkedCommunity = { id: string; slug: string; name: string };

/** Communities this team is linked to (visible to the team's members). */
export async function listTeamCommunities(teamId: string): Promise<LinkedCommunity[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await session.db.from("community_teams").select("community_id").eq("team_id", teamId);
  if (error || !data || data.length === 0) return [];
  const ids = (data as { community_id: string }[]).map((r) => r.community_id);
  const anon = getAnonServerClient();
  if (!anon) return [];
  const { data: rows } = await anon.from("communities").select("id, slug, name").in("id", ids).order("name");
  return (rows ?? []) as LinkedCommunity[];
}

/** Communities the person belongs to: the choices for "link to a community". */
export async function listCommunitiesToLink(): Promise<LinkedCommunity[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await session.db
    .from("community_members")
    .select("communities(id, slug, name, kind)")
    .eq("user_id", session.user.id)
    .eq("status", "active");
  if (error || !data) return [];
  return (data as { communities: (EmbeddedCommunity & { kind: string }) | (EmbeddedCommunity & { kind: string })[] | null }[])
    .map((r) => one(r.communities))
    .filter((c): c is EmbeddedCommunity => !!c && c.kind === "community")
    .map((c) => ({ id: c.id, slug: c.slug, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function linkTeamToCommunity(teamId: string, communityId: string): Promise<SimpleResult> {
  const { user, db } = await requireCurrentUser();
  const [team, community, teamMembership, communityMembership] = await Promise.all([
    getCommunityById(teamId),
    getCommunityById(communityId),
    getMembership(teamId),
    getMembership(communityId),
  ]);
  if (!team || !community) return { status: "error", error: "That team or community no longer exists." };

  const check = canLinkTeam({
    teamKind: team.kind,
    communityKind: community.kind,
    isTeamAdmin: teamMembership.isAdmin,
    isCommunityMember: communityMembership.state === "active",
  });
  if (!check.ok) return { status: "error", error: LINK_MESSAGE[check.reason] };

  const { error } = await db
    .from("community_teams")
    .insert({ community_id: communityId, team_id: teamId, added_by: user.id });
  if (error) {
    if (error.code === "23505") return { status: "ok" }; // already linked
    console.error("linkTeamToCommunity failed", error);
    return { status: "error", error: "Couldn't link the team. Please try again." };
  }
  return { status: "ok" };
}

export async function unlinkTeamFromCommunity(teamId: string, communityId: string): Promise<SimpleResult> {
  const { db } = await requireCurrentUser();
  const [teamMembership, communityMembership] = await Promise.all([getMembership(teamId), getMembership(communityId)]);
  if (!canUnlinkTeam({ isTeamAdmin: teamMembership.isAdmin, isCommunityAdmin: communityMembership.isAdmin })) {
    return { status: "error", error: "Only a team lead or the community's admin can unlink a team." };
  }
  const { data, error } = await db
    .from("community_teams")
    .delete()
    .eq("team_id", teamId)
    .eq("community_id", communityId)
    .select("team_id");
  if (error || !data || data.length === 0) {
    if (error) console.error("unlinkTeamFromCommunity failed", error);
    return { status: "error", error: "Couldn't unlink the team. Please try again." };
  }
  return { status: "ok" };
}

export type LinkedTeam = { team_id: string; name: string; member_count: number };

/** The "Teams" section of a community page: name and size only, for members of
 *  that community. A team's own content stays private. */
export async function listLinkedTeams(communityId: string): Promise<LinkedTeam[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await session.db.rpc("community_linked_teams", { p_community_id: communityId });
  if (error || !Array.isArray(data)) return [];
  return (data as { team_id: string; name: string; member_count: number | string }[]).map((r) => ({
    team_id: r.team_id,
    name: r.name,
    member_count: Number(r.member_count) || 0,
  }));
}
