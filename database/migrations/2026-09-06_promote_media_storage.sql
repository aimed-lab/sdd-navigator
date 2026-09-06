-- =============================================================================
-- Migration: showcase-media storage bucket + policies  (2026-09-06)
-- =============================================================================
-- Run AFTER 2026-09-06_promote_media.sql (that one creates
-- promote_showcase_media, which the policies below reference).
--
-- SPLIT DELIBERATELY from the table migration: the Supabase SQL editor runs a
-- script as ONE transaction, and `CREATE POLICY ... ON storage.objects` fails
-- with "must be owner of table objects" on many projects — which would roll
-- back the table too. If this section errors, create the bucket in the
-- dashboard instead (Storage → New bucket → name "showcase-media", Public
-- OFF, file size limit 50 MB) and run only the policies below.
--
-- PRIVATE bucket, unlike showcase-images. A slide deck attached to an
-- unpublished draft must not be fetchable by anyone who guesses its URL, so
-- there is no public-read grant here at all — every read, published or not,
-- goes through a signed URL (see lib/server/showcase.ts:signMediaPath), and
-- Postgres RLS decides whether the signing call itself is allowed to
-- succeed. The 50 MB limit (vs. showcase-images' app-level 5 MB) is sized for
-- a slide deck — a routine PPTX is 20-50 MB.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'showcase-media',
    'showcase-media',
    false,
    52428800, -- 50 MB
    ARRAY[
        'image/png', 'image/jpeg', 'image/webp', 'image/gif',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation' -- .pptx
    ]
)
ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = 52428800,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Object path convention is `<showcase_id>/<uuid>.<ext>` — the showcase's id
-- as the top-level folder, NOT the uploader's uid (unlike showcase-images).
-- That is what lets the policies below key off promote_showcase.published
-- via storage.foldername(name)[1], the same is_project_member()-by-folder
-- pattern project-proposals uses, just inlined as a subquery instead of a
-- separate function since it's only used here.

-- SELECT: readable if EITHER the parent article is published (any role,
-- anon included — this is what lets the public /promote/[slug] page mint a
-- signed URL for a published article's media using the anon client) OR the
-- caller owns the parent article (drafts, for the owner's own editor).
DROP POLICY IF EXISTS "showcase_media_select_published" ON storage.objects;
CREATE POLICY "showcase_media_select_published"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'showcase-media'
        AND EXISTS (
            SELECT 1 FROM public.promote_showcase s
            WHERE s.id::text = (storage.foldername(name))[1] AND s.published = true
        )
    );

DROP POLICY IF EXISTS "showcase_media_select_own" ON storage.objects;
CREATE POLICY "showcase_media_select_own"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'showcase-media'
        AND EXISTS (
            SELECT 1 FROM public.promote_showcase s
            WHERE s.id::text = (storage.foldername(name))[1] AND s.owner_id = auth.uid()
        )
    );

-- INSERT/DELETE: only the owner of the showcase the folder names may write
-- into it — scoped `TO authenticated` only, so `anon` never matches either
-- policy below (there is deliberately no anon write path to this bucket).
DROP POLICY IF EXISTS "showcase_media_owner_insert" ON storage.objects;
CREATE POLICY "showcase_media_owner_insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'showcase-media'
        AND EXISTS (
            SELECT 1 FROM public.promote_showcase s
            WHERE s.id::text = (storage.foldername(name))[1] AND s.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "showcase_media_owner_delete" ON storage.objects;
CREATE POLICY "showcase_media_owner_delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'showcase-media'
        AND EXISTS (
            SELECT 1 FROM public.promote_showcase s
            WHERE s.id::text = (storage.foldername(name))[1] AND s.owner_id = auth.uid()
        )
    );
