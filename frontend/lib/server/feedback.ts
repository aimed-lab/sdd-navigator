// lib/server/feedback.ts — public.feedback writes.
//
// The whole point of this table is that it works for someone who never signs
// in and never will (Thursday's info-session traffic, hitting the site once).
// So this goes through getDb() — the request-scoped client that RLS still
// applies to when signed out — NOT requireCurrentUser(), which would throw
// for exactly the visitors this feature exists to capture.
//
// user_id is attached from the session when one exists and left null
// otherwise; it is never accepted from a caller. See
// database/migrations/2026-07-29_feedback.sql for the RLS policy (INSERT
// open to anon + authenticated, SELECT granted to nobody) and the CHECK
// constraints this mirrors client-side.

import { getCurrentUser, getDb } from "@/lib/auth";

const MAX_MESSAGE = 2000;
const MAX_EMAIL = 320;
const MAX_PAGE_PATH = 500;

export type SubmitFeedbackInput = {
  page_path: string;
  /** Nullable ON PURPOSE — an empty search records the query with no message.
   *  See the migration's header comment before making this required. */
  message?: string | null;
  context?: Record<string, unknown>;
  /** "Only if you want a reply" — never required. */
  email?: string | null;
};

/** Insert one feedback row. Returns whether it landed; NEVER throws — the
 *  page a visitor is on must keep working even if this fails. Callers (the
 *  Server Action, or the empty-search effect) do not need a try/catch of
 *  their own because of this. */
export async function submitFeedback(input: SubmitFeedbackInput): Promise<boolean> {
  try {
    const page_path = (input.page_path ?? "").trim().slice(0, MAX_PAGE_PATH);
    if (!page_path) return false;

    const db = await getDb();
    if (!db) return false;

    const message = input.message?.trim();
    const email = input.email?.trim();

    // Never trust a caller-supplied user_id — there isn't one on this input
    // type at all. Attached from the session, or left null for a signed-out
    // visitor, which is the normal case this feature is built for.
    const user = await getCurrentUser();

    const { error } = await db.from("feedback").insert({
      page_path,
      message: message ? message.slice(0, MAX_MESSAGE) : null,
      context: input.context ?? {},
      email: email ? email.slice(0, MAX_EMAIL) : null,
      user_id: user?.id ?? null,
    });

    if (error) {
      console.error("feedback insert failed", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("submitFeedback failed", e);
    return false;
  }
}
