// lib/server/communities.ts — reads for `communities`, and the join/request/
// leave/approve flow on `community_members`
// (database/migrations/2026-08-20_communities.sql,
// database/migrations/2026-08-21_community_join.sql).
//
// COMMUNITY reads are PUBLIC — the communities SELECT policy is USING(true),
// so listCommunities/getCommunityBySlug run through the anon server client,
// same posture as lib/server/collaborate.ts's listResources().
//
// MEMBERSHIP reads/writes are SESSION-SCOPED. community_members' SELECT
// policy (2026-08-21) is narrowed to "your own row, or a lead of that
// community" — it can no longer be read anonymously (rows may carry an
// unlinked person's email; see that migration's header). getMembership()
// uses getSession() (non-throwing) so it can be called during render for a
// signed-out visitor without blowing up; join/leave/approve use
// requireCurrentUser() and reject when signed out.
//
// ACTIVITY COUNTS for a signed-out visitor come from community_member_stats(),
// a SECURITY DEFINER RPC that returns aggregates only (never a row) —
// deliberately granted to anon (see that migration) so a shared link shows
// the community is alive before asking anyone to sign in.
//
// CACHING (2026-08-21 fix): join/leave/approve write through Server Actions
// that already call revalidatePath() — but the symptom reported was stale
// membership state surviving that: /collaborate?community=biokdd kept
// showing the pre-action button until the URL changed, even though
// community_members itself was correct. That's the Next.js CLIENT Router
// Cache (a per-URL RSC-payload cache), not the server-side Full Route Cache
// — this page is already fully dynamic (it reads searchParams, which alone
// forces dynamic rendering regardless of the `dynamic` export at the top of
// page.tsx), so there was no server-side page cache to disable in the first
// place. The actual fix has two parts, both scoped to the membership read
// ONLY — posts/resources keep whatever caching they'd otherwise get:
//   1. The Server Actions now revalidatePath() the EXACT current URL
//      (path + ?community=<slug>), not just the bare "/collaborate" — the
//      client Router Cache keys its entries per full URL, so revalidating
//      only the path-without-query left the query-bearing entry (the one
//      actually on screen) untouched. See app/collaborate/actions.ts.
//   2. getMembership() (and the other two per-viewer membership reads
//      below) call unstable_noStore() — an explicit, LOCAL opt-out of
//      caching for just this data fetch, rather than something that would
//      affect listCommunities/listPendingRequests-adjacent public reads or
//      force the whole route to declare itself dynamic (it already must be,
//      via searchParams, but this makes the "this read must always be
//      fresh" intent explicit and independent of that).

import { unstable_noStore as noStore } from "next/cache";
import { getSession, requireCurrentUser, type Db } from "@/lib/auth";
import { getAnonServerClient } from "./supabaseServer";
import {
  COMMUNITY_RESOURCE_TYPES,
  resolveExploreSources,
  type CommunityResourceType,
  type PublicPreviewLevel,
  type SectionConfig,
} from "@/lib/communityTypes";
import { EXPLORE_API_URL, exploreBackendHeaders } from "./exploreBackend";
import { GENERIC_SCIENCE_STOPWORDS } from "./genericScienceStopwords";
import type { ExploreItem } from "@/types/explore";

export type Community = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_open: boolean;
  // NULL means "show every section, default order" — see
  // lib/communityTypes.ts's resolveSections(), the one place this gets
  // interpreted. Selected on every read below so this field is never
  // silently undefined on a Community the type claims to have it on.
  sections: SectionConfig[] | null;
  // Explore feed config (2026-09-06_community_feed.sql). explore_sources
  // empty means no generated feed, not "every source" — see
  // resolveExploreSources' own comment. explore_refreshed_at is null until
  // the first Refresh.
  explore_sources: string[];
  explore_topics: string[];
  explore_refreshed_at: string | null;
  // Audience scope for the feed (2026-09-17_community_feed_audience_scope.sql)
  // — see that migration's own header. 'all' (default) is today's
  // unrestricted PubMed search; 'clinical' narrows it to health-services/
  // clinical literature. Read by refreshCommunityFeed, set by
  // ExploreFeedEditor.tsx.
  explore_paper_scope: "all" | "clinical";
  // NIH activity codes (e.g. ["K99","R00","K23","K01","R03"]) the Grants
  // source should keep — empty means no career-stage filter (today's
  // behavior). See the same migration and sources/grants_gov.py.
  explore_grant_activity_codes: string[];
  // What a NON-member sees before joining
  // (2026-09-18_community_public_preview.sql) — see that migration's own
  // header and PUBLIC_PREVIEW_LABEL (lib/communityTypes.ts) for the two
  // values. Read by app/communities/[slug]/page.tsx to decide whether to
  // fetch/render getCommunityFeedPreview below at all; set by
  // PublicPreviewEditor.tsx.
  public_preview: PublicPreviewLevel;
  // Active member count (database/migrations/2026-09-08_community_member_counts.sql's
  // community_member_counts() RPC) — OPTIONAL because only listCommunities()
  // below populates it; getCommunityBySlug/getCommunityById don't (a single
  // community's own page already gets this from getCommunityStats(), and
  // running the batched RPC for one row would be pure waste). 0 when the
  // RPC's own read failed, same "degrade to a number, not a crash" posture
  // as getCommunityStats().
  member_count?: number;
};

/** All communities, ordered by name, each with its active member count —
 *  ONE extra query total (community_member_counts(), batched across every
 *  community), not one per community, for card-grid contexts that render
 *  many at once (Explore's Communities category, /communities). Degrades
 *  to an empty list so the Collaborate page still renders (without chips)
 *  if this read fails; degrades to member_count: 0 per row (not a failed
 *  read) if only the count RPC fails — a community grid should still show
 *  the communities themselves even if their counts didn't come back.
 *
 *  Also runs the by-email-add backstop claim (see addCommunityMemberByEmail's
 *  own comment) for whoever's currently signed in — same call site pattern
 *  as listMyProjects()'s claim_pending_project_memberships(), best-effort,
 *  never blocks this read on failure. Communities themselves are public
 *  reads (getAnonServerClient), but the claim needs the caller's own
 *  session, so it only runs when one exists. */
export async function listCommunities(): Promise<Community[]> {
  const session = await getSession();
  if (session) {
    const { error } = await session.db.rpc("claim_pending_community_memberships");
    if (error) console.error("listCommunities: claim_pending_community_memberships failed", error);
  }

  const supabase = getAnonServerClient();
  if (!supabase) return [];

  const [{ data, error }, countsResult] = await Promise.all([
    supabase
      .from("communities")
      .select(
        "id, slug, name, description, is_open, sections, explore_sources, explore_topics, explore_refreshed_at, explore_paper_scope, explore_grant_activity_codes, public_preview"
      )
      .order("name", { ascending: true }),
    supabase.rpc("community_member_counts"),
  ]);

  if (error || !data) return [];

  if (countsResult.error) {
    console.error("listCommunities: community_member_counts failed", countsResult.error);
  }
  const counts = new Map<string, number>(
    ((countsResult.data ?? []) as { community_id: string; member_count: number | string }[]).map(
      (row) => [row.community_id, Number(row.member_count) || 0]
    )
  );

  return (data as Community[]).map((c) => ({ ...c, member_count: counts.get(c.id) ?? 0 }));
}

// Below _MIN_TOKEN_LENGTH characters, a query word is dropped outright, same
// spirit as GENERIC_SCIENCE_STOPWORDS but for words too short to be
// distinctive regardless of what they are ("of", "in", "the" survive most
// stopword lists' exact-word matching by accident if nothing also floors
// length).
const MIN_TOKEN_LENGTH = 3;

/** Lowercase, split on non-alphanumeric runs, drop anything under
 *  MIN_TOKEN_LENGTH chars or in GENERIC_SCIENCE_STOPWORDS. Empty input (or
 *  input that's ALL stopwords/short words) returns an empty array — the
 *  caller treats that as "nothing to search on", not "match everything". */
function searchTokens(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.filter((w) => w.length >= MIN_TOKEN_LENGTH && !GENERIC_SCIENCE_STOPWORDS.has(w));
}

/** Communities whose name, purpose (`description`), or explore_topics
 *  contain any TOKEN of `query` — not a whole-phrase substring match.
 *  "pancreatic cancer" tokenizes to ["pancreatic", "cancer"], either of
 *  which matching is enough; a phrase match would miss ColaboFest's own
 *  topic "pancreatic ductal adenocarcinoma" entirely, since neither string
 *  contains the other. Real queries essentially never repeat an admin's
 *  exact topic wording, so phrase-containment was failing most searches,
 *  not an edge case.
 *
 *  STOPWORDS: GENERIC_SCIENCE_STOPWORDS (lib/server/genericScienceStopwords.ts,
 *  ported from backend/explore-mcp/tools/wiki_agent.py's
 *  _GENERIC_SCIENCE_STOPWORDS — see that file's own comment for why this
 *  reuses that list specifically rather than a new one: it already exists
 *  BECAUSE connective/hedge words like "however" and "signaling" caused a
 *  real false match elsewhere, which is exactly the failure mode a
 *  token search here would otherwise reintroduce — a search for "cancer
 *  patients" tokenizing to ["cancer", "patients"] would match every
 *  community whose purpose happens to mention patients, not because
 *  "patients" says anything about what that community is about.
 *
 *  RANKING: communities are sorted by how many DISTINCT query tokens
 *  matched (across name + purpose + all topics combined), descending — a
 *  community matching on 2 of 2 tokens outranks one matching on only 1,
 *  same "the more of what you typed it actually has, the more relevant it
 *  is" logic a real search should have. Ties keep listCommunities()' own
 *  alphabetical order (Array.prototype.sort is a stable sort).
 *
 *  Fields checked, and why all three: name and purpose (`description`) are
 *  the obvious two; explore_topics is checked too since a topic is often
 *  the MOST accurate description of what a community is actually about —
 *  `description` is prose for a human reader, the same "not specific
 *  enough to drive a search" gap explore_topics exists to fill (see
 *  2026-09-06_community_feed.sql's own reasoning for why topics are a
 *  separate field from description in the first place).
 *
 *  IMPLEMENTATION: filters the same full list listCommunities() already
 *  returns, in memory, rather than a second SQL query, a new RPC, or a
 *  full-text-search index — communities are a small, fully public table
 *  already fetched whole for every other read in this file (no pagination
 *  anywhere), so those would be solving a scale problem this table
 *  doesn't have yet. Reuses listCommunities() verbatim, so a search result
 *  carries the SAME member_count every other card-grid context does — no
 *  separate code path to keep in sync. */
export async function searchCommunities(query: string): Promise<Community[]> {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];

  const all = await listCommunities();

  const scored = all.map((c) => {
    const haystacks = [c.name, c.description ?? "", ...c.explore_topics].map((s) =>
      s.toLowerCase()
    );
    const matched = tokens.filter((token) => haystacks.some((h) => h.includes(token)));
    return { community: c, score: matched.length };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.community);
}

