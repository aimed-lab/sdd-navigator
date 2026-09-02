// lib/server/communities.ts — reads for `communities`, and the join/request/
// leave/approve flow on `community_members`
// (database/migrations/2026-08-20_communities.sql,
// database/migrations/2026-08-21_community_join.sql).
//
// COMMUNITY reads are PUBLIC — the communities SELECT policy is USING(true),
// so listCommunities/getCommunityBySlug run through the anon server client,
// same posture as lib/server/collaborate.ts's listResources().
//
// MEMBERSHIP reads/writes are SESSION-SCOPED. community_members' SELECT
// policy (2026-08-21) is narrowed to "your own row, or a lead of that
// community" — it can no longer be read anonymously (rows may carry an
// unlinked person's email; see that migration's header). getMembership()
// uses getSession() (non-throwing) so it can be called during render for a
// signed-out visitor without blowing up; join/leave/approve use
// requireCurrentUser() and reject when signed out.
//
// ACTIVITY COUNTS for a signed-out visitor come from community_member_stats(),
// a SECURITY DEFINER RPC that returns aggregates only (never a row) —
// deliberately granted to anon (see that migration) so a shared link shows
// the community is alive before asking anyone to sign in.
//
// CACHING (2026-08-21 fix): join/leave/approve write through Server Actions
// that already call revalidatePath() — but the symptom reported was stale
// membership state surviving that: /collaborate?community=biokdd kept
// showing the pre-action button until the URL changed, even though
// community_members itself was correct. That's the Next.js CLIENT Router
// Cache (a per-URL RSC-payload cache), not the server-side Full Route Cache
// — this page is already fully dynamic (it reads searchParams, which alone
// forces dynamic rendering regardless of the `dynamic` export at the top of
// page.tsx), so there was no server-side page cache to disable in the first
// place. The actual fix has two parts, both scoped to the membership read
// ONLY — posts/resources keep whatever caching they'd otherwise get:
//   1. The Server Actions now revalidatePath() the EXACT current URL
//      (path + ?community=<slug>), not just the bare "/collaborate" — the
//      client Router Cache keys its entries per full URL, so revalidating
//      only the path-without-query left the query-bearing entry (the one
//      actually on screen) untouched. See app/collaborate/actions.ts.
//   2. getMembership() (and the other two per-viewer membership reads
//      below) call unstable_noStore() — an explicit, LOCAL opt-out of
//      caching for just this data fetch, rather than something that would
//      affect listCommunities/listPendingRequests-adjacent public reads or
//      force the whole route to declare itself dynamic (it already must be,
//      via searchParams, but this makes the "this read must always be
//      fresh" intent explicit and independent of that).

import { unstable_noStore as noStore } from "next/cache";
import { getSession, requireCurrentUser } from "@/lib/auth";
import { getAnonServerClient } from "./supabaseServer";
import type { SectionConfig } from "@/lib/communityTypes";

export type Community = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_open: boolean;
  // NULL means "show every section, default order" — see
  // lib/communityTypes.ts's resolveSections(), the one place this gets
  // interpreted. Selected on every read below so this field is never
  // silently undefined on a Community the type claims to have it on.
  sections: SectionConfig[] | null;
};

/** All communities, ordered by name. Degrades to an empty list so the
 *  Collaborate page still renders (without chips) if this read fails.
 *
 *  Also runs the by-email-add backstop claim (see addCommunityMemberByEmail's
 *  own comment) for whoever's currently signed in — same call site pattern
 *  as listMyProjects()'s claim_pending_project_memberships(), best-effort,
 *  never blocks this read on failure. Communities themselves are public
 *  reads (getAnonServerClient), but the claim needs the caller's own
 *  session, so it only runs when one exists. */
export async function listCommunities(): Promise<Community[]> {
  const session = await getSession();
  if (session) {
    const { error } = await session.db.rpc("claim_pending_community_memberships");
    if (error) console.error("listCommunities: claim_pending_community_memberships failed", error);
  }

  const supabase = getAnonServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("communities")
    .select("id, slug, name, description, is_open, sections")
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data as Community[];
}

export type CreateCommunityResult =
  | { status: "ok"; id: string; slug: string }
  | { status: "error"; error: string };

