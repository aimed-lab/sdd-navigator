"use server";

// Server Action for the inbox. Same pattern as app/collaborate/actions.ts:
// through lib/server/inbox.ts, which goes through lib/auth.ts.

import { revalidatePath } from "next/cache";
import { UnauthorizedError } from "@/lib/auth";
import { markInboxSeen } from "@/lib/server/inbox";

export type MarkSeenResult = { ok: true; updated: number } | { ok: false; error: string };

/**
 * Mark responses as seen. Pass request ids for specific rows, or omit to clear
 * the whole inbox.
 *
 * The ids are NOT trusted and are not checked here — mark_inbox_seen() only
 * touches rows whose post the caller owns, so an id belonging to someone else's
 * post matches nothing and changes nothing. Nothing is leaked by trying: the
 * return value is a count, so a miss and a non-existent row are indistinguishable.
 */
export async function markSeenAction(ids?: string[]): Promise<MarkSeenResult> {
  try {
    const updated = await markInboxSeen(ids);
    revalidatePath("/inbox");
    return { ok: true, updated };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in to read your inbox." };
    }
    console.error("markSeenAction failed", e);
    return { ok: false, error: "Couldn't update those. Please try again." };
  }
}
