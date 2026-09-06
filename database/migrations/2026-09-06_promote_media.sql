-- =============================================================================
-- Migration: promote_showcase_media — CORE  (2026-09-06)   [RUN THIS FIRST]
-- =============================================================================
-- Multiple media attachments (images, slide decks) per Promote article,
-- replacing the old single `image_url` column for anything submitted through
-- the new unified /promote/submit flow. `image_url` and the showcase-images
-- bucket are left in place, untouched, for whatever pre-existing rows still
-- use them — nothing here migrates old data.
--
-- Touches ONLY the `public` schema, so it cannot fail on storage permissions.
-- SPLIT DELIBERATELY from the storage bucket/policy setup in
-- 2026-09-06_promote_media_storage.sql for the same reason
-- 2026-07-26_promote_showcase.sql was split from its storage migration: the
-- Supabase SQL editor runs a script as ONE transaction, and
-- `CREATE POLICY ... ON storage.objects` fails with "must be owner of table
-- objects" on many projects, which would roll back this table too.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.promote_showcase_media (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    showcase_id UUID        NOT NULL REFERENCES public.promote_showcase (id) ON DELETE CASCADE,
    owner_id    UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    -- Plain TEXT + CHECK, not an enum — same reasoning as resource_type on
    -- community_resources. A video or poster kind later is an ADD CONSTRAINT,
    -- not an ALTER TYPE + a transaction-locking migration.
    kind        TEXT        NOT NULL CHECK (kind IN ('image', 'slides')),
    -- The storage OBJECT PATH inside the private showcase-media bucket
    -- (`<showcase_id>/<uuid>.<ext>`), NOT a public URL — the bucket has no
    -- public read, so every render mints a short-lived signed URL from this
    -- path (see lib/server/showcase.ts:signMediaPath). Column named `url`
    -- to mirror promote_showcase.image_url's naming, but it is a path.
    url         TEXT        NOT NULL,
    filename    TEXT        NOT NULL,
    size_bytes  BIGINT      NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.promote_showcase_media ENABLE ROW LEVEL SECURITY;

-- Same published/owner split as promote_showcase itself: a file attached to
-- a published article is readable by anyone; a file attached to a draft is
-- readable only by its owner. This governs the promote_showcase_media ROW —
-- the storage.objects policies in the companion migration enforce the
-- identical rule again for the actual file bytes, since a row-readable check
-- here says nothing about who can fetch the object it points to.
DROP POLICY IF EXISTS "promote_showcase_media_select_published" ON public.promote_showcase_media;
CREATE POLICY "promote_showcase_media_select_published"
    ON public.promote_showcase_media FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.promote_showcase s
            WHERE s.id = showcase_id AND s.published = true
        )
    );

DROP POLICY IF EXISTS "promote_showcase_media_select_own" ON public.promote_showcase_media;
CREATE POLICY "promote_showcase_media_select_own"
    ON public.promote_showcase_media FOR SELECT
    TO authenticated
    USING (auth.uid() = owner_id);

-- Insert/delete: owner_id must be the caller AND the caller must actually own
-- the PARENT showcase row — checking owner_id alone would let anyone attach
-- media to somebody else's article by supplying their own owner_id with a
-- foreign showcase_id.
DROP POLICY IF EXISTS "promote_showcase_media_insert_own" ON public.promote_showcase_media;
CREATE POLICY "promote_showcase_media_insert_own"
    ON public.promote_showcase_media FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = owner_id
        AND EXISTS (
            SELECT 1 FROM public.promote_showcase s
            WHERE s.id = showcase_id AND s.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "promote_showcase_media_delete_own" ON public.promote_showcase_media;
CREATE POLICY "promote_showcase_media_delete_own"
    ON public.promote_showcase_media FOR DELETE
    TO authenticated
    USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_promote_showcase_media_showcase ON public.promote_showcase_media (showcase_id);

-- No SECURITY DEFINER function is added by this migration (unlike
-- showcase_owners() in 2026-07-26_promote_showcase.sql) — every policy above
-- is a plain subquery evaluated as the calling role, so there is nothing here
-- that needs its own REVOKE ALL FROM PUBLIC / GRANT EXECUTE pair. The
-- equivalent discipline for THIS migration is that every policy is scoped
-- `TO authenticated` except the published-select one, so `anon` only ever
-- matches the "parent is published" branch — never the owner branch.