/** Create a community. Any signed-in user — create_community_with_admin
 *  (database/migrations/2026-08-30_community_admin_membership.sql) inserts
 *  the community row AND the caller's own admin membership row in one
 *  transaction, same move as create_project_with_lead. ALL COMMUNITIES ARE
 *  PRIVATE — there is no is_open parameter to pass; the RPC hardcodes it
 *  false. */
export async function createCommunity(input: {
  name: string;
  purpose: string;
}): Promise<CreateCommunityResult> {
  const { db } = await requireCurrentUser();

  const name = input.name.trim();
  if (!name) return { status: "error", error: "A community name is required." };

  const purpose = input.purpose.trim();
  if (!purpose) return { status: "error", error: "Say what this community is for." };

  const { data, error } = await db
    .rpc("create_community_with_admin", { p_name: name, p_description: purpose })
    .single();

  if (error || !data) {
    console.error("createCommunity: create_community_with_admin RPC failed", error);

    // Distinguish "the RPC's own RAISE EXCEPTION checks caught something"
    // (P0001 — no authenticated user, empty name; both should already be
    // impossible by the time this runs, given the checks above, but a
    // session can still expire mid-request) from an actual server-side
    // problem — a bad migration, a real bug, anything else. The first is
    // shown near-verbatim (still readable without a terminal); the second
    // says plainly that it's not something retyping the form will fix, so
    // "Couldn't create the community" alone never has to be diagnosed by
    // going and reading the server log.
    if (error?.code === "P0001" && error.message) {
      const reason = error.message.replace(/^create_community_with_admin:\s*/, "");
      return { status: "error", error: `Couldn't create the community — ${reason}.` };
    }

    return {
      status: "error",
      error:
        "Couldn't create the community — this is a server-side problem, not something wrong with what you entered. Check the server log (code: " +
        (error?.code ?? "unknown") +
        ").",
    };
  }

  const row = data as { id: string; slug: string };
  return { status: "ok", id: row.id, slug: row.slug };
}

/** One community by slug — used to resolve the ?community= URL param into an
 *  id for filtering posts/resources. Null when the slug doesn't exist. */
export async function getCommunityBySlug(slug: string): Promise<Community | null> {
  const supabase = getAnonServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("communities")
    .select("id, slug, name, description, is_open, sections")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return null;
  return data as Community;
}

/** One community by id — the counterpart to getCommunityBySlug, needed
 *  wherever only the id is in hand (e.g. /projects/new?community=<id>,
 *  which needs the SLUG back to redirect into /communities/<slug> after
 *  create). Same public read as getCommunityBySlug. */
export async function getCommunityById(id: string): Promise<Community | null> {
  const supabase = getAnonServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("communities")
    .select("id, slug, name, description, is_open, sections")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return data as Community;
}

/** Every community the signed-in viewer belongs to (active) or has a
 *  pending request into, keyed by community_id — one query for the whole
 *  /communities list page instead of one getMembership() per community.
 *  Empty when signed out (the page shows every community as "other" then,
 *  same as an anonymous /collaborate visitor sees no Join state either). */
export async function listMyMemberships(): Promise<
  Record<string, { status: "active" | "pending"; role: CommunityRole }>
> {
  const session = await getSession();
  if (!session) return {};

  const { data, error } = await session.db
    .from("community_members")
    .select("community_id, status, role")
    .eq("user_id", session.user.id);

  if (error || !data) return {};
  const out: Record<string, { status: "active" | "pending"; role: CommunityRole }> = {};
  for (const row of data as { community_id: string; status: "active" | "pending"; role: CommunityRole }[]) {
    out[row.community_id] = { status: row.status, role: row.role };
  }
  return out;
}

// ── Membership state ────────────────────────────────────────────────────────

export type MembershipState = "signed_out" | "none" | "pending" | "active";
export type CommunityRole = "admin" | "lead" | "member";
export type Membership = { state: MembershipState; role: CommunityRole | null; isAdmin: boolean };

/** The signed-in viewer's relationship to one community. "signed_out" for no
 *  session (join/request UI should prompt sign-in, not block); "none" for
 *  signed in but no row; "pending" for an outstanding request into a closed
 *  community; "active" for an approved member. `isAdmin` is only ever true
 *  alongside "active" — it's what the UI checks before showing the
 *  membership-management affordances (pending requests, add by email,
 *  promote/demote/remove). Was `isLead` before
 *  2026-08-30_community_admin_membership.sql — membership management moved
 *  from lead to admin (a lead can post, same as any member, but no longer
 *  manages membership; see that migration's header), so this now reflects
 *  role = 'admin', not role = 'lead'. */
