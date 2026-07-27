// lib/server/inbox.ts — the Collaborate inbox: responses aimed AT the caller.
//
// AUTH: goes through lib/auth.ts, never @supabase directly (see the SWAP POINT
// comment there). Every read/write below is scoped to the caller by the DATABASE,
// not by a filter written here — that is the whole design, so read on.
//
// WHY THREE RPCs AND NOT A QUERY
// connection_requests RLS is `SELECT USING (auth.uid() = user_id)`, i.e. the rows
// you CREATED. An inbox is the reverse: rows created by other people, aimed at
// posts you own. No amount of client-side filtering can produce that, because
// RLS hides the rows before a filter ever sees them — and the fix must not be
// "widen the policy", since these rows carry other people's messages and contact
// details.
//
// So the reverse direction lives in three narrow SECURITY DEFINER functions
// (database/migrations/2026-07-27_collab_inbox.sql):
//   inbox_requests()      — responses to posts I own
//   inbox_unseen_count()  — how many are still 'new' (the nav badge)
//   mark_inbox_seen(ids)  — flip 'new' -> 'seen', mine only
//
// None of them takes a user id. Each derives the caller from auth.uid() inside
// the function body, so there is no argument to tamper with: passing another
// user's request id to mark_inbox_seen simply matches nothing. That is why this
// module never needs to check ownership itself, and why it must not start
// pretending to — an ownership check here would be a decorative second copy of
// the real one.
//
// PRIVACY: `contact` is a string the RESPONDER typed when responding. This module
// does not read, and must not read, users.email or anything from auth.users. If a
// future change wants an email in the inbox, that is a new consent decision
// belonging in the respond flow, not a join added here.

import { getDb, requireCurrentUser } from "@/lib/auth";
import type { InterestType } from "@/lib/collabTypes";

/** One response sitting in the caller's inbox. Mirrors inbox_requests()'s
 *  RETURNS TABLE exactly — if you add a column there, add it here. */
export type InboxRequest = {
  request_id: string;
  post_id: string;
  post_title: string;
  interest_type: InterestType | null;
  message: string;
  /** What the responder typed as their contact route. '' when they left it blank. */
  contact: string;
  status: "new" | "seen" | "responded" | "closed";
  created_at: string;
  responder_id: string;
  responder_name: string | null;
  responder_affiliation: string | null;
  responder_institution: string | null;
  /** Non-null only when the responder's profile is already public. */
  responder_profile_slug: string | null;
};

/**
 * Every response to a post the caller owns, newest first.
 *
 * Returns [] for a signed-out caller rather than throwing: the page above this
 * redirects on its own auth check, and an empty inbox and no inbox render the
 * same way. Degrades to [] on an RPC failure too — a broken inbox should look
 * empty with an error banner, not crash the route.
 */
export async function listInbox(): Promise<InboxRequest[]> {
  const db = await getDb();
  if (!db) return [];

  const { data, error } = await db.rpc("inbox_requests");
  if (error) {
    console.error("listInbox failed", error);
    return [];
  }
  return Array.isArray(data) ? (data as InboxRequest[]) : [];
}

/**
 * How many responses are still unseen — the nav badge.
 *
 * Its own RPC rather than `listInbox().length`, because the badge renders on
 * every page and would otherwise pull every message and contact detail in the
 * inbox just to count them. Degrades to 0, so a failure hides the badge instead
 * of breaking the shared nav.
 */
export async function unseenInboxCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const { data, error } = await db.rpc("inbox_unseen_count");
  if (error) {
    console.error("unseenInboxCount failed", error);
    return 0;
  }
  const n = typeof data === "number" ? data : Number(data);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Mark responses as seen. Omit `ids` to mark the whole inbox (what opening the
 * page does). Returns how many rows actually changed.
 *
 * requireCurrentUser() here is about failing loudly on a write from a signed-out
 * caller; the ownership rule itself is enforced in mark_inbox_seen, which only
 * touches rows whose post the caller owns and only rows still 'new' (so a
 * 'responded' request is never walked backwards).
 */
export async function markInboxSeen(ids?: string[]): Promise<number> {
  const { db } = await requireCurrentUser();

  const { data, error } = await db.rpc("mark_inbox_seen", {
    request_ids: ids && ids.length > 0 ? ids : null,
  });
  if (error) {
    console.error("markInboxSeen failed", error);
    return 0;
  }
  const n = typeof data === "number" ? data : Number(data);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
