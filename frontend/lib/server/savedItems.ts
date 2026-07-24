// lib/server/savedItems.ts — saved_items read/write (session-scoped, RLS).
//
// STEP 4a: logic moved verbatim from discovery/page.tsx. Same table/columns/
// filters; uid comes from the validated session (requireUser), never from the
// caller, so RLS scopes every op to the owner.

import type { DiscoverItem } from "@/types/discover";
import { requireUser } from "./supabaseServer";

export type SavedItem = { item_id: string; item_data: DiscoverItem };

// Postgres unique_violation. The (user_id, item_id) unique constraint makes a
// duplicate bookmark insert a harmless no-op — the client treated it as such
// (fire-and-forget), so we preserve that: swallow it, surface anything else.
const UNIQUE_VIOLATION = "23505";

export async function listSavedItems(): Promise<SavedItem[]> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("saved_items")
    .select("item_id, item_data")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SavedItem[];
}

export async function addSavedItem(item: DiscoverItem): Promise<void> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("saved_items")
    .insert({ user_id: user.id, item_id: item.id, item_data: item });
  if (error && error.code !== UNIQUE_VIOLATION) throw error;
}

export async function removeSavedItem(itemId: string): Promise<void> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("saved_items")
    .delete()
    .eq("user_id", user.id)
    .eq("item_id", itemId);
  if (error) throw error;
}