export async function getMembership(communityId: string): Promise<Membership> {
  noStore(); // this specific read must never be served from a cached RSC payload
  const session = await getSession();
  if (!session) return { state: "signed_out", role: null, isAdmin: false };

  const { data, error } = await session.db
    .from("community_members")
    .select("status, role")
    .eq("community_id", communityId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error || !data) return { state: "none", role: null, isAdmin: false };
  const active = data.status === "active";
  const role = active ? (data.role as CommunityRole) : null;
  return { state: active ? "active" : "pending", role, isAdmin: role === "admin" };
}

/** Join (open community) or request to join (closed community). Which one
 *  happens is decided by RLS (community_members_self_insert,
 *  2026-08-21_community_join.sql), not by this function — it always tries
 *  'active' first only when the caller already knows the community is open;
 *  callers pass `isOpen` from the community row they already have, and the
 *  insert itself is still the only real gate (a forged isOpen=true against a
 *  closed community is rejected by Postgres, not silently downgraded here). */
export async function joinCommunity(communityId: string, isOpen: boolean): Promise<void> {
  const { user, db } = await requireCurrentUser();

  const { error } = await db.from("community_members").insert({
    community_id: communityId,
    user_id: user.id,
    email: user.email,
    status: isOpen ? "active" : "pending",
  });

  if (error) throw error;
}

export type LeaveCommunityResult = { status: "ok" } | { status: "error"; error: string };

/** Leave a community — withdraws a pending request the same way it leaves an
 *  active membership. Self-only; "Community members: self or admin delete"
 *  (RLS) is the real gate, this .eq("user_id", ...) is belt-and-suspenders.
 *
 *  AN ADMIN LEAVING IS THE ONE CASE THIS CAN GENUINELY FAIL: deleting the
 *  last active admin's own row trips enforce_community_admin_guard (P0001,
 *  "A community must always keep at least one admin.") — the backstop for
 *  LeaveCommunityButton's own pre-check (an admin with no other active
 *  admin sees the control disabled with a reason before ever calling this,
 *  see that component), not the primary defense. Withdrawing a pending
 *  request or a non-admin leaving can never hit the trigger at all (it
 *  only restricts an active admin row), so this still returns "ok" for
 *  every path that isn't that one edge case.
 *
 *  Was Promise<void> (threw on any failure) before this — changed to a
 *  result type so the P0001 split below (same shape as
 *  createCommunity/addCommunityMemberByEmail/deleteCommunity) has
 *  somewhere to put a message; requireCurrentUser() above still throws
 *  UnauthorizedError for "not signed in", unchanged, since both callers
 *  (app/collaborate/actions.ts and app/communities/actions.ts) already
 *  catch that case separately. */
