// lib/server/interests.ts — users.interests read/write (session-scoped, RLS).
//
// STEP 4a: logic moved verbatim from discovery/page.tsx. Same table/column/
// filter; the only change is that uid is derived from the validated session
// (requireUser) instead of a client-supplied id, so RLS scopes every op to the
// caller. See [[project-researcher-profiles]] for the users table shape.

import { requireUser } from "./supabaseServer";

export async function getInterests(): Promise<string[]> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("users")
    .select("interests")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data?.interests ?? [];
}

export async function setInterests(next: string[]): Promise<void> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("users")
    .update({ interests: next })
    .eq("id", user.id);
  if (error) throw error;
}
