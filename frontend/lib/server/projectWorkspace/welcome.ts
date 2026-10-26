// lib/server/projectWorkspace/welcome.ts: the Welcome card's "Dismiss". Kept in
// public.project_welcome_dismissals (one row per project and person, 2026-10-31_
// colabofest_project_core.sql), not in the browser, so it follows the person to
// any device. Through the caller's own session: row-level security lets a person
// read and write only their own row on a project they belong to.

import { getDb } from "@/lib/auth";

/** Has this person dismissed the Welcome card on this project? A failed read
 *  counts as "not dismissed" (showing the card once more is the safe mistake). */
export async function isWelcomeDismissed(projectId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const { data, error } = await db
    .from("project_welcome_dismissals")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("isWelcomeDismissed failed", error);
    return false;
  }
  return !!data;
}

export async function dismissWelcome(projectId: string, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Service not configured." };
  const { error } = await db.from("project_welcome_dismissals").insert({ project_id: projectId, user_id: userId });
  // Already dismissed (another tab): that is the result we wanted.
  if (error && (error as { code?: string }).code !== "23505") {
    console.error("dismissWelcome failed", error);
    return { ok: false, error: "Couldn't hide that. Please try again." };
  }
  return { ok: true };
}
