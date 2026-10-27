"use server";

// Server Actions for /teams. Thin: parse input, call lib/server/teams/teams.ts
// (or the community functions a team reuses), translate the result. Adding
// documents, news, members and roles reuse the actions in
// app/communities/actions.ts; only what is new for teams lives here.

import { revalidatePath } from "next/cache";
import { getCurrentUser, UnauthorizedError } from "@/lib/auth";
import {
  addPageToTeam,
  createTeam,
  joinTeam,
  leaveTeam,
  linkTeamToCommunity,
  listMyTeams,
  removePageFromTeam,
  searchPagesForTeam,
  unlinkTeamFromCommunity,
  updateTeamDetails,
  type PageChoice,
} from "@/lib/server/teams/teams";

export type TeamActionResult = { ok: true } | { ok: false; error: string };

const SIGN_IN = "Sign in first.";

function fail(e: unknown, what: string): { ok: false; error: string } {
  if (e instanceof UnauthorizedError) return { ok: false, error: SIGN_IN };
  console.error(`${what} failed`, e);
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** Create a team: name, optional emails. The creator becomes its lead. */
export async function createTeamAction(input: {
  name: string;
  emails: string;
}): Promise<{ ok: true; slug: string; added: number; problems: string[] } | { ok: false; error: string }> {
  try {
    const res = await createTeam(input);
    if (res.status !== "ok") return { ok: false, error: res.error };
    revalidatePath("/teams");
    return { ok: true, slug: res.slug, added: res.added, problems: res.problems };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in or create an account to create your team." };
    return fail(e, "createTeamAction");
  }
}

/** The signed-in person's teams by name, for the assistant's "my teams". */
export async function listMyTeamsAction(): Promise<
  { ok: true; signedIn: boolean; teams: { name: string; slug: string }[] } | { ok: false; error: string }
> {
  try {
    const signedIn = !!(await getCurrentUser());
    const teams = signedIn ? (await listMyTeams()).map((t) => ({ name: t.name, slug: t.slug })) : [];
    return { ok: true, signedIn, teams };
  } catch (e) {
    return fail(e, "listMyTeamsAction");
  }
}

/** Rename a team or change its one-line description (leads). */
export async function updateTeamDetailsAction(
  teamId: string,
  slug: string,
  input: { name?: string; description?: string }
): Promise<TeamActionResult> {
  if (!teamId) return { ok: false, error: "Missing team." };
  try {
    const res = await updateTeamDetails(teamId, input);
    if (res.status !== "ok") return { ok: false, error: res.error };
    revalidatePath(`/teams/${slug}`);
    revalidatePath("/teams");
    return { ok: true };
  } catch (e) {
    return fail(e, "updateTeamDetailsAction");
  }
}

/** Join a team (teams are always open, so this is instant). */
export async function joinTeamAction(slug: string): Promise<TeamActionResult> {
  if (!slug) return { ok: false, error: "Missing team." };
  try {
    const res = await joinTeam(slug);
    if (res.status !== "ok") return { ok: false, error: res.error };
    revalidatePath(`/teams/${slug}`);
    revalidatePath("/teams");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to join this team." };
    return fail(e, "joinTeamAction");
  }
}

// ── wiki pages ──────────────────────────────────────────────────────────────

export async function searchTeamPagesAction(
  teamId: string,
  query: string
): Promise<{ ok: true; pages: PageChoice[] } | { ok: false; error: string }> {
  if (!teamId) return { ok: false, error: "Missing team." };
  try {
    return { ok: true, pages: await searchPagesForTeam(teamId, query) };
  } catch (e) {
    return fail(e, "searchTeamPagesAction");
  }
}

export async function addTeamPageAction(
  teamId: string,
  slug: string,
  pageId: string
): Promise<{ ok: true; switchedToTeam: boolean } | { ok: false; error: string }> {
  if (!teamId || !pageId) return { ok: false, error: "Missing page." };
  try {
    const res = await addPageToTeam(teamId, pageId, "curated");
    if (res.status !== "ok") return { ok: false, error: res.error };
    revalidatePath(`/teams/${slug}`);
    return { ok: true, switchedToTeam: res.switchedToTeam };
  } catch (e) {
    return fail(e, "addTeamPageAction");
  }
}

export async function removeTeamPageAction(teamId: string, slug: string, pageId: string): Promise<TeamActionResult> {
  if (!teamId || !pageId) return { ok: false, error: "Missing page." };
  try {
    const res = await removePageFromTeam(teamId, pageId);
    if (res.status !== "ok") return { ok: false, error: res.error };
    revalidatePath(`/teams/${slug}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "removeTeamPageAction");
  }
}

/** Leave a team: the caller's own membership only. A lead can leave only when another
 *  lead remains (checked in leaveTeam, not just in the UI). */
export async function leaveTeamAction(teamId: string, slug: string): Promise<TeamActionResult> {
  if (!teamId) return { ok: false, error: "Missing team." };
  try {
    const res = await leaveTeam(teamId);
    if (res.status !== "ok") return { ok: false, error: res.error };
    revalidatePath("/teams");
    revalidatePath(`/teams/${slug}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e, "leaveTeamAction");
  }
}

// ── community links ─────────────────────────────────────────────────────────

export async function linkTeamAction(teamId: string, slug: string, communityId: string): Promise<TeamActionResult> {
  if (!teamId || !communityId) return { ok: false, error: "Pick a community." };
  try {
    const res = await linkTeamToCommunity(teamId, communityId);
    if (res.status !== "ok") return { ok: false, error: res.error };
    revalidatePath(`/teams/${slug}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "linkTeamAction");
  }
}

export async function unlinkTeamAction(teamId: string, slug: string, communityId: string): Promise<TeamActionResult> {
  if (!teamId || !communityId) return { ok: false, error: "Missing community." };
  try {
    const res = await unlinkTeamFromCommunity(teamId, communityId);
    if (res.status !== "ok") return { ok: false, error: res.error };
    revalidatePath(`/teams/${slug}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "unlinkTeamAction");
  }
}
