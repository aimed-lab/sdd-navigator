// lib/server/collab.ts — the Collaborate board (haves/needs posts + responses).
//
// A post carries BOTH what a lab can offer (`haves`) and what it is looking for
// (`needs`); either may be empty, and the pairing is the feature.
//
// AUTH: this module goes through lib/auth.ts and never imports @supabase
// directly — see the SWAP POINT comment there. Reads use the request-scoped
// client (public-select RLS covers signed-out browsing); writes go through
// requireCurrentUser(), so owner/requester ids come from the validated session
// and never from a request body. RLS enforces the same rule in Postgres.
//
// PRIVACY: owner joins select name/affiliation/institution/profile_slug ONLY.
// `email` is never selected here, in any query.

import {
  getCurrentUser,
  getDb,
  requireCurrentUser,
  ServerConfigError,
  type Db,
} from "@/lib/auth";

// Types + constants live in lib/collabTypes.ts so that "use client" components
// can import the VALUES (STAGES, INTEREST_TYPES) without pulling this
// server-only module — and its `next/headers` dependency — into the client
// bundle. Re-exported here so server callers have one import.
import {
  CONTACT_MAX,
  FUNDING_STATUSES,
  INTEREST_TYPES,
  STAGES,
  type CollabOwner,
  type CollabPost,
  type CreateCollabPostInput,
  type FundingStatus,
  type InterestType,
  type Stage,
} from "@/lib/collabTypes";

export {
  FUNDING_STATUSES,
  INTEREST_TYPES,
  STAGES,
  type BoardFilter,
  type CollabOwner,
  type CollabPost,
  type CreateCollabPostInput,
  type FundingStatus,
  type InterestType,
  type Stage,
} from "@/lib/collabTypes";

import type { BoardFilter } from "@/lib/collabTypes";

// Owners are NOT joined from public.users. That table's RLS is
// `SELECT USING (is_public = true)`, so a plain join returns NULL for any poster
// whose profile isn't public and their card renders anonymous — wrong for an
// attributed board. Instead we read collab_post_owners(), a SECURITY DEFINER
// function that returns name/affiliation/institution for anyone who has posted,
// and profile_slug ONLY when their profile is public. See
// database/migrations/2026-07-26_collab_post_owners.sql.
//
// Posting identifies you by name; it does not publish your profile.
const POST_SELECT =
  "id, title, description, research_areas, haves, needs, stage, funding_status, created_at, owner_id";

// ── normalization ────────────────────────────────────────────────────────────

const asStringArray = (v: unknown, cap = 24): string[] =>
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

/** Validate an untrusted body into a CreateCollabPostInput. Returns null when
 *  `title` is missing, so a route can answer 400 without touching the DB. */
export function parseCollabPostInput(body: unknown): CreateCollabPostInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return null;

  const stage = typeof b.stage === "string" && (STAGES as readonly string[]).includes(b.stage)
    ? (b.stage as Stage)
    : "concept";

  // Optional and nullable — anything not one of the three real values
  // (missing, empty string from an unselected <select>, garbage) becomes
  // null, i.e. "unspecified". Never defaulted to a real status: unlike
  // `stage`, there is no correct default here for a poster who didn't say.
  const funding_status =
    typeof b.funding_status === "string" &&
    (FUNDING_STATUSES as readonly string[]).includes(b.funding_status)
      ? (b.funding_status as FundingStatus)
      : null;

  // A plain string, opaque to this layer — not validated as "belongs to a
  // project this caller is a member of" here. That's fine: the only thing
  // it grants is a FK link on the CALLER'S OWN post, and checklist_items'
  // own RLS still gates who can ever read/write the item itself. Forging
  // an arbitrary id here just gives your own post a dangling/irrelevant
  // link, nothing more.
  const checklist_item_id =
    typeof b.checklist_item_id === "string" && b.checklist_item_id.trim()
      ? b.checklist_item_id.trim()
      : null;

  return {
    title: title.slice(0, 200),
    description: typeof b.description === "string" ? b.description.trim().slice(0, 4000) : "",
    research_areas: asStringArray(b.research_areas),
    haves: asStringArray(b.haves),
    needs: asStringArray(b.needs),
    stage,
    funding_status,
    checklist_item_id,
  };
}

