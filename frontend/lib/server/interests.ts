// lib/server/interests.ts — users.interests read/write (session-scoped, RLS).
//
// STEP 4a: logic moved verbatim from discovery/page.tsx. Same table/column/
// filter; the only change is that uid is derived from the validated session
// (requireUser) instead of a client-supplied id, so RLS scopes every op to the
// caller. See [[project-researcher-profiles]] for the users table shape.

import { getSession } from "@/lib/auth";
import { requireUser } from "./supabaseServer";

/**
 * The caller's interests, or [] when signed out — the read for code paths that
 * PERSONALIZE something public rather than gating it.
 *
 * getInterests() below is the editor's read and throws for a signed-out caller,
 * which is right when the answer is a form to save. The Explore feed is public:
 * signed out (or interests never set) is not an error there, it just means the
 * generic field-wide feed. Identity still comes from the validated session via
 * lib/auth.ts — never from a request body — and RLS scopes the row read.
 */
export async function getCurrentUserInterests(): Promise<string[]> {
  const session = await getSession();
  if (!session) return [];

  const { data, error } = await session.db
    .from("users")
    .select("interests")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  return Array.isArray(data?.interests) ? data.interests : [];
}

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
