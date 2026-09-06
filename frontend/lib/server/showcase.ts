// lib/server/showcase.ts — the Promote showcase gallery + the unified
// /promote/submit article flow (paste a DOI, generate, edit, attach media,
// publish — or go manual and skip generation, same downstream steps).
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
import { getAnonServerClient } from "@/lib/server/supabaseServer";
import type { ArticleEditorEntry } from "@/components/promote/ArticleEditor";
import {
  SHOWCASE_TYPES,
  type ArticleDraftPatch,
  type CreateArticleInput,
  type MediaKind,
  type PublicArticle,
  type ShowcaseEntry,
  type ShowcaseMedia,
  type ShowcaseOwner,
  type ShowcaseType,
} from "@/lib/showcaseTypes";

export {
  SHOWCASE_TYPES,
  SHOWCASE_TYPE_LABEL,
  type ShowcaseEntry,
  type ShowcaseOwner,
  type ShowcaseType,
} from "@/lib/showcaseTypes";

const ENTRY_SELECT =
  "id, type, title, headline, standfirst, article_body, slug, description, authors, link, image_url, journal, tags, created_at, published_at, owner_id";

function toEntry(
  row: Record<string, unknown>,
  owners: Map<string, ShowcaseOwner>,
  viewerId: string | null,
  heroImages: Map<string, string>
): ShowcaseEntry {
  return {
    id: row.id as string,
    type: (row.type as ShowcaseType) ?? "paper",
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    authors: (row.authors as string) ?? "",
    link: (row.link as string) ?? null,
    image_url: (row.image_url as string) ?? null,
    journal: (row.journal as string | null) ?? null,
    tags: (row.tags as string[]) ?? [],
    created_at: row.created_at as string,
    owner: owners.get(row.owner_id as string) ?? null,
    // Computed here, once, from the session — NOT shipped as owner_id. The
    // client gets a yes/no per entry, never the id it'd be compared against.
    is_owner: viewerId !== null && row.owner_id === viewerId,
    slug: (row.slug as string) || null,
    headline: (row.headline as string) || "",
    standfirst: (row.standfirst as string) ?? "",
    articleBody: (row.article_body as string) ?? "",
    publishedAt: (row.published_at as string | null) ?? null,
    // Attached media wins over the legacy column — see the field's own
    // comment in showcaseTypes.ts for why this can't be re-derived client-side.
    heroImageUrl: heroImages.get(row.id as string) ?? (row.image_url as string | null) ?? null,
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

/** showcase_id -> a freshly SIGNED URL for that entry's first attached
 *  `image`-kind media (earliest by created_at), for the gallery card. Signed
 *  URLs expire (10 minutes — SIGNED_URL_TTL_SECONDS below), so this must be
 *  called on every request that renders the gallery, same as the article
 *  page's own heroImage() — never cached/stored, and listShowcase's caller
 *  (app/promote/page.tsx) is already `force-dynamic` for exactly this reason.
 *
 *  One query for every entry's candidate images, not one query per entry:
 *  a gallery page rendering N cards would otherwise be N+1 round trips to
 *  find just the first image each. Grouping/picking "first per showcase_id"
 *  happens here in JS rather than in SQL (no DISTINCT ON via supabase-js)
 *  since a gallery page is at most a few dozen rows — cheap either way. */
async function getShowcaseHeroImages(
  db: Db,
  showcaseIds: string[]
): Promise<Map<string, string>> {
  if (showcaseIds.length === 0) return new Map();

  const { data, error } = await db
    .from("promote_showcase_media")
    .select("showcase_id, url, created_at")
    .in("showcase_id", showcaseIds)
    .eq("kind", "image")
    .order("created_at", { ascending: true });
  if (error || !data) return new Map();

  const firstPathByEntry = new Map<string, string>();
  for (const row of data as Record<string, unknown>[]) {
    const id = row.showcase_id as string;
    if (!firstPathByEntry.has(id)) firstPathByEntry.set(id, row.url as string);
  }

  const signed = new Map<string, string>();
  await Promise.all(
    Array.from(firstPathByEntry.entries()).map(async ([id, path]) => {
      try {
        signed.set(id, await signMediaPath(db, path));
      } catch {
        // Unsignable/orphaned path — the card falls back to image_url (or
        // the placeholder), same degrade listShowcaseMedia uses per-row.
      }
    })
  );
  return signed;
}

// ── reads (public) ───────────────────────────────────────────────────────────
//
// The gallery only ever shows PUBLISHED rows — a draft-in-progress from the
// unified submit flow must not appear here before its author publishes it.
// promote_showcase_select_published RLS would already exclude another
// owner's draft, but a signed-in AUTHOR reading their OWN draft would still
// pass promote_showcase_select_own — the explicit .eq("published", true)
// below is what keeps the gallery itself showing only finished entries even
// to the person who's still editing one.

/** Browse the showcase. Public — no session required. */
export async function listShowcase(
  opts: { type?: ShowcaseType | "all" } = {}
): Promise<ShowcaseEntry[]> {
  const db = await getDb();
  if (!db) throw new ServerConfigError();

  let query = db
    .from("promote_showcase")
    .select(ENTRY_SELECT)
    .eq("published", true)
    .order("created_at", { ascending: false });

  if (opts.type && opts.type !== "all") query = query.eq("type", opts.type);

  const { data, error } = await query;
  if (error || !data) return [];

  const rows = data as Record<string, unknown>[];
  const viewer = await getCurrentUser();
  const [owners, heroImages] = await Promise.all([
    ownerMap(db),
    getShowcaseHeroImages(db, rows.map((r) => r.id as string)),
  ]);
  return rows.map((r) => toEntry(r, owners, viewer?.id ?? null, heroImages));
}

/** One PUBLISHED showcase entry. Null when it doesn't exist or isn't
 *  published. Currently unused by any route (the gallery links straight to
 *  /promote/[slug] for anything that has one) but kept for a future
 *  id-based lookup; scoped to published for the same reason listShowcase is. */
export async function getShowcaseEntry(id: string): Promise<ShowcaseEntry | null> {
  const db = await getDb();
  if (!db) throw new ServerConfigError();

  const { data, error } = await db
    .from("promote_showcase")
    .select(ENTRY_SELECT)
    .eq("id", id)
    .eq("published", true)
    .maybeSingle();

  if (error || !data) return null;
  const viewer = await getCurrentUser();
  const [owners, heroImages] = await Promise.all([
    ownerMap(db),
    getShowcaseHeroImages(db, [data.id as string]),
  ]);
  return toEntry(data as Record<string, unknown>, owners, viewer?.id ?? null, heroImages);
}

// ── article draft (create/edit/publish) ─────────────────────────────────────
//
// A row here starts life PRIVATE (published defaults to false) and gets a
// `slug` so it has a page at /promote/[slug] once published. The generator
// route itself (/api/promote/generate) writes nothing; these functions are
// what app/promote/actions.ts calls for every entry now, DOI-sourced or
// manual alike — there is only one creation path since the submit-flow
// merge, not a separate "generated article" vs. "manual showcase entry".

/** "Some Title, With Punctuation!" -> "some-title-with-punctuation". Falls
 *  back to "article" if the title has no latin/digit characters left after
 *  stripping (e.g. an all-symbols or non-latin title). */
function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents (combining diacritical marks)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base || "article";
}

/** Short random suffix appended on a slug collision — not meant to be
 *  memorable, just enough entropy that a second retry essentially never
 *  collides again. */
function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

/** Create a new article draft as the signed-in user. owner_id comes from the
 *  session, published starts false (the column default), and the slug is
 *  derived from the title with a short random suffix appended on collision —
 *  retried a few times against the unique index (idx_promote_showcase_slug)
 *  rather than pre-checking existence, which would be a race under
 *  concurrent submissions of the same title. */
export async function createArticleEntry(
  input: CreateArticleInput
): Promise<{ id: string; slug: string }> {
  const { user, db } = await requireCurrentUser();
  const base = slugifyTitle(input.title || input.headline);

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomSlugSuffix()}`;

    const { data, error } = await db
      .from("promote_showcase")
      .insert({
        owner_id: user.id, // from the session, never the body
        type: input.type,
        title: input.title,
        headline: input.headline,
        standfirst: input.standfirst,
        article_body: input.articleBody,
        authors: input.authors ?? "",
        doi: input.doi ?? null,
        link: input.link ?? null,
        journal: input.journal ?? null,
        slug,
        // published intentionally omitted -> column default (false): a
        // freshly created draft is private until publishArticle().
      })
      .select("id, slug")
      .single();

    if (!error && data) return { id: data.id as string, slug: data.slug as string };
    // 23505 = unique_violation. Only the slug index can collide here (id is a
    // fresh gen_random_uuid()) — retry with a new suffix rather than failing
    // the whole submission over a title someone already used.
    if (error?.code !== "23505") throw error ?? new Error("Insert returned no row.");
  }
  throw new Error("Couldn't generate a unique link for this article. Please try again.");
}

/** Edit a draft (or a published article) as its owner. Only the fields
 *  present in `patch` are touched. The .eq("owner_id", user.id) here is
 *  belt-and-suspenders — the real gate is promote_showcase_update_own RLS. */
export async function updateArticleEntry(id: string, patch: ArticleDraftPatch): Promise<void> {
  const { user, db } = await requireCurrentUser();

  const update: Record<string, unknown> = {};
  if (patch.type !== undefined) update.type = patch.type;
  if (patch.headline !== undefined) update.headline = patch.headline;
  if (patch.standfirst !== undefined) update.standfirst = patch.standfirst;
  if (patch.articleBody !== undefined) update.article_body = patch.articleBody;
  if (patch.authors !== undefined) update.authors = patch.authors;
  if (patch.doi !== undefined) update.doi = patch.doi;
  if (patch.link !== undefined) update.link = patch.link;
  if (patch.journal !== undefined) update.journal = patch.journal;
  if (Object.keys(update).length === 0) return;

  const { error } = await db
    .from("promote_showcase")
    .update(update)
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) throw error;
}

/** Thrown by setArticlePublished when a draft has no headline/body yet.
 *  ArticleEditor already disables its Publish button for this case — this
 *  is the server-side half of that guard, since createArticleDraftAction
 *  deliberately allows creating a blank draft (see its own comment) so the
 *  Media uploader has a row to attach to before any text is written. An
 *  empty draft becoming a public article is a content-quality bug, not an
 *  access-control one, but it's still not something a direct call to this
 *  action should be able to do just because the UI wouldn't let you click
 *  the button. */
export class EmptyArticleError extends Error {
  constructor(message = "Add a headline and body before publishing.") {
    super(message);
    this.name = "EmptyArticleError";
  }
}

/** Flip published on/off as the owner. Nothing is public until this has been
 *  called with `true` — see promote_showcase_select_published in RLS, which
 *  is the actual enforcement; this update just flips the flag it reads.
 *
 *  Publishing also stamps `published_at` to now() — this is what the
 *  article page's date line reads, not `created_at` (when the draft was
 *  started). Unpublishing leaves it as-is rather than clearing it, so
 *  re-publishing later reflects the most recent publish, not a fresh
 *  "first ever" date; that's an acceptable simplification for now. */
export async function setArticlePublished(id: string, published: boolean): Promise<void> {
  const { user, db } = await requireCurrentUser();

  if (published) {
    const { data } = await db
      .from("promote_showcase")
      .select("headline, article_body")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    const hasContent = Boolean(
      (data?.headline as string | undefined)?.trim() &&
        (data?.article_body as string | undefined)?.trim()
    );
    if (!hasContent) throw new EmptyArticleError();
  }

  const { error } = await db
    .from("promote_showcase")
    .update(published ? { published, published_at: new Date().toISOString() } : { published })
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) throw error;
}

/** Delete a showcase entry as the signed-in user. Hard delete — same idiom as
 *  lib/server/collab.ts:deleteCollabPost (session-derived user, .delete().eq()).
 *
 *  The .eq("owner_id", user.id) here is belt-and-suspenders — the REAL gate
 *  is the promote_showcase_delete_own RLS policy, which enforces
 *  auth.uid() = owner_id in Postgres regardless of what this query claims.
 *
 *  promote_showcase_media rows cascade automatically (ON DELETE CASCADE on
 *  showcase_id) but their storage objects are a separate lifecycle from the
 *  Postgres row, so this fetches their paths FIRST and removes them from
 *  showcase-media after the row delete succeeds — mirroring the single-image
 *  cleanup this function used to do for image_url, just for N files instead
 *  of one. Best-effort: a storage cleanup failure only logs, since the
 *  primary action (removing the entry) already succeeded and failing the
 *  whole delete over an orphaned file would be worse. */
export async function deleteShowcaseEntry(entryId: string): Promise<void> {
  const { user, db } = await requireCurrentUser();

  const { data: mediaRows } = await db
    .from("promote_showcase_media")
    .select("url")
    .eq("showcase_id", entryId)
    .eq("owner_id", user.id);

  const { data, error } = await db
    .from("promote_showcase")
    .delete()
    .eq("id", entryId)
    .eq("owner_id", user.id)
    .select("image_url")
    .maybeSingle();

  if (error) throw error;

  const mediaPaths = (mediaRows ?? [])
    .map((r: Record<string, unknown>) => r.url as string)
    .filter(Boolean);
  if (mediaPaths.length > 0) {
    const { error: mediaCleanupError } = await db.storage
      .from(SHOWCASE_MEDIA_BUCKET)
      .remove(mediaPaths);
    if (mediaCleanupError) {
      console.error("showcase media cleanup failed", mediaCleanupError, mediaPaths);
    }
  }

  // Legacy image_url cleanup (pre-media-table rows created via the old
  // manual submit form, which used the public showcase-images bucket).
  const imageUrl = (data?.image_url as string | null) ?? null;
  if (imageUrl) {
    const marker = "/object/public/showcase-images/";
    const i = imageUrl.indexOf(marker);
    const path = i === -1 ? null : imageUrl.slice(i + marker.length);
    if (path) {
      const { error: imgErr } = await db.storage.from("showcase-images").remove([path]);
      if (imgErr) console.error("legacy showcase image cleanup failed", imgErr, path);
    }
  }
}

// ── media attachments ────────────────────────────────────────────────────────
//
// Multiple files per article (images, slide decks), stored in the PRIVATE
// showcase-media bucket at `<showcase_id>/<uuid>.<ext>` — the article's own
// id as the folder, not the uploader's uid, which is what lets the storage
// RLS policies key off promote_showcase.published (see the 2026-09-06
// migrations). Every read mints a fresh signed URL; nothing here is ever a
// stable/public link.

export const SHOWCASE_MEDIA_BUCKET = "showcase-media";

const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50 MB — a routine slide deck is 20-50 MB
const MEDIA_MIME_KIND: Record<string, MediaKind> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "image",
  "application/pdf": "slides",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "slides", // .pptx
};

const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 minutes, matches lib/server/projects.ts's proposal-file convention

/** Mint a short-lived signed URL for one object path. Throws if the calling
 *  client's role can't pass the bucket's SELECT policy for that path (an
 *  owner-only draft file requested by the anon client, for instance) — RLS
 *  is what actually decides this, not this function. */
async function signMediaPath(db: Db, path: string): Promise<string> {
  const { data, error } = await db.storage
    .from(SHOWCASE_MEDIA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw error ?? new Error("Couldn't sign the media URL.");
  return data.signedUrl;
}

/** List a showcase's attached media as signed URLs. Used both by the owner's
 *  own editor (called with the session client — covered by the "own" RLS
 *  policies) and by the public article page (called with the ANON client —
 *  covered by the "parent is published" policies). Same function either
 *  way; Postgres RLS on both promote_showcase_media and storage.objects
 *  decides what the given client is actually allowed to see and sign. */
export async function listShowcaseMedia(db: Db, showcaseId: string): Promise<ShowcaseMedia[]> {
  const { data, error } = await db
    .from("promote_showcase_media")
    .select("id, kind, url, filename, size_bytes")
    .eq("showcase_id", showcaseId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];

  const withUrls = await Promise.all(
    (data as Record<string, unknown>[]).map(async (row) => {
      try {
        return {
          id: row.id as string,
          kind: row.kind as MediaKind,
          filename: row.filename as string,
          sizeBytes: row.size_bytes as number,
          url: await signMediaPath(db, row.url as string),
        };
      } catch {
        return null; // an unsignable/orphaned row is dropped, not fatal to the list
      }
    })
  );
  return withUrls.filter((m): m is ShowcaseMedia => m !== null);
}

/** Attach one file to a showcase entry as its owner. Validates type/size in
 *  app code (belt-and-suspenders on top of the bucket's own
 *  allowed_mime_types/file_size_limit) and throws with a message the caller
 *  can show directly — unlike the old single-image uploadImage(), a failed
 *  attachment here is a real error the user needs to see and retry, not a
 *  silent "proceed without it" (there's no equivalent optional-image
 *  fallback once the user has explicitly chosen a file to attach). */
export async function addShowcaseMedia(showcaseId: string, file: File): Promise<ShowcaseMedia> {
  const { user, db } = await requireCurrentUser();

  const kind = MEDIA_MIME_KIND[file.type];
  if (!file || file.size === 0) throw new Error("No file selected.");
  if (!kind) throw new Error("Use PNG, JPEG, WebP, GIF, PDF or PPTX.");
  if (file.size > MAX_MEDIA_BYTES) throw new Error("File must be under 50 MB.");

  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${showcaseId}/${crypto.randomUUID()}.${ext || "bin"}`;

  const { error: uploadError } = await db.storage
    .from(SHOWCASE_MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await db
    .from("promote_showcase_media")
    .insert({
      showcase_id: showcaseId,
      owner_id: user.id, // from the session, never the body
      kind,
      url: path, // the storage PATH — see the field comment in the migration
      filename: file.name.slice(0, 200),
      size_bytes: file.size,
    })
    .select("id, kind, filename, size_bytes")
    .single();

  if (error || !data) {
    // Roll back the just-uploaded object rather than leaving an orphan the
    // owner can never see or remove (it has no DB row to list it by).
    await db.storage.from(SHOWCASE_MEDIA_BUCKET).remove([path]);
    throw error ?? new Error("Couldn't save the attachment. Please try again.");
  }

  return {
    id: data.id as string,
    kind: data.kind as MediaKind,
    filename: data.filename as string,
    sizeBytes: data.size_bytes as number,
    url: await signMediaPath(db, path),
  };
}

/** Remove one attached file as the showcase's owner. */
export async function removeShowcaseMedia(showcaseId: string, mediaId: string): Promise<void> {
  const { user, db } = await requireCurrentUser();

  const { data, error } = await db
    .from("promote_showcase_media")
    .delete()
    .eq("id", mediaId)
    .eq("showcase_id", showcaseId)
    .eq("owner_id", user.id)
    .select("url")
    .maybeSingle();
  if (error) throw error;

  const path = (data?.url as string) ?? null;
  if (path) {
    const { error: rmErr } = await db.storage.from(SHOWCASE_MEDIA_BUCKET).remove([path]);
    if (rmErr) console.error("showcase media cleanup failed", rmErr, path);
  }
}

// ── public article page ──────────────────────────────────────────────────────

const PUBLIC_ARTICLE_SELECT =
  "id, slug, headline, standfirst, article_body, title, authors, doi, link, journal, image_url, created_at, published_at";

/** Look up a PUBLISHED article by slug, for the public /promote/[slug] page.
 *
 *  Uses the ANON client deliberately, not getDb()/the session client — this
 *  route has no signed-in "viewer" concept, and reading through the session
 *  client here would mean a signed-in owner browsing their own draft's URL
 *  in another tab could see it render as if it were public, when the actual
 *  guarantee needs to hold for every visitor including a fully signed-out
 *  one. The `.eq("published", true)` below is belt-and-suspenders, same
 *  idiom as the owner_id checks elsewhere in this file — the real gate is
 *  the promote_showcase_select_published RLS policy, which the anon client
 *  is subject to like any other unauthenticated reader. Attached media is
 *  read through the SAME anon client, so a draft's still-private files stay
 *  unsignable here even if this query somehow returned one. */
export async function getPublishedArticleBySlug(slug: string): Promise<PublicArticle | null> {
  const anon = getAnonServerClient();
  if (!anon) throw new ServerConfigError();

  const { data, error } = await anon
    .from("promote_showcase")
    .select(PUBLIC_ARTICLE_SELECT)
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();

  if (error || !data) return null;

  const media = await listShowcaseMedia(anon, data.id as string);

  return {
    slug: data.slug as string,
    headline: (data.headline as string) || (data.title as string),
    standfirst: (data.standfirst as string) ?? "",
    articleBody: (data.article_body as string) ?? "",
    title: data.title as string,
    authors: (data.authors as string) ?? "",
    doi: (data.doi as string | null) ?? null,
    link: (data.link as string | null) ?? null,
    journal: (data.journal as string | null) ?? null,
    image_url: (data.image_url as string | null) ?? null,
    media,
    created_at: data.created_at as string,
    publishedAt: (data.published_at as string | null) ?? null,
  };
}

/** Is the signed-in viewer this article's owner? Used by the public article
 *  page ONLY to decide whether to render an "Edit" link — never to gate the
 *  edit page itself (getOwnedArticleForEdit below does that, independently,
 *  since a link being hidden is not the same thing as a route being
 *  protected). Signed out or no such slug both come back false, same
 *  outcome either way from the caller's point of view. */
export async function isOwnerOfShowcase(slug: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;

  const db = await getDb();
  if (!db) return false;

  const { data, error } = await db
    .from("promote_showcase")
    .select("owner_id")
    .eq("slug", slug)
    .maybeSingle();

  return !error && data?.owner_id === user.id;
}

// ── edit route (owner only) ─────────────────────────────────────────────────

export type OwnedArticleForEdit = {
  entry: ArticleEditorEntry;
  media: ShowcaseMedia[];
};

/** Look up ANY (draft or published) showcase entry by slug for its owner to
 *  edit — app/promote/[slug]/edit/page.tsx. Returns null for a signed-out
 *  visitor, an unknown slug, or a slug that exists but belongs to someone
 *  else, so the caller can 404 uniformly across all three — "not found" and
 *  "not yours" must look identical from the outside, or the URL becomes a
 *  probe for which slugs exist and who owns them.
 *
 *  Deliberately does NOT reuse getPublishedArticleBySlug: that function is
 *  published-only and anon-client-only by design (the public page), neither
 *  of which is right here — an unpublished draft is exactly what this needs
 *  to find, and doing that through the session client (not anon) is what
 *  lets promote_showcase_select_own even see it. The .eq check against
 *  owner_id below is still required on top of RLS: RLS's OTHER policy
 *  (promote_showcase_select_published) would happily hand back someone
 *  ELSE'S already-published article to any signed-in reader, which is
 *  correct for the public page but must not be treated as "yours to edit"
 *  here. */
export async function getOwnedArticleForEdit(slug: string): Promise<OwnedArticleForEdit | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const db = await getDb();
  if (!db) throw new ServerConfigError();

  const { data, error } = await db
    .from("promote_showcase")
    .select("id, slug, type, headline, standfirst, article_body, authors, published, owner_id")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data || data.owner_id !== user.id) return null;

  const media = await listShowcaseMedia(db, data.id as string);

  return {
    entry: {
      id: data.id as string,
      slug: data.slug as string,
      published: Boolean(data.published),
      type: data.type as ShowcaseType,
      headline: (data.headline as string) ?? "",
      standfirst: (data.standfirst as string) ?? "",
      articleBody: (data.article_body as string) ?? "",
      authors: (data.authors as string) ?? "",
    },
    media,
  };
}
