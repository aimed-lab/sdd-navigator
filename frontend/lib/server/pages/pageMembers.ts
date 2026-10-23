// lib/server/pages/pageMembers.ts — the team on a wiki page
// (database/migrations/2026-10-20_living_pages.sql, table `page_members`).
//
// Owner-only, enforced twice like addProjectMember()/removeProjectMember() in
// lib/server/projects.ts: the RLS policies on page_members (the real gate)
// and an explicit owner check here that exists to return a clear
// { status: "forbidden" } instead of a raw 42501. Uses the signed-in
// caller's request-scoped client, so RLS applies. The owner is never stored
// in page_members; owner_id on `pages` stays the owner.
//
// Unlike project members there is no "pending by email" state: page_members
// .user_id is NOT NULL, so the email must belong to an existing confirmed
// account (looked up by find_account_id_by_email_for_page, never by the app
// reading auth.users).
//
// Members only count while the page's visibility is 'team': on a private or
// public page their rows grant nothing (can_read_page/can_edit_page check
// it). Adding one is still allowed so an owner can set up the team first;
// the result's `active` says whether it takes effect right now.

import { requireCurrentUser } from "@/lib/auth";
import type { ActingContext, ActingDb } from "@/lib/server/pages/actingContext";
import { OWNER_ALREADY, isOwnerAccount } from "@/lib/server/pages/pageViewHelpers";

export type PageMemberRole = "editor" | "viewer";

export type AddPageMemberResult =
  | {
      status: "ok";
      member: { page_id: string; user_id: string; role: PageMemberRole };
      /** true only when the page is 'team', i.e. the member has access now. */
      active: boolean;
    }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

export type RemovePageMemberResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

export type PageMemberDetail = {
  user_id: string;
  name: string | null;
  email: string | null;
  role: PageMemberRole;
};

/** The team of a page with names and emails, for its OWNER (the agent's
 *  get_page). Names and emails live in tables RLS hides from other users, so
 *  this uses page_member_details() (database/migrations/2026-10-21_page_member_details.sql),
 *  which returns rows only to the page's owner. If that function has not been
 *  applied yet, it degrades to user id + role (name and email null). `user_id`
 *  is the account id, the same one add_member, remove_member and page_members
 *  use (public.users.id = auth.users.id). */
export async function listPageMemberDetails(pageId: string, ctx: ActingContext): Promise<PageMemberDetail[]> {
  const { data, error } = await ctx.db.rpc("page_member_details", { p_page_id: pageId });
  if (!error) {
    return ((data ?? []) as { user_id: string; name: string | null; email: string | null; role: PageMemberRole }[]).map(
      (m) => ({ user_id: m.user_id, name: m.name || null, email: m.email || null, role: m.role })
    );
  }
  console.error("listPageMemberDetails: page_member_details unavailable, falling back", error);
  const { data: rows, error: rowsError } = await ctx.db
    .from("page_members")
    .select("user_id, role")
    .eq("page_id", pageId);
  if (rowsError) throw rowsError;
  return ((rows ?? []) as { user_id: string; role: PageMemberRole }[]).map((m) => ({
    user_id: m.user_id,
    name: null,
    email: null,
    role: m.role,
  }));
}

function isPageMemberRole(v: unknown): v is PageMemberRole {
  return v === "editor" || v === "viewer";
}

/** True when `userId` owns the page. A page the caller can't read looks the
 *  same as a missing one (null), so this doesn't reveal private pages. */
async function loadOwnerCheck(
  db: ActingDb,
  pageId: string,
  userId: string
): Promise<{ found: boolean; isOwner: boolean; visibility: string | null }> {
  const { data, error } = await db
    .from("pages")
    .select("id, owner_id, visibility")
    .eq("id", pageId)
    .maybeSingle();
  if (error) {
    console.error("pageMembers: page lookup failed", error);
    return { found: false, isOwner: false, visibility: null };
  }
  if (!data) return { found: false, isOwner: false, visibility: null };
  return {
    found: true,
    isOwner: (data.owner_id as string | null) === userId,
    visibility: data.visibility as string,
  };
}

/** Add a member by email. OWNER ONLY. `role` defaults to 'viewer'. */
export async function addPageMember(
  pageId: string,
  email: string,
  role: PageMemberRole = "viewer",
  ctx?: ActingContext
): Promise<AddPageMemberResult> {
  const { user, db } = ctx ?? (await requireCurrentUser());

  if (!isPageMemberRole(role)) {
    return { status: "error", error: "Role must be 'editor' or 'viewer'." };
  }

  const page = await loadOwnerCheck(db, pageId, user.id);
  if (!page.found) return { status: "error", error: "Page not found." };
  if (!page.isOwner) {
    return { status: "forbidden", error: "Only the page owner can add members." };
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized) return { status: "error", error: "An email address is required." };
  // The owner is never a page_members row. Say so plainly, even if their own
  // account could not be found by the lookup below.
  if (isOwnerAccount({ resolvedId: null, email: normalized, ownerId: user.id, ownerEmail: user.email })) {
    return { status: "error", error: OWNER_ALREADY };
  }

  const { data: lookup, error: lookupError } = await db.rpc("find_account_id_by_email_for_page", {
    p_page_id: pageId,
    p_email: normalized,
  });
  if (lookupError) {
    console.error("addPageMember: account lookup failed", lookupError);
    return { status: "error", error: "Couldn't look up that email." };
  }
  const memberId = (lookup as string | null) ?? null;
  if (!memberId) {
    return { status: "error", error: "No account with that email address." };
  }
  if (isOwnerAccount({ resolvedId: memberId, email: normalized, ownerId: user.id, ownerEmail: user.email })) {
    return { status: "error", error: OWNER_ALREADY };
  }

  // No .select(): page_members needs only the insert to succeed, and a bare
  // insert sends Prefer: return=minimal.
  const { error } = await db.from("page_members").insert({
    page_id: pageId,
    user_id: memberId,
    role,
    added_by: user.id,
  });
  if (error) {
    if (error.code === "23505") {
      return { status: "error", error: "That person is already a member of this page." };
    }
    console.error("addPageMember: insert failed", error);
    return { status: "error", error: "Couldn't add that member." };
  }

  return {
    status: "ok",
    member: { page_id: pageId, user_id: memberId, role },
    active: page.visibility === "team",
  };
}

/** Remove a member. OWNER ONLY. The owner has no page_members row, so
 *  there is no owner row to protect here. */
export async function removePageMember(
  pageId: string,
  memberUserId: string,
  ctx?: ActingContext
): Promise<RemovePageMemberResult> {
  const { user, db } = ctx ?? (await requireCurrentUser());

  const page = await loadOwnerCheck(db, pageId, user.id);
  if (!page.found) return { status: "error", error: "Page not found." };
  if (!page.isOwner) {
    return { status: "forbidden", error: "Only the page owner can remove members." };
  }

  // Count the deleted rows so a stale/forged id reports "no longer exists"
  // rather than silently succeeding (RLS also matches zero rows then).
  const { data, error } = await db
    .from("page_members")
    .delete()
    .eq("page_id", pageId)
    .eq("user_id", memberUserId)
    .select("user_id");
  if (error) {
    console.error("removePageMember: delete failed", error);
    return { status: "error", error: "Couldn't remove that member." };
  }
  if (!data || data.length === 0) {
    return { status: "error", error: "That member no longer exists." };
  }

  return { status: "ok" };
}
