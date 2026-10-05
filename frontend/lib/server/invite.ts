// lib/server/invite.ts — public.invite_requests writes.
//
// Works for logged-out visitors, so it goes through getDb() (request-scoped,
// RLS still applies), never requireCurrentUser(). See
// database/migrations/2026-10-04_invite_requests.sql: INSERT is open to anon +
// authenticated and there is deliberately NO SELECT policy.
//
// DO NOT chain .select() onto the insert below. INSERT ... RETURNING needs a
// passing SELECT policy, so it would fail with a 42501 RLS error. Bare
// .insert() sends Prefer: return=minimal and works. Same trap as feedback.ts.

import { getDb } from "@/lib/auth";
import {
  INVITE_INTEREST_LABELS,
  validateInvite,
  type InviteFieldErrors,
  type InviteInput,
} from "@/lib/inviteTypes";

export type SubmitInviteResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: InviteFieldErrors };

/** Validates again server-side (the client check is convenience only), then
 *  inserts one row. Never throws. */
export async function submitInviteRequest(input: InviteInput): Promise<SubmitInviteResult> {
  try {
    const fieldErrors = validateInvite(input);
    if (Object.keys(fieldErrors).length > 0) {
      return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
    }

    const db = await getDb();
    if (!db) return { ok: false, error: "Something went wrong on our side. Please try again." };

    const interests = Array.from(new Set(input.interests)).filter((i) =>
      INVITE_INTEREST_LABELS.includes(i)
    );
    const message = input.message.trim();
    const source = input.source_page.trim();

    const { error } = await db.from("invite_requests").insert({
      name: input.name.trim().slice(0, 200),
      email: input.email.trim().slice(0, 320),
      organization: input.organization.trim().slice(0, 200),
      role: input.role,
      interests,
      message: message ? message.slice(0, 2000) : null,
      source_page: source ? source.slice(0, 500) : null,
    });

    if (error) {
      console.error("invite_requests insert failed", error);
      return { ok: false, error: "We couldn't save your request. Please try again." };
    }
    return { ok: true };
  } catch (e) {
    console.error("submitInviteRequest failed", e);
    return { ok: false, error: "We couldn't save your request. Please try again." };
  }
}
