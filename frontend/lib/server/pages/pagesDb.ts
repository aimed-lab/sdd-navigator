// lib/server/pages/pagesDb.ts — shared plumbing for the new `pages` feature
// (supabase/migrations/2026-09-30_living_pages.sql): a service-role Supabase
// client (anonymous pages are written by the server only, bypassing RLS, per
// that migration's own header comment) and the slug helper POST /api/pages
// uses to mint `pages.slug`.
//
// A SEPARATE service-role client, not a reuse of
// lib/server/supabaseServer.ts's getServiceRoleClient() — that function's own
// docstring states "the ONLY caller is lib/auth.ts's deleteAccount()... If a
// second caller ever appears, that is the signal something is being done
// with the wrong trust level," and this task is additive-only (no edits to
// existing files' behavior). Rather than add a second caller to a function
// documented as single-purpose, this is the same construction, copied
// verbatim into a new file scoped to this new feature — same "copy-and-adapt
// rather than import-and-reuse" instruction this whole task follows
// elsewhere (wikiNotes.ts -> pageNotes.ts, wikiEvidence.ts -> pageEvidence.ts).

import { createClient } from "@supabase/supabase-js";

/** SERVICE-ROLE client for the `pages` feature only — bypasses RLS entirely,
 *  same as lib/server/supabaseServer.ts's own getServiceRoleClient(). Used
 *  because an anonymous (no-login) page has owner_id=null and there is no
 *  session to scope a normal request-scoped client to; the migration's RLS
 *  policies deliberately offer no INSERT path for a NULL owner_id (see
 *  2026-09-30_living_pages.sql's own OWNERSHIP MODEL note), so writing an
 *  anonymous page and its notes/evidence/updates can only be done from the
 *  server with this key. SERVER-ONLY: read from process.env, never given a
 *  NEXT_PUBLIC_ prefix, never imported by a "use client" component. Returns
 *  null when unconfigured so callers can fail cleanly instead of throwing at
 *  construction. */
export function getPagesServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** "Some Topic, With Punctuation!" -> "some-topic-with-punctuation". Same
 *  shape as lib/server/showcase.ts's own slugifyTitle (lowercase, strip
 *  accents, collapse non-alphanumerics to hyphens, trim to 80 chars) — copied
 *  rather than imported since that function isn't exported from showcase.ts.
 *  Falls back to "page" (not "article") if nothing latin/digit survives. */
export function slugifyTopic(topic: string): string {
  const base = topic
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents (combining diacritical marks)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base || "page";
}

/** Short random suffix appended to every new page's slug up front — unlike
 *  showcase.ts's own randomSlugSuffix (only appended on a retry after a
 *  collision), a page's slug always gets one: two people can seed a page
 *  with the identical topic string at any time (no ownership to disambiguate
 *  by), so collision is the COMMON case here, not the rare one a retry loop
 *  would be enough for. Same "not meant to be memorable" entropy shape. */
export function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

/** slug for a brand-new page: "<slugified topic>-<suffix>". Called once per
 *  POST /api/pages; see that route for the retry-on-23505 loop that also
 *  appends a fresh suffix on the rare case this still collides. */
export function newPageSlug(topic: string): string {
  return `${slugifyTopic(topic)}-${randomSlugSuffix()}`;
}

/** A short, simple title from a raw topic string: trimmed, collapsed
 *  whitespace, title-cased word-by-word. Deliberately simple per this task's
 *  own "keep it simple" instruction — no NLP, no acronym-casing special
 *  cases. */
export function titleFromTopic(topic: string): string {
  const collapsed = topic.trim().replace(/\s+/g, " ");
  return collapsed
    .split(" ")
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}
