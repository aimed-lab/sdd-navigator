-- =============================================================================
-- Migration: promote_showcase — CORE  (2026-07-26)   [RUN THIS FIRST]
-- =============================================================================
-- The Promote showcase gallery: table, RLS, indexes, and the owner-name reader.
-- Touches ONLY the `public` schema, so it cannot fail on storage permissions.
--
-- SPLIT DELIBERATELY from the storage setup. The Supabase SQL editor runs a
-- script as ONE TRANSACTION, and `CREATE POLICY ... ON storage.objects` fails
-- with "must be owner of table objects" on many projects — which rolls back the
-- WHOLE script, table included. (That is exactly what happened on the first
-- attempt: nothing landed.) Storage now lives in
-- 2026-07-26_promote_showcase_storage.sql and can fail harmlessly.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

-- ── 1. promote_showcase ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.promote_showcase (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    type        TEXT        NOT NULL
                    CHECK (type IN ('case_study', 'paper', 'white_paper', 'achievement')),
    title       TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    authors     TEXT        NOT NULL DEFAULT '',
    link        TEXT,                                   -- external link (nullable)
    image_url   TEXT,                                   -- uploaded figure (nullable)
    tags        TEXT[]      NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.promote_showcase ENABLE ROW LEVEL SECURITY;

-- Anyone (signed in or not) can browse the gallery — that is the point of a
-- showcase.
DROP POLICY IF EXISTS "promote_showcase_public_select" ON public.promote_showcase;
CREATE POLICY "promote_showcase_public_select"
    ON public.promote_showcase FOR SELECT
    USING (true);

-- Writes are owner-only. owner_id is derived from the session in
-- lib/server/showcase.ts; these policies make a forged owner_id fail in
-- Postgres rather than relying on app code.
DROP POLICY IF EXISTS "promote_showcase_insert_own" ON public.promote_showcase;
CREATE POLICY "promote_showcase_insert_own"
    ON public.promote_showcase FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "promote_showcase_update_own" ON public.promote_showcase;
CREATE POLICY "promote_showcase_update_own"
    ON public.promote_showcase FOR UPDATE
    TO authenticated
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "promote_showcase_delete_own" ON public.promote_showcase;
CREATE POLICY "promote_showcase_delete_own"
    ON public.promote_showcase FOR DELETE
    TO authenticated
    USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_promote_showcase_created ON public.promote_showcase (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promote_showcase_owner   ON public.promote_showcase (owner_id);
CREATE INDEX IF NOT EXISTS idx_promote_showcase_type    ON public.promote_showcase (type);
CREATE INDEX IF NOT EXISTS idx_promote_showcase_tags    ON public.promote_showcase USING GIN (tags);


-- ── 2. Public showcase-owner identity ────────────────────────────────────────
-- Same rule and same shape as collab_post_owners() (see
-- database/migrations/2026-07-26_collab_post_owners.sql):
--
--   Submitting to a public showcase identifies you BY NAME. It does not publish
--   your profile. public.users RLS is `SELECT USING (is_public = true)`, so a
--   plain join would render a private-profile submitter's card anonymous.
--
--   name / affiliation           -> always visible for a submitter
--   everything else on users     -> never exposed here (no email, bio, …)
--
-- No profile_slug: the showcase card credits an author line, it does not link
-- out to a researcher profile, so the slug is not needed and is not returned.

CREATE OR REPLACE FUNCTION public.showcase_owners()
RETURNS TABLE (
    id          UUID,
    name        TEXT,
    affiliation TEXT
)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT u.id, u.name, u.affiliation
    FROM public.users u
    WHERE EXISTS (
        SELECT 1 FROM public.promote_showcase s WHERE s.owner_id = u.id
    );
$$;

REVOKE ALL ON FUNCTION public.showcase_owners() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.showcase_owners() TO anon, authenticated;