/** One community plus the signed-in caller's relationship to it — the shape
 *  a card-grid summary (Explore's Communities category, and eventually
 *  /communities) needs per card: enough to render the badge (Admin/Member/
 *  Pending/nothing) without a second per-card membership lookup. Built by
 *  merging listMyMemberships()'s map onto whichever community list the
 *  caller already has (all of them, or a search result) — see
 *  app/api/communities-summary/route.ts, the one place this gets built. */
export type CommunitySummaryItem = {
  community: Community;
  /** True if the viewer is an active member (admin/lead/member) already. */
  member: boolean;
  /** The viewer's role — set only when `member` is true, null otherwise. */
  role: CommunityRole | null;
  /** True if the viewer has an outstanding request into this community. */
  pending: boolean;
};

export type CreateCommunityResult =
  | { status: "ok"; id: string; slug: string }
  | { status: "error"; error: string };

/** Create a community. Any signed-in user — create_community_with_admin
 *  (database/migrations/2026-08-30_community_admin_membership.sql) inserts
 *  the community row AND the caller's own admin membership row in one
 *  transaction, same move as create_project_with_lead. ALL COMMUNITIES ARE
 *  PRIVATE — there is no is_open parameter to pass; the RPC hardcodes it
 *  false. */
export async function createCommunity(input: {
  name: string;
  purpose: string;
}): Promise<CreateCommunityResult> {
  const { db } = await requireCurrentUser();

  const name = input.name.trim();
  if (!name) return { status: "error", error: "A community name is required." };

  const purpose = input.purpose.trim();
  if (!purpose) return { status: "error", error: "Say what this community is for." };

  const { data, error } = await db
    .rpc("create_community_with_admin", { p_name: name, p_description: purpose })
    .single();

  if (error || !data) {
    console.error("createCommunity: create_community_with_admin RPC failed", error);

    // Distinguish "the RPC's own RAISE EXCEPTION checks caught something"
    // (P0001 — no authenticated user, empty name; both should already be
    // impossible by the time this runs, given the checks above, but a
    // session can still expire mid-request) from an actual server-side
    // problem — a bad migration, a real bug, anything else. The first is
    // shown near-verbatim (still readable without a terminal); the second
    // says plainly that it's not something retyping the form will fix, so
    // "Couldn't create the community" alone never has to be diagnosed by
    // going and reading the server log.
    if (error?.code === "P0001" && error.message) {
      const reason = error.message.replace(/^create_community_with_admin:\s*/, "");
      return { status: "error", error: `Couldn't create the community — ${reason}.` };
    }

    return {
      status: "error",
      error:
        "Couldn't create the community — this is a server-side problem, not something wrong with what you entered. Check the server log (code: " +
        (error?.code ?? "unknown") +
        ").",
    };
  }

  const row = data as { id: string; slug: string };
  return { status: "ok", id: row.id, slug: row.slug };
}

/** One community by slug — used to resolve the ?community= URL param into an
 *  id for filtering posts/resources. Null when the slug doesn't exist. */
export async function getCommunityBySlug(slug: string): Promise<Community | null> {
  const supabase = getAnonServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("communities")
    .select("id, slug, name, description, is_open, sections, explore_sources, explore_topics, explore_refreshed_at, explore_paper_scope, explore_grant_activity_codes, public_preview")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return null;
  return data as Community;
}

/** One community by id — the counterpart to getCommunityBySlug, needed
 *  wherever only the id is in hand (e.g. /projects/new?community=<id>,
 *  which needs the SLUG back to redirect into /communities/<slug> after
 *  create). Same public read as getCommunityBySlug. */
export async function getCommunityById(id: string): Promise<Community | null> {
  const supabase = getAnonServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("communities")
    .select("id, slug, name, description, is_open, sections, explore_sources, explore_topics, explore_refreshed_at, explore_paper_scope, explore_grant_activity_codes, public_preview")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return data as Community;
}

/** Every community the signed-in viewer belongs to (active) or has a
 *  pending request into, keyed by community_id — one query for the whole
 *  /communities list page instead of one getMembership() per community.
 *  Empty when signed out (the page shows every community as "other" then,
 *  same as an anonymous /collaborate visitor sees no Join state either). */
export async function listMyMemberships(): Promise<
  Record<string, { status: "active" | "pending"; role: CommunityRole }>
> {
  const session = await getSession();
  if (!session) return {};

  const { data, error } = await session.db
    .from("community_members")
    .select("community_id, status, role")
    .eq("user_id", session.user.id);

  if (error || !data) return {};
  const out: Record<string, { status: "active" | "pending"; role: CommunityRole }> = {};
  for (const row of data as { community_id: string; status: "active" | "pending"; role: CommunityRole }[]) {
    out[row.community_id] = { status: row.status, role: row.role };
  }
  return out;
}

/** Every community the signed-in viewer is an ACTIVE (approved) member of,
 *  with a name to show — for the Promote editor's community picker
 *  (components/promote/ArticleEditor.tsx), which must only ever offer
 *  communities the author actually belongs to. Deliberately narrower than
 *  listMyMemberships() above: that one also returns "pending" rows (an
 *  outstanding request, not yet approved), which have no business showing up
 *  as an attachable community here. Empty when signed out or a member of
 *  nothing — the editor's own prop comment says what it does with that (no
 *  dropdown at all, not an empty one).
 *
 *  Only ever reads an explicit community_members row — NOT
 *  is_community_member()'s broader "or a ColaboFest lead/project-member via
 *  `projects`" form (see that function's own comment in
 *  2026-08-20_communities.sql). A ColaboFest lead who has never actually
 *  joined `community_members` won't see ColaboFest in this picker; they
 *  would still be allowed to save it (promote_showcase's WITH CHECK uses
 *  can_post_to_community, which DOES cover that derived form) if a request
 *  reached the server some other way, but the picker itself only lists what
 *  a plain "active member" reading of this feature's own spec asked for. */
export async function listMyActiveCommunities(): Promise<
  { id: string; slug: string; name: string }[]
> {
  const session = await getSession();
  if (!session) return [];

  const { data, error } = await session.db
    .from("community_members")
    .select("communities(id, slug, name)")
    .eq("user_id", session.user.id)
    .eq("status", "active");

  if (error || !data) return [];

  // Same "object or single-element array" defensiveness as
  // lib/server/showcase.ts's toCommunity() — supabase-js's embed shape here
  // depends on how it infers the relationship, and this is cheap to handle
  // once rather than assume.
  type Row = { communities: { id: string; slug: string; name: string } | { id: string; slug: string; name: string }[] | null };
  return (data as Row[])
    .map((row) => (Array.isArray(row.communities) ? row.communities[0] : row.communities))
    .filter((c): c is { id: string; slug: string; name: string } => Boolean(c))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Membership state ────────────────────────────────────────────────────────

export type MembershipState = "signed_out" | "none" | "pending" | "active";
export type CommunityRole = "admin" | "lead" | "member";
export type Membership = { state: MembershipState; role: CommunityRole | null; isAdmin: boolean };

/** The signed-in viewer's relationship to one community. "signed_out" for no
 *  session (join/request UI should prompt sign-in, not block); "none" for
 *  signed in but no row; "pending" for an outstanding request into a closed
 *  community; "active" for an approved member. `isAdmin` is only ever true
 *  alongside "active" — it's what the UI checks before showing the
 *  membership-management affordances (pending requests, add by email,
 *  promote/demote/remove). Was `isLead` before
 *  2026-08-30_community_admin_membership.sql — membership management moved
 *  from lead to admin (a lead can post, same as any member, but no longer
 *  manages membership; see that migration's header), so this now reflects
 *  role = 'admin', not role = 'lead'. */
export async function getMembership(communityId: string): Promise<Membership> {
  noStore(); // this specific read must never be served from a cached RSC payload
  const session = await getSession();
  if (!session) return { state: "signed_out", role: null, isAdmin: false };

  const { data, error } = await session.db
    .from("community_members")
    .select("status, role")
    .eq("community_id", communityId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error || !data) return { state: "none", role: null, isAdmin: false };
  const active = data.status === "active";
  const role = active ? (data.role as CommunityRole) : null;
  return { state: active ? "active" : "pending", role, isAdmin: role === "admin" };
}

/** Join (open community) or request to join (closed community). Which one
 *  happens is decided by RLS (community_members_self_insert,
 *  2026-08-21_community_join.sql), not by this function — it always tries
 *  'active' first only when the caller already knows the community is open;
 *  callers pass `isOpen` from the community row they already have, and the
 *  insert itself is still the only real gate (a forged isOpen=true against a
 *  closed community is rejected by Postgres, not silently downgraded here). */
export async function joinCommunity(communityId: string, isOpen: boolean): Promise<void> {
  const { user, db } = await requireCurrentUser();

  const { error } = await db.from("community_members").insert({
    community_id: communityId,
    user_id: user.id,
    email: user.email,
    status: isOpen ? "active" : "pending",
  });

  if (error) {
    // 23505 here means community_members_email_key
    // (community_id, lower(email)) — an admin already added this person by
    // email (an imported roster, most often) and this session reached this
    // insert before that row ever got linked to this account. Normally
    // linking happens either at sign-up (handle_new_user()) or via
    // claim_pending_community_memberships() — called from listCommunities()
    // and now also from this community page itself
    // (app/communities/[slug]/page.tsx) — but a direct link or a QR code
    // straight to this page, on a session where neither of those has run
    // yet, can still land here first.
    //
    // Claim the existing row instead of leaving a raw 23505 on screen: same
    // SECURITY DEFINER RPC every other reconciliation path in this file
    // uses, not a plain UPDATE — no RLS policy grants a signed-in user
    // UPDATE rights on a row that isn't theirs yet (user_id IS NULL), by
    // design, so setting user_id on that row has to go through the definer
    // function. It links by email for every pending row across every
    // community, not just this one, which is fine — it's exactly what
    // would have happened on the very next page load anyway.
    if (error.code === "23505") {
      const { error: claimError } = await db.rpc("claim_pending_community_memberships");
      if (claimError) throw claimError;
      return;
    }
    throw error;
  }
}

/** Best-effort claim of any community_members row (across every community)
 *  added by email before this account existed or before it was ever linked
 *  — the same reconciliation listCommunities() already runs before its own
 *  read, exposed here so a page that does NOT call listCommunities() (most
 *  notably /communities/[slug], reached directly via a shared link or a QR
 *  code — see joinCommunity's own comment) can run it too, before reading
 *  this viewer's membership. Never throws; a signed-out caller is a no-op,
 *  matching getMembership's own "signed_out" handling. */
export async function claimPendingCommunityMemberships(): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const { error } = await session.db.rpc("claim_pending_community_memberships");
  if (error) {
    console.error("claimPendingCommunityMemberships: RPC failed", error);
  }
}

