"use server";

// Server Action for the /invite form. Thin: hand off to lib/server/invite.ts,
// which validates and never throws. Invite redemption is not built; requests
// are read and answered by hand from the Supabase dashboard.

import { submitInviteRequest, type SubmitInviteResult } from "@/lib/server/invite";
import type { InviteInput } from "@/lib/inviteTypes";

export async function submitInviteAction(input: InviteInput): Promise<SubmitInviteResult> {
  try {
    return await submitInviteRequest(input);
  } catch (e) {
    console.error("submitInviteAction failed", e);
    return { ok: false, error: "We couldn't save your request. Please try again." };
  }
}