/** owner_id -> public identity, from the SECURITY DEFINER function. Degrades to
 *  an empty map so an owner-lookup failure leaves cards unattributed rather than
 *  blanking the board. */
async function ownerMap(db: Db): Promise<Map<string, CollabOwner>> {
  const { data, error } = await db.rpc("collab_post_owners");
  if (error || !Array.isArray(data)) return new Map();
  return new Map(
    (data as CollabOwner[]).map((o) => [o.id, o])
  );
}

/** Post-level interest counts, via the SECURITY DEFINER aggregate function.
 *  connection_requests SELECT is own-rows-only, so counting cannot be done with
 *  a normal query — the function exposes counts and nothing else. Degrades to an
 *  empty map so a counting failure never blanks the board. */
async function interestCounts(db: Db): Promise<Map<string, number>> {
  const { data, error } = await db.rpc("collab_post_interest_counts");
  if (error || !Array.isArray(data)) return new Map();
  return new Map(
    data.map((r: { post_id: string; interested: number }) => [
      r.post_id,
      Number(r.interested) || 0,
    ])
  );
}

// ── reads (public) ───────────────────────────────────────────────────────────

/** Browse the board. Public — no session required.
 *
 *  `filter`:
 *    offering           — posts that offer something (haves non-empty)
 *    seeking_resources  — posts that need something (needs non-empty)
 *    seeking_team       — posts at the 'seeking_team' stage
 *    all                — everything
 *  A post with both haves and needs matches BOTH offering and seeking_resources,
 *  which is intended: it genuinely is both.
 */
export async function listCollabPosts(opts: {
  q?: string;
  area?: string;
  filter?: BoardFilter;
} = {}): Promise<CollabPost[]> {
  const db = await getDb();
  if (!db) throw new ServerConfigError();

  let query = db.from("collab_posts").select(POST_SELECT).order("created_at", { ascending: false });

  const filter = opts.filter ?? "all";
  // Postgres array length via the cardinality of the column — expressed with
  // PostgREST's `not.eq` on the empty array literal.
  if (filter === "offering") query = query.not("haves", "eq", "{}");
  else if (filter === "seeking_resources") query = query.not("needs", "eq", "{}");
  else if (filter === "seeking_team") query = query.eq("stage", "seeking_team");

  if (opts.area?.trim()) query = query.contains("research_areas", [opts.area.trim()]);

  const q = opts.q?.trim();
  if (q) {
    // Title/description free-text. Commas break PostgREST's or() grammar.
    const safe = q.replace(/[,()]/g, " ").trim();
    if (safe) query = query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  // Computed here, once, from the session — NOT shipped as owner_id. The
  // client gets a yes/no per post, never the id it'd be compared against.
  const viewer = await getCurrentUser();

  const [counts, owners] = await Promise.all([interestCounts(db), ownerMap(db)]);
  return (data as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    research_areas: (row.research_areas as string[]) ?? [],
    haves: (row.haves as string[]) ?? [],
    needs: (row.needs as string[]) ?? [],
    stage: (row.stage as Stage) ?? "concept",
    funding_status: (row.funding_status as FundingStatus | null) ?? null,
    created_at: row.created_at as string,
    owner: owners.get(row.owner_id as string) ?? null,
    interested: counts.get(row.id as string) ?? 0,
    is_owner: viewer !== null && row.owner_id === viewer.id,
  }));
}

/** One post + its owner's public profile. Null when it doesn't exist. */
export async function getCollabPost(id: string): Promise<CollabPost | null> {
  const db = await getDb();
  if (!db) throw new ServerConfigError();

  const { data, error } = await db
    .from("collab_posts")
    .select(POST_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const viewer = await getCurrentUser();
  const [counts, owners] = await Promise.all([interestCounts(db), ownerMap(db)]);
  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    research_areas: (row.research_areas as string[]) ?? [],
    haves: (row.haves as string[]) ?? [],
    needs: (row.needs as string[]) ?? [],
    stage: (row.stage as Stage) ?? "concept",
    funding_status: (row.funding_status as FundingStatus | null) ?? null,
    created_at: row.created_at as string,
    owner: owners.get(row.owner_id as string) ?? null,
    interested: counts.get(row.id as string) ?? 0,
    is_owner: viewer !== null && row.owner_id === viewer.id,
  };
}