export type LeaveCommunityResult = { status: "ok" } | { status: "error"; error: string };

/** Leave a community — withdraws a pending request the same way it leaves an
 *  active membership. Self-only; "Community members: self or admin delete"
 *  (RLS) is the real gate, this .eq("user_id", ...) is belt-and-suspenders.
 *
 *  AN ADMIN LEAVING IS THE ONE CASE THIS CAN GENUINELY FAIL: deleting the
 *  last active admin's own row trips enforce_community_admin_guard (P0001,
 *  "A community must always keep at least one admin.") — the backstop for
 *  LeaveCommunityButton's own pre-check (an admin with no other active
 *  admin sees the control disabled with a reason before ever calling this,
 *  see that component), not the primary defense. Withdrawing a pending
 *  request or a non-admin leaving can never hit the trigger at all (it
 *  only restricts an active admin row), so this still returns "ok" for
 *  every path that isn't that one edge case.
 *
 *  Was Promise<void> (threw on any failure) before this — changed to a
 *  result type so the P0001 split below (same shape as
 *  createCommunity/addCommunityMemberByEmail/deleteCommunity) has
 *  somewhere to put a message; requireCurrentUser() above still throws
 *  UnauthorizedError for "not signed in", unchanged, since both callers
 *  (app/collaborate/actions.ts and app/communities/actions.ts) already
 *  catch that case separately. */
export async function leaveCommunity(communityId: string): Promise<LeaveCommunityResult> {
  const { user, db } = await requireCurrentUser();

  const { error } = await db
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", user.id);

  if (error) {
    console.error("leaveCommunity: delete failed", error);

    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't leave — ${error.message}.` };
    }

    return {
      status: "error",
      error:
        "Couldn't leave — this is a server-side problem, not something wrong with what you did. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

export type PendingRequest = { id: string; email: string | null; requested_at: string };

/** Pending join requests for a community — visible only to an admin of that
 *  community (community_members' self-or-admin SELECT policy, 2026-08-30,
 *  is the actual gate; a non-admin caller just gets an empty list back, not
 *  an error). */
export async function listPendingRequests(communityId: string): Promise<PendingRequest[]> {
  noStore(); // same reasoning as getMembership() — must reflect the latest approve/leave
  const session = await getSession();
  if (!session) return [];

  const { data, error } = await session.db
    .from("community_members")
    .select("id, email, requested_at")
    .eq("community_id", communityId)
    .eq("status", "pending")
    .order("requested_at", { ascending: true });

  if (error || !data) return [];
  return data as PendingRequest[];
}

/** Approve a pending request. Admin-only (2026-08-30, was lead-only) —
 *  "Community members: admin manages" (RLS) is the real gate; a non-admin's
 *  UPDATE matches zero rows. */
export async function approveMembership(memberRowId: string): Promise<void> {
  const { db } = await requireCurrentUser();

  const { error } = await db
    .from("community_members")
    .update({ status: "active", approved_at: new Date().toISOString() })
    .eq("id", memberRowId);
  // approved_by is intentionally NOT set from the client body — see note
  // below; Postgres has no auth.uid() access from here, so this column is
  // left for a future trigger/RPC if "who approved" needs to be exact. RLS
  // still restricts WHO can perform this update to an admin of the row's
  // own community regardless.

  if (error) throw error;
}

/** Reject a pending request — a plain delete of the row, same as
 *  leaveCommunity but admin-acting-on-someone-else instead of self.
 *  "Community members: self or admin delete" (RLS) is the real gate; there
 *  is no separate "rejected" state to record — a rejected request simply
 *  stops existing, exactly like a withdrawn one, so a rejected person can
 *  request again later without a stale row in the way. */
export async function rejectMembership(memberRowId: string): Promise<void> {
  const { db } = await requireCurrentUser();

  const { error } = await db.from("community_members").delete().eq("id", memberRowId);

  if (error) throw error;
}

export type AddCommunityMemberResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

/** Add a member by email. ADMIN-ONLY — enforced twice, same shape as
 *  addProjectMember (lib/server/projects.ts): "Community members: admin
 *  insert by email" (RLS) is the real gate, the isAdmin check below exists
 *  purely to return a clear { status: "forbidden" } instead of a raw 42501.
 *
 *  Member IMMEDIATELY, not pending — no approval step for an admin-added
 *  row (that's the whole point of this being the second way in, distinct
 *  from request-to-join). Email is lowercased before insert; the unique
 *  index is on (community_id, lower(email)).
 *
 *  approved_by/approved_at are NOT set on this insert, even though this
 *  row IS effectively pre-approved — "Community members: admin insert by
 *  email" (RLS) requires approved_by IS NULL on the inserted row (that
 *  column is reserved for the approve-a-pending-request UPDATE path, see
 *  approveMembership above); setting it here trips a 42501, not a
 *  friendlier rejection. status = 'active' alone is what makes this row
 *  a member immediately — approved_by staying NULL just means "never went
 *  through the request/approve flow," which is true.
 *
 *  LINKS AN EXISTING ACCOUNT NOW, not just at signup —
 *  find_account_id_by_email_for_community
 *  (2026-08-30_community_admin_membership.sql) looks the email up in
 *  auth.users (never read directly by the app) and, if found, the row is
 *  inserted already linked. If not found, it's inserted with user_id NULL
 *  and handle_new_user() (2026-08-21, unchanged) claims it the moment that
 *  email signs up — claim_pending_community_memberships() is the backstop,
 *  called from listCommunities() below, exactly the way
 *  claim_pending_project_memberships() backstops listMyProjects(). */
export async function addCommunityMemberByEmail(
  communityId: string,
  email: string
): Promise<AddCommunityMemberResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "forbidden", error: "Only a community admin can add members." };
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized) return { status: "error", error: "An email address is required." };

  let existingUserId: string | null = null;
  const { data: lookupData, error: lookupError } = await db.rpc(
    "find_account_id_by_email_for_community",
    { p_community_id: communityId, p_email: normalized }
  );
  if (lookupError) {
    console.error("addCommunityMemberByEmail: existing-account lookup failed", lookupError);
  } else {
    existingUserId = (lookupData as string | null) ?? null;
  }

  const { error } = await db.from("community_members").insert({
    community_id: communityId,
    user_id: existingUserId,
    email: normalized,
    role: "member",
    status: "active",
  });

  if (error) {
    if (error.code === "23505") {
      return { status: "error", error: "That person is already a member of this community." };
    }
    console.error("addCommunityMemberByEmail: insert failed", error);

    // Same split as createCommunity's own RPC-error handling: a P0001 is
    // one of our own RAISE EXCEPTION checks (readable near-verbatim);
    // anything else — including a 42501 RLS rejection like the one that
    // exposed the approved_by/approved_at bug above — is a server-side
    // problem, said plainly, with the code, instead of a blanket
    // "Couldn't add that member."
    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't add that member — ${error.message}.` };
    }

    return {
      status: "error",
      error:
        "Couldn't add that member — this is a server-side problem, not something wrong with what you entered. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

export type CommunityMember = {
  id: string;
  email: string | null;
  user_id: string | null;
  role: CommunityRole;
  status: "active" | "pending";
  focus: string | null;
  /** Kept out of the member-facing roster (community_member_roster,
   *  2026-09-14_community_member_roster_pending_hidden.sql) — staff running
   *  a community rather than part of the cohort it's for. Never affects
   *  role/access; only visible here, in the admin panel. */
  hidden: boolean;
  /** Admin-set name to show for this row until it's linked to a real
   *  account — see database/migrations/2026-09-15_community_member_display_name.sql.
   *  Admin-only, unlike `focus`/`hidden`: there's no session to self-set
   *  this from before signing in, and once signed in the real account name
   *  wins over it automatically. */
  display_name: string | null;
};

/** The full member roster, WITH email — admin-only. "Community members:
 *  self or admin select" (RLS) is the real gate: a non-admin caller gets
 *  back only their own row (never other members' emails), which reads here
 *  as "not admin, don't render the roster" rather than an error. This is
 *  the one read in this file that ever ships another member's email to the
 *  client — every other read is either the viewer's own row or an
 *  aggregate. */
export async function listCommunityMembers(communityId: string): Promise<CommunityMember[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) return [];

  const { data, error } = await session.db
    .from("community_members")
    .select("id, email, user_id, role, status, focus, hidden, display_name")
    .eq("community_id", communityId)
    .eq("status", "active")
    .order("role", { ascending: true }); // 'admin' < 'lead' < 'member' alphabetically — admins first

  if (error || !data) return [];
  return data as CommunityMember[];
}

export type MemberRosterEntry = {
  /** community_members.id — the stable key. NOT `user_id`: a row for
   *  someone who hasn't signed in yet has no user_id at all (see
   *  `signed_up` below), so this is the only identifier every row is
   *  guaranteed to have. */
  member_id: string;
  /** Null until this person has actually signed in and been linked
   *  (handle_new_user() / claimPendingCommunityMemberships()) — see
   *  `signed_up`. */
  user_id: string | null;
  role: CommunityRole;
  display_name: string;
  /** True once user_id is set — false means this row is a placeholder for
   *  someone added by email (an imported roster) who hasn't signed in yet.
   *  MembersSection marks that state explicitly on the card rather than
   *  rendering it as an ordinary member. */
  signed_up: boolean;
  /** True only on the viewer's OWN row when they've hidden themselves from
   *  the roster — every other member's hidden row is filtered out before
   *  it ever reaches this list (see the RPC's own self-exception comment),
   *  so this is never true for anyone else's entry. Lets MembersSection
   *  mark "only visible to you" and offer the way back. */
  hidden: boolean;
  /** Same field collab_post_owners() exposes for the Collaborate board's
   *  "Name · Institution" line (PostCard.tsx) — null when the person hasn't
   *  set one, same as there. Never affiliation (a role label like
   *  "Researcher"), which PostCard only falls back to when institution is
   *  unset — the roster card doesn't do that fallback (see
   *  2026-09-02_community_member_roster_institution.sql's own comment on
   *  why only institution was added). */
  institution: string | null;
  /** "What they work on" in THIS community — set by the member themselves,
   *  or by an admin filling in a roster ahead of signup (see
   *  database/migrations/2026-09-13_community_member_focus.sql). Lives on
   *  the membership, not on public.users, since the same person may want a
   *  different line in a different community. Null until someone sets it. */
  focus: string | null;
};

