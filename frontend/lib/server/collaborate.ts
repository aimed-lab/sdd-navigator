// lib/server/collaborate.ts — lab resource registry ("Collaboration" feature).
//
// READ (listResources) is PUBLIC — the lab_resources SELECT policy is USING(true),
// so it runs through the anon server client. It NEVER selects contact_info; the
// public browse payload carries only the resource + a joined owner NAME (from
// public.users, which itself exposes only is_public profiles + never email).
//
// WRITE (createResource) is AUTH-GATED — it goes through requireCurrentUser() so the
// owner (owner_id) is derived from the validated session, never the caller. RLS
// (WITH CHECK auth.uid() = owner_id) then guarantees a user can only register
// resources as themselves.
//
// CONTACT (getResourceContact) is AUTH-GATED too — the ONLY path that ever returns
// contact_info. It requires a signed-in session (requireCurrentUser) but any signed-in
// user may read any resource's contact_info (the read policy is public); this is
// the owner's explicitly-chosen contact text, not their account email.

import { requireCurrentUser } from "@/lib/auth";
import { getAnonServerClient, ServerConfigError } from "./supabaseServer";

// The 8 spreadsheet categories the generic table supports. Only 'technique' has a
// UI/flow in v1; the rest are schema-ready for later forms (no schema change).
export const RESOURCE_CATEGORIES = [
  "technique",
  "equipment",
  "vector",
  "animal_model",
  "cell_line",
  "protein_antibody",
  "software",
  "drug",
] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

// The users(name) join can surface as an object or a single-element array
// depending on how PostgREST resolves the relationship (same as comments.ts).
type OwnerJoin = { name: string | null } | { name: string | null }[] | null;

function ownerName(owner: OwnerJoin): string | null {
  if (!owner) return null;
  const row = Array.isArray(owner) ? owner[0] : owner;
  return row?.name ?? null;
}

// ── Public browse (listResources) ─────────────────────────────────────────────

// One resource row for the browse grid. NO contact_info (never public); owner_name
// is the joined display name (may be null when the owner's profile isn't public).
export type ResourceCard = {
  id: string;
  category: string;
  fields: Record<string, unknown>;
  created_at: string;
  owner_name: string | null;
};

// Fetch the public registry, optionally filtered by category and a keyword search
// against fields->>'name'. Degrades to an empty list. Never selects contact_info.
export async function listResources(opts: {
  q?: string;
  category?: string;
}): Promise<ResourceCard[]> {
  const supabase = getAnonServerClient();
  if (!supabase) return [];

  let query = supabase
    .from("lab_resources")
    // owner NAME only — email is PII and is never joined here; contact_info is
    // deliberately excluded (only the auth-gated /contact route returns it).
    .select("id, category, fields, created_at, owner:users!owner_id(name)")
    .order("created_at", { ascending: false });

  if (opts.category) query = query.eq("category", opts.category);
  if (opts.q) query = query.ilike("fields->>name", `%${opts.q}%`);

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as unknown as Array<{
    id: string;
    category: string;
    fields: Record<string, unknown> | null;
    created_at: string;
    owner: OwnerJoin;
  }>).map((r) => ({
    id: r.id,
    category: r.category,
    fields: r.fields ?? {},
    created_at: r.created_at,
    owner_name: ownerName(r.owner),
  }));
}

// ── Register a resource (createResource) ──────────────────────────────────────

export type CreateResourceInput = {
  category: ResourceCategory;
  fields: Record<string, unknown>;
  contact_info: string | null;
};

// Validate + normalize an untrusted body. Returns null when the category is not
// one of the 8 known values or `fields` isn't a plain object, so the route can
// answer 400 without touching the DB. owner_id is NOT read from the body.
export function parseResourceInput(body: unknown): CreateResourceInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const category = typeof b.category === "string" ? b.category : "";
  if (!RESOURCE_CATEGORIES.includes(category as ResourceCategory)) return null;

  const fields =
    b.fields && typeof b.fields === "object" && !Array.isArray(b.fields)
      ? (b.fields as Record<string, unknown>)
      : null;
  if (!fields) return null;

  const contact_info = typeof b.contact_info === "string" ? b.contact_info.trim() : "";

  return {
    category: category as ResourceCategory,
    fields,
    contact_info: contact_info || null,
  };
}

// Insert one resource owned by the signed-in user. owner_id comes from the
// validated session (requireCurrentUser), never the input. Returns the new row id.
export async function createResource(input: CreateResourceInput): Promise<string> {
  const { db: supabase, user } = await requireCurrentUser();

  const { data, error } = await supabase
    .from("lab_resources")
    .insert({
      owner_id: user.id,
      category: input.category,
      fields: input.fields,
      contact_info: input.contact_info,
    })
    .select("id")
    .single();

  if (error || !data) throw error ?? new Error("Insert returned no row.");
  return data.id as string;
}

// ── Contact reveal (getResourceContact) ───────────────────────────────────────

export type ResourceContact = { contact_info: string | null; owner_name: string | null };

// Return ONLY the owner-chosen contact text + owner name for one resource. Auth-
// gated (requireCurrentUser) — the whole point is that contact details are visible to
// signed-in members only. Returns null when the resource doesn't exist.
export async function getResourceContact(id: string): Promise<ResourceContact | null> {
  const { db: supabase } = await requireCurrentUser();

  const { data, error } = await supabase
    .from("lab_resources")
    .select("contact_info, owner:users!owner_id(name)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as { contact_info: string | null; owner: OwnerJoin };
  return { contact_info: row.contact_info ?? null, owner_name: ownerName(row.owner) };
}

// Re-exported so route handlers can fail cleanly if the client can't be built.
export { ServerConfigError };
