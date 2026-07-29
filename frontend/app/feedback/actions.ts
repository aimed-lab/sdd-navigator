"use server";

// Server Action wrapping lib/server/feedback.ts. Every caller — the inline
// component, the empty-search auto-capture, the Collabofest form — goes
// through this rather than lib/server/feedback.ts directly, so there is one
// place that guarantees the "never throws to the user" contract even if
// submitFeedback's own try/catch is ever loosened.

import { submitFeedback, type SubmitFeedbackInput } from "@/lib/server/feedback";

export type FeedbackActionResult = { ok: boolean };

export async function submitFeedbackAction(
  input: SubmitFeedbackInput
): Promise<FeedbackActionResult> {
  try {
    const ok = await submitFeedback(input);
    return { ok };
  } catch (e) {
    console.error("submitFeedbackAction failed", e);
    return { ok: false };
  }
}
