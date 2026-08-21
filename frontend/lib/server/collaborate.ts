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
// resources as themselves. When the resource is tagged with a community_id, RLS
// additionally requires either an open community or a community_members row
// (see database/migrations/2026-08-20_communities.sql, can_post_to_community()) —
// this module doesn't re-check that client-side; a forged community_id on a
// closed community a caller doesn't belong to is rejected by Postgres, not here.
//
// CONTACT (getResourceContact) is AUTH-GATED too — the ONLY path that ever returns
// contact_info. It requires a signed-in session (requireCurrentUser) but any signed-in
// user may read any resource's contact_info (the read policy is public); this is
// the owner's explicitly-chosen contact text, not their account email.

import { requireCurrentUser } from "@/lib/auth";
import { getAnonServerClient, ServerConfigError } from "./supabaseServer";

// Types + constants live in lib/collaborateTypes.ts so "use client" components
// (the new-resource form) can import the VALUES (RESOURCE_CATEGORIES,
// CATEGORY_LABELS, CATEGORY_FIELDS) without pulling this server-only module —
// and its `next/headers` dependency — into the client bundle. Re-exported here
// so server callers have one import.
import {
  CATEGORY_FIELDS,
  CATEGORY_LABELS,
  RESOURCE_CATEGORIES,
  type CreateResourceInput,
  type FieldSpec,
  type ResourceCard,
  type ResourceCategory,
} from "@/lib/collaborateTypes";

export {
  CATEGORY_FIELDS,
  CATEGORY_LABELS,
  RESOURCE_CATEGORIES,
  type CreateResourceInput,
  type FieldSpec,
  type ResourceCard,
  type ResourceCategory,
} from "@/lib/collaborateTypes";

// The users(name) join can surface as an object or a single-element array
// depending on how PostgREST resolves the relationship (same as comments.ts).
type OwnerJoin = { name: string | null } | { name: string | null }[] | null;

function ownerName(owner: OwnerJoin): string | null {
  if (!owner) return null;
  const row = Array.isArray(owner) ? owner[0] : owner;
  return row?.name ?? null;
}

// ── Public browse (listResources) ─────────────────────────────────────────────

// Fetch the public registry, optionally filtered by category, a keyword search
// against fields->>'name', and a community. Degrades to an empty list. Never
// selects contact_info.
export async function listResources(opts: {
  q?: string;
  category?: string;
  communityId?: string;
}): Promise<ResourceCard[]> {
  const supabase = getAnonServerClient();
  if (!supabase) return [];

  let query = supabase
    .from("lab_resources")
    // owner NAME only — email is PII and is never joined here; contact_info is
    // deliberately excluded (only the auth-gated /contact route returns it).
    .select("id, category, fields, created_at, community_id, owner:users!owner_id(name)")
    .order("created_at", { ascending: false });

  if (opts.category) query = query.eq("category", opts.category);
  if (opts.q) query = query.ilike("fields->>name", `%${opts.q}%`);
  if (opts.communityId) query = query.eq("community_id", opts.communityId);

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as unknown as Array<{
    id: string;
    category: string;
    fields: Record<string, unknown> | null;
    created_at: string;
    community_id: string | null;
    owner: OwnerJoin;
  }>).map((r) => ({
    id: r.id,
    category: r.category,
    fields: r.fields ?? {},
    created_at: r.created_at,
    community_id: r.community_id ?? null,
    owner_name: ownerName(r.owner),
  }));
}

// ── Register a resource (createResource) ──────────────────────────────────────

// Validate + normalize an untrusted body. Returns null when the category is not
// one of the 8 known values, `fields` isn't a plain object, or "name" (the one
// field required across every category) is blank — so the route/action can
// answer without touching the DB. owner_id is NOT read from the body.
export function parseResourceInput(body: unknown): CreateResourceInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const category = typeof b.category === "string" ? b.category : "";
  if (!RESOURCE_CATEGORIES.includes(category as ResourceCategory)) return null;

  const rawFields =
    b.fields && typeof b.fields === "object" && !Array.isArray(b.fields)
      ? (b.fields as Record<string, unknown>)
      : null;
  if (!rawFields) return null;

  const name = typeof rawFields.name === "string" ? rawFields.name.trim() : "";
  if (!name) return null;

  // Rebuild `fields` from the known spec for this category (+ name, + the
  // optional lab), so an arbitrary client body can't smuggle unrelated keys
  // into the jsonb column. Every field here is OPTIONAL except name.
  const fields: Record<string, unknown> = { name: name.slice(0, 200) };

  const pi_lab = typeof rawFields.pi_lab === "string" ? rawFields.pi_lab.trim() : "";
  if (pi_lab) fields.pi_lab = pi_lab.slice(0, 200);

  const specs: FieldSpec[] = CATEGORY_FIELDS[category as ResourceCategory] ?? [];
  for (const spec of specs) {
    const raw = rawFields[spec.key];
    if (spec.kind === "boolean") {
      if (typeof raw === "boolean") fields[spec.key] = raw;
    } else {
      if (typeof raw === "string" && raw.trim()) fields[spec.key] = raw.trim().slice(0, 500);
    }
  }

  const contact_info = typeof b.contact_info === "string" ? b.contact_info.trim() : "";

  const community_id =
    typeof b.community_id === "string" && b.community_id.trim() ? b.community_id.trim() : null;

  return {
    category: category as ResourceCategory,
    fields,
    contact_info: contact_info || null,
    community_id,
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
      community_id: input.community_id ?? null,
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
