// lib/server/showcase.ts — the Promote showcase gallery.
//
// Follows lib/server/collab.ts exactly: reads go through the request-scoped
// client (public-select RLS covers signed-out browsing), writes go through
// requireCurrentUser() so owner_id comes from the validated session and never
// from a request body. RLS enforces the same rule in Postgres.
//
// AUTH: everything here goes through lib/auth.ts and never imports @supabase
// directly — see the SWAP POINT comment there.
//
// PRIVACY: owner identity is read via the showcase_owners() SECURITY DEFINER
// function, NOT a join on public.users. That table's RLS only exposes fully
// public profiles, so a plain join would render a private-profile submitter's
// card anonymous. The function returns name + affiliation only — never email.

import {
  getCurrentUser,
  getDb,
  requireCurrentUser,
  ServerConfigError,
  type Db,
} from "@/lib/auth";
import {
  SHOWCASE_TYPES,
  type CreateShowcaseInput,
  type ShowcaseEntry,
  type ShowcaseOwner,
  type ShowcaseType,
} from "@/lib/showcaseTypes";

export {
  SHOWCASE_TYPES,
  SHOWCASE_TYPE_LABEL,
  type CreateShowcaseInput,
  type ShowcaseEntry,
  type ShowcaseOwner,
  type ShowcaseType,
} from "@/lib/showcaseTypes";

export const SHOWCASE_BUCKET = "showcase-images";

const ENTRY_SELECT =
  "id, type, title, description, authors, link, image_url, tags, created_at, owner_id";

// ── normalization ────────────────────────────────────────────────────────────

const asStringArray = (v: unknown, cap = 12): string[] =>
  Array.isArray(v)
    ? Array.from(
        new Set(
          v
            .filter((x): x is string => typeof x === "string")
            .map((s) => s.trim())
            .filter(Boolean)
        )
      ).slice(0, cap)
    : [];

/** Only http(s) links are stored — a javascript:/data: URL must never reach an
 *  href the gallery renders. Returns null for anything else. */
function safeLink(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Validate an untrusted body into a CreateShowcaseInput. Returns null when a
 *  required field is missing/invalid, so a caller can answer 400 without
 *  touching the DB. */
export function parseShowcaseInput(body: unknown): CreateShowcaseInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return null;

  const type =
    typeof b.type === "string" && (SHOWCASE_TYPES as readonly string[]).includes(b.type)
      ? (b.type as ShowcaseType)
      : null;
  if (!type) return null;

  return {
    type,
    title: title.slice(0, 200),
    description: typeof b.description === "string" ? b.description.trim().slice(0, 4000) : "",
    authors: typeof b.authors === "string" ? b.authors.trim().slice(0, 400) : "",
    link: safeLink(b.link),
    tags: asStringArray(b.tags),
  };
}

/** owner_id -> public identity (name + affiliation). Degrades to an empty map so
 *  an owner-lookup failure leaves cards uncredited rather than blanking the
 *  gallery. */
async function ownerMap(db: Db): Promise<Map<string, ShowcaseOwner>> {
  const { data, error } = await db.rpc("showcase_owners");
  if (error || !Array.isArray(data)) return new Map();
  return new Map((data as ShowcaseOwner[]).map((o) => [o.id, o]));
}

function toEntry(
  row: Record<string, unknown>,
  owners: Map<string, ShowcaseOwner>,
  viewerId: string | null
): ShowcaseEntry {
  return {
    id: row.id as string,
    type: (row.type as ShowcaseType) ?? "paper",
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    authors: (row.authors as string) ?? "",
    link: (row.link as string) ?? null,
    image_url: (row.image_url as string) ?? null,
    tags: (row.tags as string[]) ?? [],
    created_at: row.created_at as string,
    owner: owners.get(row.owner_id as string) ?? null,
    // Computed here, once, from the session — NOT shipped as owner_id. The
    // client gets a yes/no per entry, never the id it'd be compared against.
    is_owner: viewerId !== null && row.owner_id === viewerId,
  };
}

// ── reads (public) ───────────────────────────────────────────────────────────

/** Browse the showcase. Public — no session required. */
export async function listShowcase(
  opts: { type?: ShowcaseType | "all" } = {}
): Promise<ShowcaseEntry[]> {
  const db = await getDb();
  if (!db) throw new ServerConfigError();

  let query = db
    .from("promote_showcase")
    .select(ENTRY_SELECT)
    .order("created_at", { ascending: false });

  if (opts.type && opts.type !== "all") query = query.eq("type", opts.type);

  const { data, error } = await query;
  if (error || !data) return [];

  const viewer = await getCurrentUser();
  const owners = await ownerMap(db);
  return (data as Record<string, unknown>[]).map((r) =>
    toEntry(r, owners, viewer?.id ?? null)
  );
}