/** The member-facing roster — display name (or role) for any ACTIVE member
 *  to see, unlike listCommunityMembers above (admin-only, raw emails). Goes
 *  through community_member_roster() — a SECURITY DEFINER RPC gated by
 *  is_community_member(), the exact same shape as project_member_names()
 *  (lib/server/projects.ts) — because a plain join on public.users would
 *  run into that table's own SELECT policy (`is_public = true`) and blank
 *  out a private-profile member instead of falling back to their email.
 *  Sorted admins first, then alphabetically by the resolved display name —
 *  never by raw role string, which would put "admin" ahead of "lead" ahead
 *  of "member" alphabetically only by coincidence.
 *
 *  INCLUDES rows for members who have not signed in yet (an imported
 *  roster added by email, before this migration a not-yet-linked row was
 *  silently dropped entirely — see
 *  2026-09-14_community_member_roster_pending_hidden.sql's own header) and
 *  EXCLUDES rows an admin (or the member themselves) has marked `hidden`
 *  (staff running the community rather than part of the cohort it's for)
 *  — EXCEPT a caller's own hidden row, which the RPC still returns (with
 *  `hidden: true`) so they have a way to un-hide themselves; see that
 *  function's own self-exception comment. Both filters are enforced in the
 *  RPC's own WHERE clause, not filtered here.
 *
 *  WORKS SIGNED OUT TOO, as of 2026-09-20_community_public_roster.sql —
 *  the RPC's own WHERE clause now also returns rows when the community's
 *  public_preview is 'open', regardless of the caller's own membership.
 *  Falls back to the anon server client when there's no session (same
 *  client getCommunityBySlug already uses for every other public read)
 *  rather than bailing out the way this used to — the RPC call itself is
 *  what decides whether anything comes back, the same as it always has
 *  for a signed-in non-member. */
export async function listMemberRoster(communityId: string): Promise<MemberRosterEntry[]> {
  noStore();
  const session = await getSession();
  const db = session ? session.db : getAnonServerClient();
  if (!db) return [];

  const { data, error } = await db.rpc("community_member_roster", {
    community_ids: [communityId],
  });
  if (error || !Array.isArray(data)) return [];

  const rows = data as {
    member_id: string;
    user_id: string | null;
    role: CommunityRole;
    name: string | null;
    email: string | null;
    institution: string | null;
    focus: string | null;
    signed_up: boolean;
    hidden: boolean;
  }[];

  return rows
    .map((r) => ({
      member_id: r.member_id,
      user_id: r.user_id,
      role: r.role,
      // r.name is already COALESCE(linked account's real name, admin-set
      // display_name) — see community_member_roster's own comment
      // (2026-09-15_community_member_display_name.sql). Email is only the
      // last resort now, for a not-yet-signed-in row an admin never gave a
      // display name to; "Unnamed member" is the final fallback, reached
      // only if somehow neither exists.
      display_name: r.name || r.email || "Unnamed member",
      institution: r.institution,
      focus: r.focus,
      signed_up: r.signed_up,
      hidden: r.hidden,
    }))
    .sort((a, b) => {
      if (a.role === "admin" && b.role !== "admin") return -1;
      if (b.role === "admin" && a.role !== "admin") return 1;
      return a.display_name.localeCompare(b.display_name);
    });
}

export type RevealMemberEmailResult =
  | { status: "ok"; email: string }
  | { status: "error"; error: string };

/** Reveal ONE other member's email, on demand — the Connect button on a
 *  member card (MembersSection.tsx). Deliberately a separate, on-request
 *  read rather than something included in listMemberRoster()'s own result:
 *  that result is what gets rendered into the page on load, and the whole
 *  point of Connect is that an email isn't shipped to every viewer just
 *  because they can see the roster — "member-gated" (who's allowed to ever
 *  see it) and "shown by default" (what the page renders unasked) are
 *  different guarantees, and this function is what keeps the second one
 *  true. Goes through the same community_member_roster() RPC listMemberRoster
 *  uses — same gate (is_community_member), same hidden-row exclusion — just
 *  called on click instead of on page render, and only this one row's email
 *  is ever returned to the caller. Refuses the caller's own row: the
 *  Connect button never renders on the viewer's own card, and there's no
 *  reason to reveal your own email to yourself through this path. */
export async function getMemberEmailForConnect(
  communityId: string,
  memberId: string
): Promise<RevealMemberEmailResult> {
  const { user, db } = await requireCurrentUser();

  const { data, error } = await db.rpc("community_member_roster", {
    community_ids: [communityId],
  });
  if (error || !Array.isArray(data)) {
    return { status: "error", error: "Couldn't load that member's email." };
  }

  const row = (data as { member_id: string; user_id: string | null; email: string | null }[]).find(
    (r) => r.member_id === memberId
  );
  if (!row || row.user_id === user.id) {
    return { status: "error", error: "Couldn't load that member's email." };
  }
  if (!row.email) {
    return { status: "error", error: "This member hasn't shared an email yet." };
  }

  return { status: "ok", email: row.email };
}

export type ChangeRoleResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

/** Promote or demote a member. Admin-only — "Community members: admin
 *  manages" (RLS) is the real gate. The admin-guard trigger
 *  (enforce_community_admin_guard) is what actually stops this call from
 *  demoting a DIFFERENT admin or leaving a community with zero admins; the
 *  raw Postgres exception it raises is surfaced here as a plain message
 *  rather than a stack trace. */
export async function changeCommunityMemberRole(
  communityId: string,
  memberRowId: string,
  role: CommunityRole
): Promise<ChangeRoleResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "forbidden", error: "Only a community admin can change roles." };
  }

  const { error } = await db
    .from("community_members")
    .update({ role })
    .eq("id", memberRowId)
    .eq("community_id", communityId);

  if (error) {
    // The trigger's RAISE EXCEPTION messages are written to be shown
    // as-is (see the migration) — "An admin cannot remove or demote
    // another admin." / "A community must always keep at least one
    // admin." — rather than translated into something generic here.
    return { status: "error", error: error.message || "Couldn't change that member's role." };
  }

  return { status: "ok" };
}

export type UpdateFocusResult = { status: "ok" } | { status: "error"; error: string };

const MAX_FOCUS_LENGTH = 160;

/** Set or clear the caller's own "what I work on here" line for one
 *  community, shown on their member card (MembersSection). Self-only —
 *  "Community members: self update focus"
 *  (2026-09-13_community_member_focus.sql) is the real gate, and its
 *  BEFORE UPDATE trigger is what stops this same path being used to touch
 *  role/status/anything else; a forged extra field in the update below
 *  would be rejected by the trigger, not by this function. Matches on
 *  (community_id, user_id) rather than a member-row id — the caller only
 *  ever has their own community_id in hand, not their own row's id. */
export async function updateMyCommunityFocus(
  communityId: string,
  focus: string
): Promise<UpdateFocusResult> {
  const { user, db } = await requireCurrentUser();

  const trimmed = focus.trim().slice(0, MAX_FOCUS_LENGTH);

  const { error } = await db
    .from("community_members")
    .update({ focus: trimmed || null })
    .eq("community_id", communityId)
    .eq("user_id", user.id);

  if (error) {
    console.error("updateMyCommunityFocus: update failed", error);
    return {
      status: "error",
      error:
        "Couldn't save your research focus — this is a server-side problem, not something wrong with what you entered. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

/** Set another member's focus line as an admin — for an imported cohort
 *  (e.g. HEREP) filled in from a roster before that person has signed in.
 *  Admin-only, app-level check only: "Community members: admin manages"
 *  (RLS) already covers any column on any row in the admin's own
 *  community, so this needs no new policy — same shape as
 *  changeCommunityMemberRole/removeCommunityMember above. */
export async function updateCommunityMemberFocus(
  communityId: string,
  memberRowId: string,
  focus: string
): Promise<UpdateFocusResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can set another member's focus." };
  }

  const trimmed = focus.trim().slice(0, MAX_FOCUS_LENGTH);

  const { error } = await db
    .from("community_members")
    .update({ focus: trimmed || null })
    .eq("id", memberRowId)
    .eq("community_id", communityId);

  if (error) {
    return { status: "error", error: error.message || "Couldn't save that member's focus." };
  }

  return { status: "ok" };
}

export type UpdateDisplayNameResult = { status: "ok" } | { status: "error"; error: string };

const MAX_DISPLAY_NAME_LENGTH = 80;

/** Set what to call a member on their card before they've signed in — an
 *  imported roster's real problem (see
 *  database/migrations/2026-09-15_community_member_display_name.sql's own
 *  header): without this, a not-yet-linked row has nothing to show but its
 *  email. Admin-only, no self path — there's no session to self-set this
 *  from before signing in, and once signed in the real account name wins
 *  over it automatically (community_member_roster's own COALESCE), so
 *  there's never a case where a member would set their own. */
export async function updateCommunityMemberDisplayName(
  communityId: string,
  memberRowId: string,
  displayName: string
): Promise<UpdateDisplayNameResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can set another member's display name." };
  }

  const trimmed = displayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);

  const { error } = await db
    .from("community_members")
    .update({ display_name: trimmed || null })
    .eq("id", memberRowId)
    .eq("community_id", communityId);

  if (error) {
    return { status: "error", error: error.message || "Couldn't save that member's display name." };
  }

  return { status: "ok" };
}

export type UpdateHiddenResult = { status: "ok" } | { status: "error"; error: string };

/** Hide or unhide the caller's OWN row from the member-facing roster —
 *  staff who are members (for access) but not part of the cohort the
 *  roster exists to show. Self-only, same policy `focus` uses ("Community
 *  members: self update own row", 2026-09-14) and the same trigger
 *  (enforce_community_member_self_update_guard) — `hidden` is on that
 *  trigger's allowed list alongside `focus`, nothing else. Never changes
 *  role, status, or access; `is_community_member`/`is_community_admin`/
 *  `can_post_to_community` don't read this column. */
export async function updateMyCommunityHidden(
  communityId: string,
  hidden: boolean
): Promise<UpdateHiddenResult> {
  const { user, db } = await requireCurrentUser();

  const { error } = await db
    .from("community_members")
    .update({ hidden })
    .eq("community_id", communityId)
    .eq("user_id", user.id);

  if (error) {
    console.error("updateMyCommunityHidden: update failed", error);
    return {
      status: "error",
      error:
        "Couldn't update your roster visibility — this is a server-side problem, not something wrong with what you did. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

/** Hide or unhide a DIFFERENT member from the roster, as an admin — same
 *  shape as updateCommunityMemberFocus: "Community members: admin manages"
 *  (RLS) already covers any column on any row in the admin's own
 *  community, so this needs no new policy, only the app-level isAdmin
 *  check below. */
export async function updateCommunityMemberHidden(
  communityId: string,
  memberRowId: string,
  hidden: boolean
): Promise<UpdateHiddenResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can change who's shown in the roster." };
  }

  const { error } = await db
    .from("community_members")
    .update({ hidden })
    .eq("id", memberRowId)
    .eq("community_id", communityId);

  if (error) {
    return { status: "error", error: error.message || "Couldn't update that member's roster visibility." };
  }

  return { status: "ok" };
}

export type RemoveCommunityMemberResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

/** Remove a member. Admin-only — same RLS gate and same trigger backstop as
 *  changeCommunityMemberRole (removing another admin, or the last admin, is
 *  rejected by enforce_community_admin_guard, not by this function). */
export async function removeCommunityMember(
  communityId: string,
  memberRowId: string
): Promise<RemoveCommunityMemberResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "forbidden", error: "Only a community admin can remove members." };
  }

  const { error } = await db
    .from("community_members")
    .delete()
    .eq("id", memberRowId)
    .eq("community_id", communityId);

  if (error) {
    return { status: "error", error: error.message || "Couldn't remove that member." };
  }

  return { status: "ok" };
}