// ── writes (auth-gated) ──────────────────────────────────────────────────────

/** Create a post as the signed-in user. owner_id comes from the validated
 *  session — a caller-supplied owner_id is ignored here AND rejected by RLS. */
export async function createCollabPost(input: CreateCollabPostInput): Promise<string> {
  const { user, db } = await requireCurrentUser();

  const { data, error } = await db
    .from("collab_posts")
    .insert({
      owner_id: user.id,           // from the session, never the body
      title: input.title,
      description: input.description ?? "",
      research_areas: input.research_areas ?? [],
      haves: input.haves ?? [],
      needs: input.needs ?? [],
      stage: input.stage ?? "concept",
      funding_status: input.funding_status ?? null,
      checklist_item_id: input.checklist_item_id ?? null,
    })
    .select("id")
    .single();

  if (error || !data) throw error ?? new Error("Insert returned no row.");
  return data.id as string;
}

/** Respond to a post. Recorded in connection_requests with post_id +
 *  interest_type — the same table the provider-card flow uses, so responses live
 *  in one inbox. provider_name stays NULL for this kind of row (the
 *  connection_requests_target_check constraint allows exactly that).
 *
 *  CONTACT is whatever the responder TYPED ("How can they reach you?") — an
 *  email, a handle, a phone, or nothing. It is stored verbatim (trimmed and
 *  length-capped) and is the ONLY contact route the inbox ever shows. Nothing
 *  reads the responder's account email: sharing a way to be reached is the
 *  responder's decision to make per response, not a property of having an
 *  account. See database/migrations/2026-07-27_collab_inbox.sql. */
export async function respondToCollabPost(input: {
  post_id: string;
  interest_type: InterestType;
  message?: string | null;
  contact?: string | null;
}): Promise<string> {
  const { user, db } = await requireCurrentUser();

  const interest: InterestType = (INTEREST_TYPES as readonly string[]).includes(
    input.interest_type
  )
    ? input.interest_type
    : "general";

  const { data, error } = await db
    .from("connection_requests")
    .insert({
      user_id: user.id,            // from the session, never the body
      post_id: input.post_id,
      interest_type: interest,
      message: input.message?.trim() || "",
      // Capped server-side: the client's maxLength is a hint, not a guarantee.
      contact: (input.contact ?? "").trim().slice(0, CONTACT_MAX),
      // provider_name intentionally omitted — this is a board response.
    })
    .select("id")
    .single();

  if (error || !data) throw error ?? new Error("Insert returned no row.");
  return data.id as string;
}

/** Whether the viewer can post/respond — for rendering the sign-in gate. */
export async function canParticipate(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}

/** Delete a post as the signed-in user. Hard delete — matches the idiom in
 *  lib/server/savedItems.ts:removeSavedItem (session-derived user,
 *  .delete().eq()), not a soft-delete: no such pattern exists anywhere in
 *  this codebase and this isn't the place to start one.
 *
 *  The .eq("owner_id", user.id) here is belt-and-suspenders, matching
 *  savedItems.ts's own style — the REAL gate is the collab_posts_delete_own
 *  RLS policy (database/schema.sql), which enforces auth.uid() = owner_id in
 *  Postgres regardless of what this query claims. A caller cannot delete
 *  someone else's post by forging this call: RLS silently matches zero rows
 *  for a post that isn't theirs, same as it would for update/select.
 *
 *  connection_requests.post_id is ON DELETE CASCADE (schema.sql) — deleting a
 *  post also deletes every response to it, including responders' self-
 *  provided contact details. That's a data-loss decision for the CALLER to
 *  have confirmed with the user before invoking this — this function itself
 *  does not warn or ask again. */
export async function deleteCollabPost(postId: string): Promise<void> {
  const { user, db } = await requireCurrentUser();

  const { error } = await db
    .from("collab_posts")
    .delete()
    .eq("id", postId)
    .eq("owner_id", user.id);

  if (error) throw error;
}
