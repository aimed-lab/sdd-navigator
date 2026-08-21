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

import { getSession, requireCurrentUser } from "@/lib/auth";
import { getAnonServerClient } from "./supabaseServer";

export type Community = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_open: boolean;
};

/** All communities, ordered by name. Degrades to an empty list so the
 *  Collaborate page still renders (without chips) if this read fails. */
export async function listCommunities(): Promise<Community[]> {
  const supabase = getAnonServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("communities")
    .select("id, slug, name, description, is_open")
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data as Community[];
}

/** One community by slug — used to resolve the ?community= URL param into an
 *  id for filtering posts/resources. Null when the slug doesn't exist. */
export async function getCommunityBySlug(slug: string): Promise<Community | null> {
  const supabase = getAnonServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("communities")
    .select("id, slug, name, description, is_open")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return null;
  return data as Community;
}

// ── Membership state ────────────────────────────────────────────────────────

export type MembershipState = "signed_out" | "none" | "pending" | "active";
export type Membership = { state: MembershipState; isLead: boolean };

/** The signed-in viewer's relationship to one community. "signed_out" for no
 *  session (join/request UI should prompt sign-in, not block); "none" for
 *  signed in but no row; "pending" for an outstanding request into a closed
 *  community; "active" for an approved member. `isLead` is only ever true
 *  alongside "active" — it's what the UI checks before showing the
 *  pending-requests / approve affordance. */
export async function getMembership(communityId: string): Promise<Membership> {
  const session = await getSession();
  if (!session) return { state: "signed_out", isLead: false };

  const { data, error } = await session.db
    .from("community_members")
    .select("status, role")
    .eq("community_id", communityId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error || !data) return { state: "none", isLead: false };
  const active = data.status === "active";
  return { state: active ? "active" : "pending", isLead: active && data.role === "lead" };
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

/** Leave a community — withdraws a pending request the same way it leaves an
 *  active membership. Self-only; community_members_self_delete (RLS) is the
 *  real gate, this .eq("user_id", ...) is belt-and-suspenders. */
export async function leaveCommunity(communityId: string): Promise<void> {
  const { user, db } = await requireCurrentUser();

  const { error } = await db
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", user.id);

  if (error) throw error;
}

export type PendingRequest = { id: string; email: string | null; requested_at: string };

/** Pending join requests for a community — visible only to a lead of that
 *  community (community_members' self-or-lead SELECT policy is the actual
 *  gate; a non-lead caller just gets an empty list back, not an error). */
export async function listPendingRequests(communityId: string): Promise<PendingRequest[]> {
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

/** Approve a pending request. Lead-only — community_members_lead_approves
 *  (RLS) is the real gate; a non-lead's UPDATE matches zero rows. */
export async function approveMembership(memberRowId: string): Promise<void> {
  const { db } = await requireCurrentUser();

  const { error } = await db
    .from("community_members")
    .update({ status: "active", approved_at: new Date().toISOString() })
    .eq("id", memberRowId);
  // approved_by is intentionally NOT set from the client body — see note
  // below; Postgres has no auth.uid() access from here, so this column is
  // left for a future trigger/RPC if "who approved" needs to be exact. RLS
  // still restricts WHO can perform this update to a lead of the row's own
  // community regardless.

  if (error) throw error;
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
