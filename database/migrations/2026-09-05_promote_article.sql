-- =============================================================================
-- Migration: promote_showcase — article fields (2026-09-05)
-- =============================================================================
-- Reworks "Promote" generation from copy-paste LinkedIn drafts into a
-- shareable article page (see lib/server/promote/generateArticle.ts and
-- app/promote/[slug]/page.tsx). Adds the columns an article needs and splits
-- the read policy into a published/owner-draft pair.
--
-- Idempotent — safe to re-run.
-- =============================================================================

-- ── 1. New columns ───────────────────────────────────────────────────────────
--
-- `published` is added with DEFAULT true FIRST so every row that exists today
-- backfills to visible — under the OLD policy (USING (true)) every one of
-- these rows was already fully public, so this is not a behavior change for
-- them. The DEFAULT is then flipped to false, so a NEW row (a freshly
-- generated article) starts life as a private draft unless the app
-- explicitly publishes it. lib/server/showcase.ts's existing
-- createShowcaseEntry (the manual case-study/paper/white-paper/achievement
-- submit form, unrelated to the generator) sets published: true explicitly
-- on insert so that flow keeps behaving exactly as it does today.
ALTER TABLE public.promote_showcase
    ADD COLUMN IF NOT EXISTS slug         TEXT,
    ADD COLUMN IF NOT EXISTS headline     TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS standfirst   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS article_body TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS journal      TEXT,
    ADD COLUMN IF NOT EXISTS doi          TEXT,
    ADD COLUMN IF NOT EXISTS published    BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.promote_showcase ALTER COLUMN published SET DEFAULT false;

-- slug is unique among rows that HAVE one (older/manual entries have none and
-- never get a public article page) — a partial unique index rather than a
-- table-wide UNIQUE constraint, since a plain UNIQUE treats every NULL as
-- distinct anyway, but being explicit here is clearer than relying on that.
DROP INDEX IF EXISTS idx_promote_showcase_slug;
CREATE UNIQUE INDEX idx_promote_showcase_slug
    ON public.promote_showcase (slug)
    WHERE slug IS NOT NULL;

-- ── 2. RLS: published rows are public, drafts are owner-only ────────────────
--
-- The old "promote_showcase_public_select" policy was `USING (true)` — every
-- row, no exceptions, which was fine when every row WAS a finished showcase
-- submission. Now that a row can be an unpublished draft article, that policy
-- would leak drafts to anyone (anon included). Replaced with two SELECT
-- policies; Postgres OR's multiple permissive policies on the same command
-- together, so a row is readable if EITHER applies:
--   - anyone (including anon) may read a PUBLISHED row
--   - the signed-in owner may always read their OWN row, published or not
DROP POLICY IF EXISTS "promote_showcase_public_select" ON public.promote_showcase;

DROP POLICY IF EXISTS "promote_showcase_select_published" ON public.promote_showcase;
CREATE POLICY "promote_showcase_select_published"
    ON public.promote_showcase FOR SELECT
    USING (published = true);

DROP POLICY IF EXISTS "promote_showcase_select_own" ON public.promote_showcase;
CREATE POLICY "promote_showcase_select_own"
    ON public.promote_showcase FOR SELECT
    TO authenticated
    USING (auth.uid() = owner_id);

-- Insert/update/delete policies (promote_showcase_insert_own /
-- _update_own / _delete_own) are untouched — owner-only, unaffected by this
-- migration, still enforce auth.uid() = owner_id exactly as before. A
-- publish/unpublish toggle is just an UPDATE of `published` and already
-- passes through promote_showcase_update_own.