export async function leaveCommunity(communityId: string): Promise<LeaveCommunityResult> {
  const { user, db } = await requireCurrentUser();

  const { error } = await db
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", user.id);

  if (error) {
    console.error("leaveCommunity: delete failed", error);

    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't leave — ${error.message}.` };
    }

    return {
      status: "error",
      error:
        "Couldn't leave — this is a server-side problem, not something wrong with what you did. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

export type PendingRequest = { id: string; email: string | null; requested_at: string };

/** Pending join requests for a community — visible only to an admin of that
 *  community (community_members' self-or-admin SELECT policy, 2026-08-30,
 *  is the actual gate; a non-admin caller just gets an empty list back, not
 *  an error). */
export async function listPendingRequests(communityId: string): Promise<PendingRequest[]> {
  noStore(); // same reasoning as getMembership() — must reflect the latest approve/leave
  const session = await getSession();
  if (!session) return [];

  const { data, error } = await session.db
    .from("community_members")
    .select("id, email, requested_at")
    .eq("community_id", communityId)
    .eq("status", "pending")
    .order("requested_at", { ascending: true });

  if (error || !data) return [];
  return data as PendingRequest[];
}

/** Approve a pending request. Admin-only (2026-08-30, was lead-only) —
 *  "Community members: admin manages" (RLS) is the real gate; a non-admin's
 *  UPDATE matches zero rows. */
export async function approveMembership(memberRowId: string): Promise<void> {
  const { db } = await requireCurrentUser();

  const { error } = await db
    .from("community_members")
    .update({ status: "active", approved_at: new Date().toISOString() })
    .eq("id", memberRowId);
  // approved_by is intentionally NOT set from the client body — see note
  // below; Postgres has no auth.uid() access from here, so this column is
  // left for a future trigger/RPC if "who approved" needs to be exact. RLS
  // still restricts WHO can perform this update to an admin of the row's
  // own community regardless.

  if (error) throw error;
}

/** Reject a pending request — a plain delete of the row, same as
 *  leaveCommunity but admin-acting-on-someone-else instead of self.
 *  "Community members: self or admin delete" (RLS) is the real gate; there
 *  is no separate "rejected" state to record — a rejected request simply
 *  stops existing, exactly like a withdrawn one, so a rejected person can
 *  request again later without a stale row in the way. */
export async function rejectMembership(memberRowId: string): Promise<void> {
  const { db } = await requireCurrentUser();

  const { error } = await db.from("community_members").delete().eq("id", memberRowId);

  if (error) throw error;
}

export type AddCommunityMemberResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

/** Add a member by email. ADMIN-ONLY — enforced twice, same shape as
 *  addProjectMember (lib/server/projects.ts): "Community members: admin
 *  insert by email" (RLS) is the real gate, the isAdmin check below exists
 *  purely to return a clear { status: "forbidden" } instead of a raw 42501.
 *
 *  Member IMMEDIATELY, not pending — no approval step for an admin-added
 *  row (that's the whole point of this being the second way in, distinct
 *  from request-to-join). Email is lowercased before insert; the unique
 *  index is on (community_id, lower(email)).
 *
 *  approved_by/approved_at are NOT set on this insert, even though this
 *  row IS effectively pre-approved — "Community members: admin insert by
 *  email" (RLS) requires approved_by IS NULL on the inserted row (that
 *  column is reserved for the approve-a-pending-request UPDATE path, see
 *  approveMembership above); setting it here trips a 42501, not a
 *  friendlier rejection. status = 'active' alone is what makes this row
 *  a member immediately — approved_by staying NULL just means "never went
 *  through the request/approve flow," which is true.
 *
 *  LINKS AN EXISTING ACCOUNT NOW, not just at signup —
 *  find_account_id_by_email_for_community
 *  (2026-08-30_community_admin_membership.sql) looks the email up in
 *  auth.users (never read directly by the app) and, if found, the row is
 *  inserted already linked. If not found, it's inserted with user_id NULL
 *  and handle_new_user() (2026-08-21, unchanged) claims it the moment that
 *  email signs up — claim_pending_community_memberships() is the backstop,
 *  called from listCommunities() below, exactly the way
 *  claim_pending_project_memberships() backstops listMyProjects(). */
export async function addCommunityMemberByEmail(
  communityId: string,
  email: string
): Promise<AddCommunityMemberResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "forbidden", error: "Only a community admin can add members." };
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized) return { status: "error", error: "An email address is required." };

  let existingUserId: string | null = null;
  const { data: lookupData, error: lookupError } = await db.rpc(
    "find_account_id_by_email_for_community",
    { p_community_id: communityId, p_email: normalized }
  );
  if (lookupError) {
    console.error("addCommunityMemberByEmail: existing-account lookup failed", lookupError);
  } else {
    existingUserId = (lookupData as string | null) ?? null;
  }

  const { error } = await db.from("community_members").insert({
    community_id: communityId,
    user_id: existingUserId,
    email: normalized,
    role: "member",
    status: "active",
  });

  if (error) {
    if (error.code === "23505") {
      return { status: "error", error: "That person is already a member of this community." };
    }
    console.error("addCommunityMemberByEmail: insert failed", error);

    // Same split as createCommunity's own RPC-error handling: a P0001 is
    // one of our own RAISE EXCEPTION checks (readable near-verbatim);
    // anything else — including a 42501 RLS rejection like the one that
    // exposed the approved_by/approved_at bug above — is a server-side
    // problem, said plainly, with the code, instead of a blanket
    // "Couldn't add that member."
    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't add that member — ${error.message}.` };
    }

    return {
      status: "error",
      error:
        "Couldn't add that member — this is a server-side problem, not something wrong with what you entered. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

export type CommunityMember = {
  id: string;
  email: string | null;
  user_id: string | null;
  role: CommunityRole;
  status: "active" | "pending";
};

/** The full member roster, WITH email — admin-only. "Community members:
 *  self or admin select" (RLS) is the real gate: a non-admin caller gets
 *  back only their own row (never other members' emails), which reads here
 *  as "not admin, don't render the roster" rather than an error. This is
 *  the one read in this file that ever ships another member's email to the
 *  client — every other read is either the viewer's own row or an
 *  aggregate. */
export async function listCommunityMembers(communityId: string): Promise<CommunityMember[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) return [];

  const { data, error } = await session.db
    .from("community_members")
    .select("id, email, user_id, role, status")
    .eq("community_id", communityId)
    .eq("status", "active")
    .order("role", { ascending: true }); // 'admin' < 'lead' < 'member' alphabetically — admins first

  if (error || !data) return [];
  return data as CommunityMember[];
}