/** One showcase entry. Null when it doesn't exist. */
export async function getShowcaseEntry(id: string): Promise<ShowcaseEntry | null> {
  const db = await getDb();
  if (!db) throw new ServerConfigError();

  const { data, error } = await db
    .from("promote_showcase")
    .select(ENTRY_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  const viewer = await getCurrentUser();
  const owners = await ownerMap(db);
  return toEntry(data as Record<string, unknown>, owners, viewer?.id ?? null);
}

// ── writes (auth-gated) ──────────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Upload an optional figure to the public showcase-images bucket and return its
 *  public URL. Returns null when there's no usable file — an image is OPTIONAL
 *  and a failed upload must never block the submission itself.
 *
 *  The object path is `<uid>/<random>.<ext>`, which is what the storage policy
 *  requires: a user may only write inside their own uid folder. */
async function uploadImage(db: Db, userId: string, file: File): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_IMAGE_BYTES) return null;
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return null;

  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${userId}/${crypto.randomUUID()}.${ext || "png"}`;

  const { error } = await db.storage
    .from(SHOWCASE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error("showcase image upload failed", error);
    return null; // submit proceeds without an image
  }

  const { data } = db.storage.from(SHOWCASE_BUCKET).getPublicUrl(path);
  return (data?.publicUrl as string) ?? null;
}

/** Create a showcase entry as the signed-in user. owner_id comes from the
 *  validated session; a caller-supplied one is ignored AND rejected by RLS.
 *  `image` is optional — omit it and image_url stays null. */
export async function createShowcaseEntry(
  input: CreateShowcaseInput,
  image?: File | null
): Promise<string> {
  const { user, db } = await requireCurrentUser();

  const image_url = image ? await uploadImage(db, user.id, image) : null;

  const { data, error } = await db
    .from("promote_showcase")
    .insert({
      owner_id: user.id,            // from the session, never the body
      type: input.type,
      title: input.title,
      description: input.description ?? "",
      authors: input.authors ?? "",
      link: input.link ?? null,
      image_url,
      tags: input.tags ?? [],
    })
    .select("id")
    .single();

  if (error || !data) throw error ?? new Error("Insert returned no row.");
  return data.id as string;
}

/** Extract the storage object path from a showcase-images public URL — the
 *  part after '.../object/public/showcase-images/', which is exactly the
 *  `<uid>/<random>.<ext>` path uploadImage() wrote it to. Null for anything
 *  that doesn't match (defensive; image_url is always ours). */
function storagePathFromUrl(url: string): string | null {
  const marker = `/object/public/${SHOWCASE_BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : url.slice(i + marker.length);
}

/** Delete a showcase entry as the signed-in user. Hard delete — same idiom as
 *  lib/server/collab.ts:deleteCollabPost (session-derived user,
 *  .delete().eq()).
 *
 *  The .eq("owner_id", user.id) here is belt-and-suspenders — the REAL gate
 *  is the promote_showcase_delete_own RLS policy (database/schema.sql),
 *  which enforces auth.uid() = owner_id in Postgres regardless of what this
 *  query claims.
 *
 *  Unlike collab_posts, nothing has a foreign key onto promote_showcase — no
 *  table cascades off it, so there is no "other people's data" to warn about
 *  the way connection_requests forces for collab_posts.
 *
 *  An uploaded figure is NOT covered by ON DELETE CASCADE — that only
 *  applies to Postgres rows, and storage.objects is a separate lifecycle
 *  entirely. Deleting the row alone would orphan the file in the
 *  showcase-images bucket forever, so this deletes the object too, using
 *  the same session (showcase_images_own_delete in schema.sql permits a
 *  user to delete objects under their own '<uid>/' folder, matching the
 *  insert policy uploadImage() relies on).
 *
 *  Ordering: the row delete happens first, with `.select("image_url")` so
 *  the same round trip both confirms deletion (RLS silently matches zero
 *  rows for someone else's entry) and returns the path to clean up. The
 *  storage removal that follows is best-effort: if it fails, the entry the
 *  user asked to remove is still gone — that's the primary action and it
 *  already succeeded — so this only logs rather than throwing. An orphaned
 *  file costs storage, not correctness; failing the whole delete here would
 *  leave a post the user asked to remove still showing on the gallery,
 *  which is worse. */
export async function deleteShowcaseEntry(entryId: string): Promise<void> {
  const { user, db } = await requireCurrentUser();

  const { data, error } = await db
    .from("promote_showcase")
    .delete()
    .eq("id", entryId)
    .eq("owner_id", user.id)
    .select("image_url")
    .maybeSingle();

  if (error) throw error;

  const imageUrl = (data?.image_url as string | null) ?? null;
  const path = imageUrl ? storagePathFromUrl(imageUrl) : null;
  if (path) {
    const { error: storageError } = await db.storage.from(SHOWCASE_BUCKET).remove([path]);
    if (storageError) {
      console.error("showcase image cleanup failed", storageError, path);
    }
  }
}