export type DeleteCommunityResult = { status: "ok" } | { status: "error"; error: string };

/** Delete a community. Admin-only — "Communities: admin delete"
 *  (2026-08-31_community_delete.sql) is the real gate, is_community_admin
 *  re-checked below purely for a clear message instead of a raw 42501/zero
 *  rows deleted.
 *
 *  NOTHING ELSE IS DELETED. Every side effect is an existing FK constraint,
 *  not app code: community_members rows are removed by ON DELETE CASCADE
 *  (2026-08-20_communities.sql); collab_posts.community_id,
 *  lab_resources.community_id, and projects.community_id are all set back
 *  to NULL by ON DELETE SET NULL. A project that belonged to this
 *  community survives as a personal project — its members, checklist,
 *  resources, and shared folder are completely untouched, exactly as if it
 *  had never been linked to a community. */
export async function deleteCommunity(communityId: string): Promise<DeleteCommunityResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can delete it." };
  }

  const { data: deleted, error } = await db
    .from("communities")
    .delete()
    .eq("id", communityId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("deleteCommunity: delete failed", error);

    // Same split as createCommunity/addCommunityMemberByEmail: a P0001 is
    // one of this database's own RAISE EXCEPTION checks (here, most
    // likely enforce_community_admin_guard — see
    // 2026-08-31_community_delete_admin_guard_fix.sql for the bug that
    // exposed "Couldn't delete the community." telling nobody anything),
    // shown near-verbatim. Anything else is a genuine server-side problem,
    // said plainly, with the code.
    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't delete the community — ${error.message}.` };
    }

    return {
      status: "error",
      error:
        "Couldn't delete the community — this is a server-side problem, not something wrong with what you did. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }
  if (!deleted) {
    // RLS matched zero rows — not an admin, or the community no longer
    // exists. Same non-distinction deleteProject makes for the same
    // reason: telling the two apart isn't this function's call to make.
    return { status: "error", error: "Couldn't delete the community." };
  }

  return { status: "ok" };
}

export type UpdateSectionsResult = { status: "ok" } | { status: "error"; error: string };

/** Save the community's section list — admin-only. "Communities: admin
 *  update" (2026-08-31_community_sections.sql) is the real gate,
 *  is_community_admin re-checked below for a clear message instead of a
 *  raw 42501.
 *
 *  Writes the WHOLE array every time (SectionsEditor sends its full local
 *  state on Save, not a diff) — matches the migration's own framing of
 *  `sections` as one opaque ordered blob, not per-key rows to reconcile.
 *  No shape validation here beyond what TypeScript already gives the
 *  caller; resolveSections() (lib/communityTypes.ts) is where a malformed
 *  or partial array gets made sense of on READ, not here on write. */
export async function updateCommunitySections(
  communityId: string,
  sections: SectionConfig[]
): Promise<UpdateSectionsResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can change sections." };
  }

  const { error } = await db.from("communities").update({ sections }).eq("id", communityId);

  if (error) {
    console.error("updateCommunitySections: update failed", error);

    // Same split as every other write in this file.
    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't save sections — ${error.message}.` };
    }

    return {
      status: "error",
      error:
        "Couldn't save sections — this is a server-side problem, not something wrong with what you chose. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

export type UpdatePublicPreviewResult = { status: "ok" } | { status: "error"; error: string };

/** What a NON-member sees before joining — admin-only, same
 *  is_community_admin re-check pattern as updateCommunitySections. Takes
 *  effect immediately (unlike the Explore feed config): there's no
 *  separate "Refresh" step here, this just changes which RLS-visible rows
 *  a non-member's next page load is allowed to read. */
export async function updateCommunityPublicPreview(
  communityId: string,
  level: PublicPreviewLevel
): Promise<UpdatePublicPreviewResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can change what non-members see." };
  }

  const { error } = await db
    .from("communities")
    .update({ public_preview: level })
    .eq("id", communityId);

  if (error) {
    console.error("updateCommunityPublicPreview: update failed", error);

    // Same split as every other write in this file.
    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't save this setting — ${error.message}.` };
    }

    return {
      status: "error",
      error:
        "Couldn't save this setting — this is a server-side problem, not something wrong with what you chose. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

// ── Announcements ────────────────────────────────────────────────────────

export type Announcement = {
  id: string;
  community_id: string;
  author_id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
};

/** Newest first, for any ACTIVE member — "Community announcements: member
 *  select" (2026-09-02_community_announcements.sql) is the real gate, not
 *  this function: a non-member's query matches zero rows in Postgres, which
 *  reads here as the same empty list a signed-out visitor or a genuinely
 *  quiet community gets. Author display name is NOT resolved here — the
 *  caller (the page) does that through listMemberRoster()/
 *  community_member_roster(), same as it already does for the Members
 *  section, so an announcement never ships an email to render a name. */
export async function listAnnouncements(communityId: string): Promise<Announcement[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];

  const { data, error } = await session.db
    .from("community_announcements")
    .select("id, community_id, author_id, title, body, created_at, updated_at")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data as Announcement[];
}

export type CreateAnnouncementResult =
  | { status: "ok"; id: string }
  | { status: "error"; error: string };

/** Post an announcement. Admin-only — "Community announcements: admin
 *  insert" (RLS) is the real gate, is_community_admin re-checked below
 *  purely for a clear message instead of a raw 42501. author_id comes from
 *  the session, never the caller's input, same as owner_id in
 *  lib/server/collab.ts. */