export type MemberRosterEntry = {
  user_id: string;
  role: CommunityRole;
  display_name: string;
};

/** The member-facing roster — display name (or role) for any ACTIVE member
 *  to see, unlike listCommunityMembers above (admin-only, raw emails). Goes
 *  through community_member_roster() — a SECURITY DEFINER RPC gated by
 *  is_community_member(), the exact same shape as project_member_names()
 *  (lib/server/projects.ts) — because a plain join on public.users would
 *  run into that table's own SELECT policy (`is_public = true`) and blank
 *  out a private-profile member instead of falling back to their email.
 *  Sorted admins first, then alphabetically by the resolved display name —
 *  never by raw role string, which would put "admin" ahead of "lead" ahead
 *  of "member" alphabetically only by coincidence. */
export async function listMemberRoster(communityId: string): Promise<MemberRosterEntry[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];

  const { data, error } = await session.db.rpc("community_member_roster", {
    community_ids: [communityId],
  });
  if (error || !Array.isArray(data)) return [];

  const rows = data as {
    user_id: string;
    role: CommunityRole;
    name: string | null;
    email: string | null;
  }[];

  return rows
    .map((r) => ({
      user_id: r.user_id,
      role: r.role,
      display_name: r.name || r.email || "Unnamed member",
    }))
    .sort((a, b) => {
      if (a.role === "admin" && b.role !== "admin") return -1;
      if (b.role === "admin" && a.role !== "admin") return 1;
      return a.display_name.localeCompare(b.display_name);
    });
}

export type ChangeRoleResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

/** Promote or demote a member. Admin-only — "Community members: admin
 *  manages" (RLS) is the real gate. The admin-guard trigger
 *  (enforce_community_admin_guard) is what actually stops this call from
 *  demoting a DIFFERENT admin or leaving a community with zero admins; the
 *  raw Postgres exception it raises is surfaced here as a plain message
 *  rather than a stack trace. */
export async function changeCommunityMemberRole(
  communityId: string,
  memberRowId: string,
  role: CommunityRole
): Promise<ChangeRoleResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "forbidden", error: "Only a community admin can change roles." };
  }

  const { error } = await db
    .from("community_members")
    .update({ role })
    .eq("id", memberRowId)
    .eq("community_id", communityId);

  if (error) {
    // The trigger's RAISE EXCEPTION messages are written to be shown
    // as-is (see the migration) — "An admin cannot remove or demote
    // another admin." / "A community must always keep at least one
    // admin." — rather than translated into something generic here.
    return { status: "error", error: error.message || "Couldn't change that member's role." };
  }

  return { status: "ok" };
}

export type RemoveCommunityMemberResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

/** Remove a member. Admin-only — same RLS gate and same trigger backstop as
 *  changeCommunityMemberRole (removing another admin, or the last admin, is
 *  rejected by enforce_community_admin_guard, not by this function). */
export async function removeCommunityMember(
  communityId: string,
  memberRowId: string
): Promise<RemoveCommunityMemberResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "forbidden", error: "Only a community admin can remove members." };
  }

  const { error } = await db
    .from("community_members")
    .delete()
    .eq("id", memberRowId)
    .eq("community_id", communityId);

  if (error) {
    return { status: "error", error: error.message || "Couldn't remove that member." };
  }

  return { status: "ok" };
}

export type DeleteCommunityResult = { status: "ok" } | { status: "error"; error: string };

