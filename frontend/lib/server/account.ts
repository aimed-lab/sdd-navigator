// lib/server/account.ts — account settings TABLE ops (session-scoped, RLS).
//
// STEP 4a: the users-table reads/writes moved verbatim from settings/page.tsx.
// All go through requireUser(), so the uid is derived from the validated session
// and RLS scopes every op to the caller — a user can only ever read/write their
// own row. Same table/columns/filters as before.
//
// The auth.* calls (updateUser email/password, signOut) STAY client-side and are
// deliberately NOT represented here — they operate on the caller's own auth user
// and Supabase already enforces that. delete-account is a separate flow (its own
// /api/delete-account route) and is untouched.

import { requireUser } from "./supabaseServer";

export type AccountSettings = {
  name: string | null;
  affiliation: string | null;
  institution: string | null;
  country: string | null;
  notify_weekly: boolean;
  notify_daily: boolean;
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
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("users")
    .select("name, affiliation, institution, country, notify_weekly, notify_daily, is_public, profile_slug")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AccountSettings | null;
}

export async function updateProfileFields(patch: ProfileFieldPatch): Promise<void> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("users").update(patch).eq("id", user.id);
  if (error) throw error;
}

export async function toggleNotification(
  field: "notify_weekly" | "notify_daily",
  value: boolean,
): Promise<void> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("users")
    .update({ [field]: value })
    .eq("id", user.id);
  if (error) throw error;
}
