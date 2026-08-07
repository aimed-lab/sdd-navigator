// lib/server/account.ts — account settings TABLE ops (session-scoped, RLS).
//
// STEP 4a: the users-table reads/writes moved verbatim from settings/page.tsx.
// All go through requireCurrentUser(), so the uid is derived from the validated session
// and RLS scopes every op to the caller — a user can only ever read/write their
// own row. Same table/columns/filters as before.
//
// Auth operations (sign in/up/out, password, deletion) are NOT here — they live
// behind the seam in lib/auth.ts.
//
// NOTIFICATIONS REMOVED: this module used to expose toggleNotification() for the
// notify_weekly / notify_daily columns. The platform sends no email digests, so
// the toggles were a control that did nothing, and they were dropped along with
// the settings panel. The COLUMNS still exist in the users table — restoring the
// feature means re-adding a writer here, not a migration.

import { requireCurrentUser } from "@/lib/auth";

export type AccountSettings = {
  name: string | null;
  affiliation: string | null;
  institution: string | null;
  country: string | null;
  is_public: boolean;
  profile_slug: string | null;
};

export type ProfileFieldPatch = Partial<
  Pick<AccountSettings, "name" | "affiliation" | "institution" | "country">
>;

// Returns the caller's row, or null when no row exists — mirroring the original
// `maybeSingle()` result so the page keeps its exact "no row → keep defaults"
// behavior (it applies the same `?? fallback` mapping either way).
export async function getAccountSettings(): Promise<AccountSettings | null> {
  const { db: supabase, user } = await requireCurrentUser();
  const { data, error } = await supabase
    .from("users")
    .select("name, affiliation, institution, country, is_public, profile_slug")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AccountSettings | null;
}

export async function updateProfileFields(patch: ProfileFieldPatch): Promise<void> {
  const { db: supabase, user } = await requireCurrentUser();
  const { error } = await supabase.from("users").update(patch).eq("id", user.id);
  if (error) throw error;
}