export async function createAnnouncement(
  communityId: string,
  input: { title: string; body: string }
): Promise<CreateAnnouncementResult> {
  const { user, db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can post an announcement." };
  }

  const title = input.title.trim();
  if (!title) return { status: "error", error: "A title is required." };

  const { data, error } = await db
    .from("community_announcements")
    .insert({
      community_id: communityId,
      author_id: user.id,
      title,
      body: input.body.trim(),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createAnnouncement: insert failed", error);

    // Same split as every other write in this file.
    if (error?.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't post the announcement — ${error.message}.` };
    }
    return {
      status: "error",
      error:
        "Couldn't post the announcement — this is a server-side problem, not something wrong with what you did. Check the server log (code: " +
        (error?.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok", id: data.id };
}

export type UpdateAnnouncementResult = { status: "ok" } | { status: "error"; error: string };

/** Edit an announcement. Admin-only — "Community announcements: admin
 *  update" (RLS) is the real gate. */
export async function updateAnnouncement(
  communityId: string,
  announcementId: string,
  input: { title: string; body: string }
): Promise<UpdateAnnouncementResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can edit an announcement." };
  }

  const title = input.title.trim();
  if (!title) return { status: "error", error: "A title is required." };

  const { error } = await db
    .from("community_announcements")
    .update({ title, body: input.body.trim() })
    .eq("id", announcementId)
    .eq("community_id", communityId);

  if (error) {
    console.error("updateAnnouncement: update failed", error);

    // Same split as every other write in this file.
    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't save the announcement — ${error.message}.` };
    }
    return {
      status: "error",
      error:
        "Couldn't save the announcement — this is a server-side problem, not something wrong with what you did. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

export type DeleteAnnouncementResult = { status: "ok" } | { status: "error"; error: string };

/** Delete an announcement. Admin-only — "Community announcements: admin
 *  delete" (RLS) is the real gate. */
export async function deleteAnnouncement(
  communityId: string,
  announcementId: string
): Promise<DeleteAnnouncementResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can delete an announcement." };
  }

  const { error } = await db
    .from("community_announcements")
    .delete()
    .eq("id", announcementId)
    .eq("community_id", communityId);

  if (error) {
    console.error("deleteAnnouncement: delete failed", error);

    // Same split as every other write in this file.
    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't delete the announcement — ${error.message}.` };
    }
    return {
      status: "error",
      error:
        "Couldn't delete the announcement — this is a server-side problem, not something wrong with what you did. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

// ── Resources ────────────────────────────────────────────────────────────

// CommunityResourceType/COMMUNITY_RESOURCE_TYPES live in lib/communityTypes.ts
// (client-safe), not here — ResourcesSection ("use client") needs
// COMMUNITY_RESOURCE_TYPES as a value for its type dropdown, and a
// non-type-only import from this file drags in supabaseServer.ts ->
// supabaseRoute.ts -> next/headers into the client bundle. Imported here,
// not redeclared, so there is exactly one list to keep in sync with the
// DB's CHECK constraint.

export type CommunityResource = {
  id: string;
  community_id: string;
  added_by: string;
  title: string;
  resource_type: CommunityResourceType;
  url: string | null;
  description: string;
  created_at: string;
  updated_at: string;
  /** Attached files — signed, short-lived URLs, resolved per request. See
   *  the "resource files" section below. Always [] for a title-only
   *  resource; a resource is still valid with a file, a url, both, or
   *  neither. */
  files: CommunityResourceFile[];
};

/** http(s) only, same rule and same reasoning as lib/server/projects.ts's
 *  safeFolderUrl()/lib/server/showcase.ts's safeLink(): a raw user-supplied
 *  string rendered as an href is an XSS vector (a `javascript:` URL is
 *  exactly what this rejects), checked HERE server-side because a
 *  browser-side check is a courtesy, not the rule. Unlike those two, a
 *  resource's url is OPTIONAL — a resource might just describe something
 *  offline — so an empty/blank input is valid and resolves to null, not an
 *  error; only a NON-EMPTY value that isn't a valid http(s) URL is
 *  rejected. */
function safeResourceUrl(v: string | null | undefined): { ok: true; url: string | null } | { ok: false } {
  const trimmed = (v ?? "").trim();
  if (!trimmed) return { ok: true, url: null };
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:"
      ? { ok: true, url: u.toString() }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Grouped by type on the page, for any ACTIVE member — "Community
 *  resources: member select" (2026-09-03_community_resources.sql) is the
 *  real gate, not this function, same posture as listAnnouncements. Sorted
 *  alphabetically by title; the page groups by resource_type client-side
 *  (filtering preserves this order within each group), same pattern as
 *  listMemberRoster's "admins first" sort + MembersSection's role-group
 *  filter. `added_by` display name is resolved by the caller through
 *  listMemberRoster()/community_member_roster(), never here. */
export async function listCommunityResources(communityId: string): Promise<CommunityResource[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];

  const { data, error } = await session.db
    .from("community_resources")
    .select("id, community_id, added_by, title, resource_type, url, description, created_at, updated_at")
    .eq("community_id", communityId)
    .order("title", { ascending: true });

  if (error || !data) return [];

  const filesByResource = await listCommunityResourceFilesForCommunity(session.db, communityId);
  return (data as Omit<CommunityResource, "files">[]).map((r) => ({
    ...r,
    files: filesByResource.get(r.id) ?? [],
  }));
}

export type CreateCommunityResourceResult =
  | { status: "ok"; id: string }
  | { status: "error"; error: string };

/** Add a resource. Admin-only — "Community resources: admin insert" (RLS)
 *  is the real gate, is_community_admin re-checked below purely for a
 *  clear message instead of a raw 42501. added_by comes from the session,
 *  never the caller's input, same as author_id in createAnnouncement. */
export async function createCommunityResource(
  communityId: string,
  input: { title: string; resource_type: string; url: string; description: string }
): Promise<CreateCommunityResourceResult> {
  const { user, db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can add a resource." };
  }

  const title = input.title.trim();
  if (!title) return { status: "error", error: "A title is required." };

  if (!COMMUNITY_RESOURCE_TYPES.includes(input.resource_type as CommunityResourceType)) {
    return { status: "error", error: "Choose a valid resource type." };
  }

  const safeUrl = safeResourceUrl(input.url);
  if (!safeUrl.ok) {
    return { status: "error", error: "Please paste a valid http:// or https:// link, or leave it blank." };
  }

  const { data, error } = await db
    .from("community_resources")
    .insert({
      community_id: communityId,
      added_by: user.id,
      title,
      resource_type: input.resource_type,
      url: safeUrl.url,
      description: input.description.trim(),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createCommunityResource: insert failed", error);

    // Same split as every other write in this file.
    if (error?.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't add the resource — ${error.message}.` };
    }
    return {
      status: "error",
      error:
        "Couldn't add the resource — this is a server-side problem, not something wrong with what you did. Check the server log (code: " +
        (error?.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok", id: data.id };
}

export type UpdateCommunityResourceResult = { status: "ok" } | { status: "error"; error: string };

/** Edit a resource. Admin-only — "Community resources: admin update" (RLS)
 *  is the real gate. */
export async function updateCommunityResource(
  communityId: string,
  resourceId: string,
  input: { title: string; resource_type: string; url: string; description: string }
): Promise<UpdateCommunityResourceResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can edit a resource." };
  }

  const title = input.title.trim();
  if (!title) return { status: "error", error: "A title is required." };

  if (!COMMUNITY_RESOURCE_TYPES.includes(input.resource_type as CommunityResourceType)) {
    return { status: "error", error: "Choose a valid resource type." };
  }

  const safeUrl = safeResourceUrl(input.url);
  if (!safeUrl.ok) {
    return { status: "error", error: "Please paste a valid http:// or https:// link, or leave it blank." };
  }

  const { error } = await db
    .from("community_resources")
    .update({
      title,
      resource_type: input.resource_type,
      url: safeUrl.url,
      description: input.description.trim(),
    })
    .eq("id", resourceId)
    .eq("community_id", communityId);

  if (error) {
    console.error("updateCommunityResource: update failed", error);

    // Same split as every other write in this file.
    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't save the resource — ${error.message}.` };
    }
    return {
      status: "error",
      error:
        "Couldn't save the resource — this is a server-side problem, not something wrong with what you did. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

export type DeleteCommunityResourceResult = { status: "ok" } | { status: "error"; error: string };

/** Delete a resource. Admin-only — "Community resources: admin delete"
 *  (RLS) is the real gate. */
export async function deleteCommunityResource(
  communityId: string,
  resourceId: string
): Promise<DeleteCommunityResourceResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can delete a resource." };
  }

  const { error } = await db
    .from("community_resources")
    .delete()
    .eq("id", resourceId)
    .eq("community_id", communityId);

  if (error) {
    console.error("deleteCommunityResource: delete failed", error);

    // Same split as every other write in this file.
    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't delete the resource — ${error.message}.` };
    }
    return {
      status: "error",
      error:
        "Couldn't delete the resource — this is a server-side problem, not something wrong with what you did. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

// ── Resource files ───────────────────────────────────────────────────────
//
// One or more files (session slides, decks, protocols, documents) attached
// to a community_resources row — database/migrations/
// 2026-09-21_community_resource_files.sql +
// 2026-09-21_community_resource_files_storage.sql. Follows
// lib/server/showcase.ts's media-attachment pattern exactly (private
// bucket, signed URLs minted per request, 50 MB cap, same accepted mime
// set), with the ownership model swapped from owner-gated to admin-gated:
// a community resource is managed by any admin, not by whoever added it,
// so every write here re-checks getMembership(communityId).isAdmin rather
// than an owner_id match — RLS enforces the identical rule underneath (see
// the migration's own comments).

export const COMMUNITY_RESOURCE_FILES_BUCKET = "community-resource-files";

const MAX_RESOURCE_FILE_BYTES = 50 * 1024 * 1024; // 50 MB, same cap as showcase-media
const RESOURCE_FILE_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
]);

const RESOURCE_FILE_SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 minutes, matches showcase.ts's own TTL

export type CommunityResourceFile = {
  id: string;
  filename: string;
  sizeBytes: number;
  /** A signed, short-lived URL — never a stable/public one, since the
   *  community-resource-files bucket is private. Re-fetched per page load. */
  url: string;
};

/** Mint a short-lived signed URL for one object path. Throws if the calling
 *  client's role can't pass the bucket's SELECT policy for that path — RLS
 *  (member-only, no anon path at all) is what actually decides this. */
async function signCommunityResourceFilePath(db: Db, path: string): Promise<string> {
  const { data, error } = await db.storage
    .from(COMMUNITY_RESOURCE_FILES_BUCKET)
    .createSignedUrl(path, RESOURCE_FILE_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw error ?? new Error("Couldn't sign the file URL.");
  return data.signedUrl;
}

/** One query for every file attached to any resource in this community,
 *  grouped by resource_id — used by listCommunityResources so the
 *  Resources section can show each card's attached files without an N+1
 *  query per resource. An unsignable/orphaned row is dropped, not fatal to
 *  the list, same posture as listShowcaseMedia. */
async function listCommunityResourceFilesForCommunity(
  db: Db,
  communityId: string
): Promise<Map<string, CommunityResourceFile[]>> {
  const { data, error } = await db
    .from("community_resource_files")
    .select("id, resource_id, filename, size_bytes, url")
    .eq("community_id", communityId)
    .order("created_at", { ascending: true });
  if (error || !data) return new Map();

  const signed = await Promise.all(
    (data as Record<string, unknown>[]).map(async (row) => {
      try {
        return {
          resourceId: row.resource_id as string,
          file: {
            id: row.id as string,
            filename: row.filename as string,
            sizeBytes: row.size_bytes as number,
            url: await signCommunityResourceFilePath(db, row.url as string),
          } as CommunityResourceFile,
        };
      } catch {
        return null;
      }
    })
  );

  const byResource = new Map<string, CommunityResourceFile[]>();
  for (const entry of signed) {
    if (!entry) continue;
    const list = byResource.get(entry.resourceId) ?? [];
    list.push(entry.file);
    byResource.set(entry.resourceId, list);
  }
  return byResource;
}

/** Attach one file to a resource as a community admin. Validates type/size
 *  in app code (belt-and-suspenders on top of the bucket's own
 *  allowed_mime_types/file_size_limit) and throws with a message the
 *  caller can show directly. */
export async function addCommunityResourceFile(
  communityId: string,
  resourceId: string,
  file: File
): Promise<CommunityResourceFile> {
  const { user, db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) throw new Error("Only a community admin can attach a file.");

  if (!file || file.size === 0) throw new Error("No file selected.");
  if (!RESOURCE_FILE_ALLOWED_MIME.has(file.type)) throw new Error("Use PNG, JPEG, WebP, GIF, PDF or PPTX.");
  if (file.size > MAX_RESOURCE_FILE_BYTES) throw new Error("File must be under 50 MB.");

  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${communityId}/${crypto.randomUUID()}.${ext || "bin"}`;

  const { error: uploadError } = await db.storage
    .from(COMMUNITY_RESOURCE_FILES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await db
    .from("community_resource_files")
    .insert({
      resource_id: resourceId,
      community_id: communityId,
      added_by: user.id, // from the session, never the body
      filename: file.name.slice(0, 200),
      size_bytes: file.size,
      url: path, // the storage PATH — see the field comment in the migration
    })
    .select("id, filename, size_bytes")
    .single();

  if (error || !data) {
    // Roll back the just-uploaded object rather than leaving an orphan no
    // one can ever see or remove (it has no DB row to list it by).
    await db.storage.from(COMMUNITY_RESOURCE_FILES_BUCKET).remove([path]);
    throw error ?? new Error("Couldn't save the attachment. Please try again.");
  }

  return {
    id: data.id as string,
    filename: data.filename as string,
    sizeBytes: data.size_bytes as number,
    url: await signCommunityResourceFilePath(db, path),
  };
}

/** Remove one attached file as a community admin. */
export async function removeCommunityResourceFile(
  communityId: string,
  resourceId: string,
  fileId: string
): Promise<void> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) throw new Error("Only a community admin can remove a file.");

  const { data, error } = await db
    .from("community_resource_files")
    .delete()
    .eq("id", fileId)
    .eq("resource_id", resourceId)
    .eq("community_id", communityId)
    .select("url")
    .maybeSingle();
  if (error) throw error;

  const path = (data?.url as string) ?? null;
  if (path) {
    const { error: rmErr } = await db.storage.from(COMMUNITY_RESOURCE_FILES_BUCKET).remove([path]);
    if (rmErr) console.error("community resource file cleanup failed", rmErr, path);
  }
}

// ── Explore feed ─────────────────────────────────────────────────────────

export type UpdateExploreConfigResult = { status: "ok" } | { status: "error"; error: string };

/** Save which sources this community searches and what topics drive that
 *  search — admin-only, same is_community_admin re-check pattern as
 *  updateCommunitySections. Does NOT run a refresh itself; a saved config
 *  only takes effect the next time an admin clicks Refresh (see
 *  refreshCommunityFeed below) — "stored, not live" applies to the config
 *  too, not just the results it produces.
 *
 *  `paperScope`/`grantActivityCodes` are the audience-scope fields
 *  (2026-09-17_community_feed_audience_scope.sql) — see that migration's
 *  own header on why these live on the community, not the topic. */
export async function updateCommunityExploreConfig(
  communityId: string,
  sources: string[],
  topics: string[],
  paperScope: "all" | "clinical" = "all",
  grantActivityCodes: string[] = []
): Promise<UpdateExploreConfigResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can change the feed." };
  }

  const cleanSources = resolveExploreSources(sources);
  const cleanTopics = Array.from(new Set(topics.map((t) => t.trim()).filter(Boolean)));
  const cleanActivityCodes = Array.from(
    new Set(grantActivityCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))
  );

  const { error } = await db
    .from("communities")
    .update({
      explore_sources: cleanSources,
      explore_topics: cleanTopics,
      explore_paper_scope: paperScope === "clinical" ? "clinical" : "all",
      explore_grant_activity_codes: cleanActivityCodes,
    })
    .eq("id", communityId);

  if (error) {
    console.error("updateCommunityExploreConfig: update failed", error);

    // Same split as every other write in this file.
    if (error.code === "P0001" && error.message) {
      return { status: "error", error: `Couldn't save the feed settings — ${error.message}.` };
    }
    return {
      status: "error",
      error:
        "Couldn't save the feed settings — this is a server-side problem, not something wrong with what you chose. Check the server log (code: " +
        (error.code ?? "unknown") +
        ").",
    };
  }

  return { status: "ok" };
}

export type CommunityFeedItem = {
  id: string;
  community_id: string;
  kind: string;
  external_id: string;
  title: string;
  url: string | null;
  summary: string | null;
  source: string | null;
  // The ITEM's own publication date (ExploreItem.date_iso), not when Refresh
  // happened to run — NULL when the source gave nothing parseable (see
  // normalizePublishedAt below). What the feed sorts and displays by, since
  // "the publication date matters most" for telling a 2019 result apart
  // from one from last week.
  published_at: string | null;
  // ExploreItem's own `raw`/`signal`, carried through verbatim — this is
  // what lets ResourcesSection render each item through the SAME
  // components/ItemCard.tsx Explore uses (a dataset/geneset/trial/compound/
  // target card's type-specific metadata all comes from `raw`; `signal`
  // drives the citation/star badge). See feedItemToExploreItem() in
  // ResourcesSection.tsx for how this is reassembled into an ExploreItem.
  raw: Record<string, unknown> | null;
  signal: { metric: string; value: number; as_of: string } | null;
  fetched_at: string;
};

/** The community's stored feed, newest-published first within each kind —
 *  for any ACTIVE member, "Community feed items: member select" (RLS) is
 *  the real gate, same posture as listCommunityResources/listAnnouncements.
 *  This is what's IN the database right now, i.e. as of the last Refresh —
 *  never a live search, per spec.
 *
 *  WORKS SIGNED OUT TOO, as of 2026-09-20_community_public_roster.sql —
 *  "Community feed items: public preview select" (RLS) now also covers
 *  public_preview = 'open', not just 'standard', so a non-member's read
 *  through this SAME function/query returns the FULL feed for an open
 *  community (getCommunityFeedPreview is still what the 'standard' case
 *  uses for its capped 3-4-item version — this function was never that
 *  cap, and 'open' wants the uncapped view a member sees). Falls back to
 *  the anon server client when there's no session, same pattern as
 *  listMemberRoster's own generalization.
 *
 *  Ordered by published_at desc (nulls last, then fetched_at desc as a
 *  stable tie-break for same-date or unknown-date items) — NOT by
 *  fetched_at, which only says when this Refresh ran, not how new the item
 *  itself is. ResourcesSection groups by kind client-side and relies on
 *  this order surviving that filter. */
export async function listCommunityFeedItems(communityId: string): Promise<CommunityFeedItem[]> {
  noStore();
  const session = await getSession();
  const db = session ? session.db : getAnonServerClient();
  if (!db) return [];

  const { data, error } = await db
    .from("community_feed_items")
    .select(
      "id, community_id, kind, external_id, title, url, summary, source, published_at, raw, signal, fetched_at"
    )
    .eq("community_id", communityId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("fetched_at", { ascending: false });

  if (error || !data) return [];
  return data as CommunityFeedItem[];
}

export type CommunityFeedPreviewItem = { title: string; source: string | null };
export type CommunityFeedPreview = { count: number; items: CommunityFeedPreviewItem[] };

const FEED_PREVIEW_ITEM_LIMIT = 4;

/** A signed-out-safe preview of the STORED feed for a non-member — the
 *  SAME community_feed_items table listCommunityFeedItems reads member-
 *  side (never a separate query, never a separate table), title and
 *  source only, up to FEED_PREVIEW_ITEM_LIMIT items, plus the TOTAL count
 *  (unbounded by that limit — Supabase's exact count ignores .limit()).
 *
 *  RLS IS THE GATE, NOT THIS FUNCTION. Goes through the anon server client
 *  — the same one getCommunityBySlug/getCommunityById already use for
 *  every other public community read — never a service-role client, so
 *  "Community feed items: public preview select"
 *  (2026-09-18_community_public_preview.sql) is what actually decides
 *  whether anything comes back: a community whose public_preview isn't
 *  'standard' gets {count: 0, items: []} here for exactly the same reason
 *  a direct forged query would — this function has no special access
 *  beyond what that policy grants anyone.
 *
 *  Degrades to {count: 0, items: []} on any read failure — a preview is a
 *  nice-to-have on a page whose main job (name, purpose, join) must still
 *  render regardless. */
export async function getCommunityFeedPreview(communityId: string): Promise<CommunityFeedPreview> {
  const supabase = getAnonServerClient();
  if (!supabase) return { count: 0, items: [] };

  const { data, count, error } = await supabase
    .from("community_feed_items")
    .select("title, source", { count: "exact" })
    .eq("community_id", communityId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("fetched_at", { ascending: false })
    .limit(FEED_PREVIEW_ITEM_LIMIT);

  if (error || !data) return { count: 0, items: [] };
  return { count: count ?? data.length, items: data as CommunityFeedPreviewItem[] };
}

/** Why a configured source ended up with zero stored items: "empty" means
 *  the backend answered normally and just had nothing for that topic;
 *  "rejected" means at least one call for that source got a non-2xx (or
 *  network-level failure) — a 401 from a missing/wrong EXPLORE_API_TOKEN
 *  looks EXACTLY like a real zero-result search unless this is tracked
 *  separately, which is the whole reason this type exists. */
export type SourceOutcome = { kind: string; reason: "empty" | "rejected" };

export type RefreshFeedResult =
  | { status: "ok"; count: number; emptySources: SourceOutcome[] }
  | { status: "error"; error: string; emptySources: SourceOutcome[] };

// explore-mcp's to_iso() (backend/explore-mcp/sources/base.py) falls back to
// this exact sentinel whenever a source's date string was unparseable —
// never a real publication date. Stored as NULL instead of a bogus
// 1970-01-01 that would otherwise sort dead last and render as "the oldest
// paper on Earth".
const EPOCH_DATE_ISO = "1970-01-01T00:00:00.000Z";

/** ExploreItem.date_iso -> what community_feed_items.published_at stores.
 *  NULL for a missing or epoch-sentinel value; otherwise passed through
 *  as-is (already a real ISO string — see to_iso()). */
function normalizePublishedAt(dateIso: string | null | undefined): string | null {
  if (!dateIso || dateIso === EPOCH_DATE_ISO) return null;
  return dateIso;
}

/** Max items PER TOPIC, per source, pulled from /api/explore-source before
 *  merge+dedupe — kept modest since one Refresh fires sources × topics
 *  fetches, not one search. */
const FEED_PER_TOPIC_LIMIT = 10;

/** Max items stored per kind, after merging every topic's results for that
 *  source and de-duplicating by external id — keeps one broad topic from
 *  crowding out the community's other topics in what actually gets stored. */
const FEED_PER_KIND_LIMIT = 20;

/** Run the community's selected sources against its selected topics and
 *  REPLACE the stored feed — admin-only. Reuses the exact same per-source
 *  search functions as the rest of Explore, through the new
 *  /api/explore-source dispatch bridge (backend/explore-mcp/server.py); no
 *  new search/ranking logic lives here, only orchestration and storage.
 *
 *  WIPES then re-inserts the community's ENTIRE feed every run, rather than
 *  only touching the currently-selected kinds — so deselecting a source and
 *  refreshing actually clears its old items instead of stranding them with
 *  nothing left to ever delete them. That wipe-then-insert, inside the
 *  UNIQUE (community_id, kind, external_id) constraint, is also what makes
 *  "a refresh must update rather than duplicate" true: the stored feed
 *  after a Refresh always exactly matches sources × topics as configured AT
 *  THAT MOMENT, never a superset of every Refresh that ever ran.
 *
 *  A community with no sources or no topics configured still "succeeds"
 *  (feed is simply empty, explore_refreshed_at still stamped) rather than
 *  erroring — an admin who clicks Refresh before finishing setup should see
 *  "Last refreshed just now", not a confusing failure.
 *
 *  BUT a community that HAS sources/topics configured and gets ZERO items
 *  back from every one of them (every upstream call failed, or a genuinely
 *  bad run) does NOT wipe the existing feed — the delete only happens once
 *  there's something to replace it with. An admin refreshing right before
 *  showing the community's feed to someone needs the OLD, working feed to
 *  survive a bad Refresh, not silently end up with nothing. That run is
 *  reported as a failure (status: "error"), and explore_refreshed_at is
 *  left untouched, so "Last refreshed" keeps pointing at the last run that
 *  actually produced something.
 *
 *  `emptySources` (on both outcomes) lists which of the CONFIGURED sources
 *  came back with zero items on this run — on success that's a partial
 *  result worth surfacing ("Papers: 6 found; Trials: nothing"), on failure
 *  it's every configured source (nothing came back from any of them). */
export async function refreshCommunityFeed(communityId: string): Promise<RefreshFeedResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can refresh the feed.", emptySources: [] };
  }

  const { data: config, error: readError } = await db
    .from("communities")
    .select("explore_sources, explore_topics, explore_paper_scope, explore_grant_activity_codes")
    .eq("id", communityId)
    .maybeSingle();

  if (readError || !config) {
    console.error("refreshCommunityFeed: couldn't read community config", readError);
    return { status: "error", error: "Couldn't read this community's feed settings.", emptySources: [] };
  }

  const sources = resolveExploreSources(config.explore_sources as string[] | null);
  const topics = ((config.explore_topics as string[] | null) ?? []).map((t) => t.trim()).filter(Boolean);
  // Audience-scope options — forwarded to the backend as `options`, read
  // only by kind="paper"/"grant" there (see server.py's _SOURCE_DISPATCH).
  // Built once here, reused for every (source, topic) fetch below.
  const paperScope = (config.explore_paper_scope as string | null) ?? "all";
  const grantActivityCodes = (config.explore_grant_activity_codes as string[] | null) ?? [];
  const sourceOptions: Record<string, unknown> = {};
  if (paperScope === "clinical") sourceOptions.clinical_scope = true;
  if (grantActivityCodes.length > 0) sourceOptions.activity_codes = grantActivityCodes;

  type FeedRow = {
    community_id: string;
    kind: string;
    external_id: string;
    title: string;
    url: string | null;
    summary: string | null;
    source: string | null;
    published_at: string | null;
    raw: Record<string, unknown> | null;
    signal: { metric: string; value: number; as_of: string } | null;
  };
  const rows: FeedRow[] = [];
  let emptySources: SourceOutcome[] = [];

  if (sources.length > 0 && topics.length > 0) {
    const fetches = sources.flatMap((kind) =>
      topics.map(async (topic) => {
        try {
          const res = await fetch(`${EXPLORE_API_URL}/api/explore-source`, {
            method: "POST",
            headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              kind,
              query: topic,
              limit: FEED_PER_TOPIC_LIMIT,
              options: sourceOptions,
            }),
          });

          // A non-2xx here (401 from a missing/wrong EXPLORE_API_TOKEN,
          // 5xx, ...) must NOT be treated as "the search ran and found
          // nothing" — /api/explore-source's own body on a rejection looks
          // nothing like {items: [...]}, so silently reading `.items` off
          // it and defaulting to [] is exactly how a rejected request and a
          // genuine zero-result search became indistinguishable. Logged
          // with the status and a body snippet so this is visible in the
          // server log instead of only showing up as "found nothing".
          if (!res.ok) {
            let bodySnippet = "";
            try {
              bodySnippet = (await res.text()).slice(0, 500);
            } catch {
              // body unreadable — status code alone is still useful
            }
            console.error(
              "refreshCommunityFeed: /api/explore-source rejected the request",
              { kind, topic, status: res.status, statusText: res.statusText, body: bodySnippet }
            );
            return { kind, topic, items: [] as ExploreItem[], failed: true };
          }

          const json = (await res.json()) as { items?: ExploreItem[] };
          return { kind, topic, items: json.items ?? [], failed: false };
        } catch (e) {
          // One topic/source failing must never fail the whole refresh —
          // same "never let one bad call break the batch" posture as
          // /api/explore-source's own never-500s design, extended one level
          // up: a bad upstream just means fewer stored results, not a
          // failed Refresh. Still a genuine failure (network error, bad
          // JSON, ...), so it's tracked as `failed` the same as a non-2xx
          // response above, not conflated with a real empty result.
          console.error("refreshCommunityFeed: fetch failed", kind, topic, e);
          return { kind, topic, items: [] as ExploreItem[], failed: true };
        }
      })
    );

    const results = await Promise.all(fetches);

    // Group every topic's results per kind, de-duping by external id
    // (item.id, falling back to dedupe_key for a source that doesn't set
    // id) WITHIN that topic's own bucket — cross-topic de-dup happens at
    // allocation time below (allocateByTopic's `used` set), not here.
    // `failedKinds` tracks which sources had AT LEAST ONE rejected/errored
    // call, so a source that's empty ONLY because the backend rejected it
    // can be reported as such rather than as a quiet zero-result search.
    const byKindTopic = new Map<string, Map<string, Map<string, ExploreItem>>>();
    const failedKinds = new Set<string>();
    for (const { kind, topic, items, failed } of results) {
      if (failed) failedKinds.add(kind);
      const topicMap = byKindTopic.get(kind) ?? new Map<string, Map<string, ExploreItem>>();
      const bucket = topicMap.get(topic) ?? new Map<string, ExploreItem>();
      for (const item of items) {
        const externalId = item.id || item.dedupe_key;
        if (!externalId || bucket.has(externalId)) continue;
        bucket.set(externalId, item);
      }
      topicMap.set(topic, bucket);
      byKindTopic.set(kind, topicMap);
    }

    // ALLOCATION, PER KIND: every topic that returned at least one item
    // gets a GUARANTEED slot (in topic order, not competing on recency for
    // it) before anything else is picked — this is the fix for the bug
    // where merging every topic into one pool and sorting by date let a
    // single prolific/fresh topic fill the entire per-kind cap, leaving
    // every other topic's members with nothing. Only after every topic has
    // its floor slot does the REMAINDER get filled from whatever's left
    // over, pooled across all topics and sorted by recency — a genuinely
    // more active or fresher topic still earns extra slots, just never at
    // the cost of another topic getting zero. With topics >= the per-kind
    // cap this degrades gracefully to "one each, whichever fit", which is
    // exactly the right behavior, not a special case to code around.
    function allocateByTopic(topicMap: Map<string, Map<string, ExploreItem>>): ExploreItem[] {
      const used = new Set<string>();
      const selected: ExploreItem[] = [];

      for (const topic of topics) {
        const bucket = topicMap.get(topic);
        if (!bucket) continue;
        for (const item of bucket.values()) {
          const id = (item.id || item.dedupe_key) as string;
          if (used.has(id)) continue;
          selected.push(item);
          used.add(id);
          break; // exactly one floor slot per topic
        }
      }

      const remainderPool: ExploreItem[] = [];
      for (const bucket of topicMap.values()) {
        for (const item of bucket.values()) {
          const id = (item.id || item.dedupe_key) as string;
          if (used.has(id)) continue;
          used.add(id); // provisional — also guards against the same id from another topic's bucket
          remainderPool.push(item);
        }
      }
      remainderPool.sort((a, b) => (b.date_iso || "").localeCompare(a.date_iso || ""));

      const remainingSlots = Math.max(0, FEED_PER_KIND_LIMIT - selected.length);
      selected.push(...remainderPool.slice(0, remainingSlots));
      return selected;
    }

    const byKind = new Map<string, ExploreItem[]>();
    for (const [kind, topicMap] of byKindTopic) {
      byKind.set(kind, allocateByTopic(topicMap));
    }

    // A source with no allocated items found nothing across every topic —
    // reported back regardless of outcome below, so an admin can tell "8
    // papers, but Grants came back empty" apart from a clean run of
    // everything, AND tell that apart from "Grants was rejected by the
    // backend", which looks identical from the item count alone.
    emptySources = sources
      .filter((kind) => (byKind.get(kind)?.length ?? 0) === 0)
      .map((kind) => ({ kind, reason: failedKinds.has(kind) ? "rejected" : "empty" }) as const);

    for (const [kind, items] of byKind) {
      for (const item of items) {
        rows.push({
          community_id: communityId,
          kind,
          external_id: (item.id || item.dedupe_key) as string,
          title: item.title,
          url: item.url,
          summary: item.summary,
          source: item.source,
          published_at: normalizePublishedAt(item.date_iso),
          // Whatever /api/explore-source already returned — trimmed for
          // pubmed/openalex/crossref (just {prior_signal, sources}, per
          // response.py), untouched for geo/pager/clinicaltrials/chembl/
          // opentargets. Stored as-is so ItemCard's per-kind metadata
          // blocks (organism, trial status, ChEMBL phase, ...) work
          // identically here to how they work on Explore itself.
          raw: item.raw ?? null,
          signal: item.signal ?? null,
        });
      }
    }

    // Every configured source came back empty (upstream failures, or a
    // genuinely bad run) — do NOT touch the existing feed. Wiping it here
    // would silently replace a working feed with nothing; leave it alone
    // and report this run as a failure instead. The message distinguishes
    // "the backend rejected every request" (a real, actionable problem —
    // check EXPLORE_API_TOKEN/logs) from "every search genuinely found
    // nothing" (a topics/sources problem, not a backend one).
    if (rows.length === 0) {
      const allRejected = emptySources.every((s) => s.reason === "rejected");
      const anyRejected = emptySources.some((s) => s.reason === "rejected");
      const error = allRejected
        ? "The backend rejected every request (see the server log for the status code) — the feed hasn't changed."
        : anyRejected
          ? "The backend rejected some requests and the rest found nothing — the feed hasn't changed."
          : "No results came back from any selected source — the feed hasn't changed.";
      return { status: "error", error, emptySources };
    }
  }

  // Delete-then-insert, both gated by the SAME admin RLS tier — see this
  // function's own comment above for why a full wipe rather than a
  // per-kind delete. Only reached once we know there's something to
  // replace the old feed with (rows.length > 0) or nothing was configured
  // at all (rows stays [] on purpose, same "none selected -> no feed" rule
  // as at read time) — never reached after an all-sources-failed run, see
  // the early return above.
  const { error: deleteError } = await db
    .from("community_feed_items")
    .delete()
    .eq("community_id", communityId);

  if (deleteError) {
    console.error("refreshCommunityFeed: delete failed", deleteError);
    return { status: "error", error: "Couldn't refresh the feed — clearing the old items failed.", emptySources };
  }

  if (rows.length > 0) {
    const { error: insertError } = await db.from("community_feed_items").insert(rows);
    if (insertError) {
      console.error("refreshCommunityFeed: insert failed", insertError);
      return { status: "error", error: "Couldn't refresh the feed — storing the new items failed.", emptySources };
    }
  }

  const { error: stampError } = await db
    .from("communities")
    .update({ explore_refreshed_at: new Date().toISOString() })
    .eq("id", communityId);

  if (stampError) {
    // The refresh itself succeeded — rows are already stored — so a failed
    // timestamp stamp is logged, not reported to the admin as a failure.
    console.error("refreshCommunityFeed: stamping explore_refreshed_at failed", stampError);
  }

  return { status: "ok", count: rows.length, emptySources };
}

export type CommunityProject = {
  id: string;
  name: string;
  description: string | null;
  stage: string | null;
};

/** A community's projects — any active member can see the list (RLS:
 *  "Projects: member or community select", 2026-08-30). Full project detail
 *  (checklist, resources, shared folder) stays gated to actual project
 *  members, unchanged — this is only the summary row. */
export async function listCommunityProjects(communityId: string): Promise<CommunityProject[]> {
  const session = await getSession();
  if (!session) return [];

  const { data, error } = await session.db
    .from("projects")
    .select("id, name, description, stage")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data as CommunityProject[];
}

// ── Activity ─────────────────────────────────────────────────────────────

export type CommunityStats = { memberCount: number; joinedLast7d: number };

/** Public activity counts — works signed out (community_member_stats is a
 *  SECURITY DEFINER RPC granted to anon). Degrades to zeros so a stats
 *  failure never blocks rendering the page. */
export async function getCommunityStats(communityId: string): Promise<CommunityStats> {
  const supabase = getAnonServerClient();
  if (!supabase) return { memberCount: 0, joinedLast7d: 0 };

  const { data, error } = await supabase
    .rpc("community_member_stats", { p_community_id: communityId })
    .maybeSingle();

  if (error || !data) return { memberCount: 0, joinedLast7d: 0 };
  const row = data as { member_count: number | string; joined_last_7d: number | string };
  return {
    memberCount: Number(row.member_count) || 0,
    joinedLast7d: Number(row.joined_last_7d) || 0,
  };
}