/** Delete a community. Admin-only — "Communities: admin delete"
 *  (2026-08-31_community_delete.sql) is the real gate, is_community_admin
 *  re-checked below purely for a clear message instead of a raw 42501/zero
 *  rows deleted.
 *
 *  NOTHING ELSE IS DELETED. Every side effect is an existing FK constraint,
 *  not app code: community_members rows are removed by ON DELETE CASCADE
 *  (2026-08-20_communities.sql); collab_posts.community_id,
 *  lab_resources.community_id, and projects.community_id are all set back
 *  to NULL by ON DELETE SET NULL. A project that belonged to this
 *  community survives as a personal project — its members, checklist,
 *  resources, and shared folder are completely untouched, exactly as if it
 *  had never been linked to a community. */
export async function deleteCommunity(communityId: string): Promise<DeleteCommunityResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can delete it." };
  }

  const { data: deleted, error } = await db
    .from("communities")
    .delete()
    .eq("id", communityId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("deleteCommunity: delete failed", error);

    // Same split as createCommunity/addCommunityMemberByEmail: a P0001 is
    // one of this database's own RAISE EXCEPTION checks (here, most
    // likely enforce_community_admin_guard — see
    // 2026-08-31_community_delete_admin_guard_fix.sql for the bug that
    // exposed "Couldn't delete the community." telling nobody anything),
    // shown near-verbatim. Anything else is a genuine server-side problem,
    // said plainly, with the code.
    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't delete the community — ${error.message}.` };
    }

    return {
      status: "error",
      error:
        "Couldn't delete the community — this is a server-side problem, not something wrong with what you did. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }
  if (!deleted) {
    // RLS matched zero rows — not an admin, or the community no longer
    // exists. Same non-distinction deleteProject makes for the same
    // reason: telling the two apart isn't this function's call to make.
    return { status: "error", error: "Couldn't delete the community." };
  }

  return { status: "ok" };
}

export type UpdateSectionsResult = { status: "ok" } | { status: "error"; error: string };

/** Save the community's section list — admin-only. "Communities: admin
 *  update" (2026-08-31_community_sections.sql) is the real gate,
 *  is_community_admin re-checked below for a clear message instead of a
 *  raw 42501.
 *
 *  Writes the WHOLE array every time (SectionsEditor sends its full local
 *  state on Save, not a diff) — matches the migration's own framing of
 *  `sections` as one opaque ordered blob, not per-key rows to reconcile.
 *  No shape validation here beyond what TypeScript already gives the
 *  caller; resolveSections() (lib/communityTypes.ts) is where a malformed
 *  or partial array gets made sense of on READ, not here on write. */
export async function updateCommunitySections(
  communityId: string,
  sections: SectionConfig[]
): Promise<UpdateSectionsResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can change sections." };
  }

  const { error } = await db.from("communities").update({ sections }).eq("id", communityId);

  if (error) {
    console.error("updateCommunitySections: update failed", error);

    // Same split as every other write in this file.
    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't save sections — ${error.message}.` };
    }

    return {
      status: "error",
      error:
        "Couldn't save sections — this is a server-side problem, not something wrong with what you chose. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

export type CommunityProject = {
  id: string;
  name: string;
  description: string | null;
  stage: string | null;
};

/** A community's projects — any active member can see the list (RLS:
 *  "Projects: member or community select", 2026-08-30). Full project detail
 *  (checklist, resources, shared folder) stays gated to actual project
 *  members, unchanged — this is only the summary row. */
export async function listCommunityProjects(communityId: string): Promise<CommunityProject[]> {
  const session = await getSession();
  if (!session) return [];

  const { data, error } = await session.db
    .from("projects")
    .select("id, name, description, stage")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data as CommunityProject[];
}

// ── Activity ─────────────────────────────────────────────────────────────

export type CommunityStats = { memberCount: number; joinedLast7d: number };

/** Public activity counts — works signed out (community_member_stats is a
 *  SECURITY DEFINER RPC granted to anon). Degrades to zeros so a stats
 *  failure never blocks rendering the page. */
export async function getCommunityStats(communityId: string): Promise<CommunityStats> {
  const supabase = getAnonServerClient();
  if (!supabase) return { memberCount: 0, joinedLast7d: 0 };

  const { data, error } = await supabase
    .rpc("community_member_stats", { p_community_id: communityId })
    .maybeSingle();

  if (error || !data) return { memberCount: 0, joinedLast7d: 0 };
  const row = data as { member_count: number | string; joined_last_7d: number | string };
  return {
    memberCount: Number(row.member_count) || 0,
    joinedLast7d: Number(row.joined_last_7d) || 0,
  };
}
