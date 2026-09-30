-- =============================================================================
-- SDD Navigator — Storage buckets + policies (run SEPARATELY, AFTER 01_schema.sql)
-- =============================================================================
-- Everything here touches storage.objects / storage.buckets. It is split out
-- of 01_schema.sql on purpose, matching this repo's own standing convention
-- (see CLAUDE.md's "Gotchas" section, and database/schema.sql's and every
-- *_storage.sql migration's own header): the Supabase SQL editor runs a
-- pasted script as ONE transaction, and `CREATE POLICY ... ON storage.objects`
-- fails on many projects with:
--
--   ERROR: must be owner of table objects
--
-- If that happens to you here, it is an EXPECTED, DOCUMENTED fallback
-- situation, not a bug in this file: some Supabase projects don't grant the
-- SQL-editor role ownership of storage.objects. If any statement below
-- fails, don't retry the whole file — for the bucket in question, do this in
-- the Supabase dashboard instead:
--   1. Storage -> New bucket -> create it with the name and public/private
--      setting given below (and, where noted, a file-size limit + allowed
--      MIME types).
--   2. Storage -> <bucket> -> Policies -> add each policy listed below by
--      hand, using the same condition (translate `auth.uid()`, table
--      lookups, etc. exactly as written — the dashboard's policy editor
--      accepts the same SQL expressions).
-- Every feature that touches one of these buckets is written to degrade
-- cleanly if its bucket never gets created (an optional image stays NULL, a
-- proposal upload is simply unavailable) — see 2026-07-26_promote_showcase_
-- storage.sql's own header for the pattern this follows.
--
-- Idempotent: every INSERT uses `ON CONFLICT (id) DO UPDATE`, every POLICY is
-- preceded by `DROP POLICY IF EXISTS`. Safe to re-run, and safe to run only
-- the parts of this file that didn't error the first time.
-- =============================================================================


-- =============================================================================
-- BUCKET: showcase-images  (PUBLIC — optional figure upload on a showcase entry)
-- =============================================================================
-- Submitting without an image is fully supported — image_url simply stays
-- NULL and the card renders text-only. Dashboard fallback: Storage -> New
-- bucket -> name "showcase-images" -> Public bucket: ON.

INSERT INTO storage.buckets (id, name, public)
VALUES ('showcase-images', 'showcase-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Anyone can read an uploaded figure (the gallery is public).
DROP POLICY IF EXISTS "showcase_images_public_read" ON storage.objects;
CREATE POLICY "showcase_images_public_read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'showcase-images');

-- A signed-in user may upload only INTO THEIR OWN FOLDER — the first path
-- segment must be their uid, e.g. "<uid>/figure.png".
DROP POLICY IF EXISTS "showcase_images_own_insert" ON storage.objects;
CREATE POLICY "showcase_images_own_insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'showcase-images'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "showcase_images_own_delete" ON storage.objects;
CREATE POLICY "showcase_images_own_delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'showcase-images'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );


-- =============================================================================
-- BUCKET: showcase-media  (PRIVATE — images + slide decks on a Promote article)
-- =============================================================================
-- Unlike showcase-images, there is NO public-read grant — a file attached to
-- an unpublished draft must not be fetchable by guessing its URL; every read
-- goes through a short-lived signed URL, and RLS decides whether the signing
-- call is allowed to succeed. Object paths are `<showcase_id>/<uuid>.<ext>`
-- (the ARTICLE's id, not the uploader's uid). Dashboard fallback: Storage ->
-- New bucket -> name "showcase-media" -> Public bucket: OFF -> file size
-- limit 50 MB.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'showcase-media',
    'showcase-media',
    false,
    52428800, -- 50 MB — a routine slide deck is 20-50 MB
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

-- Readable if EITHER the parent article is published (any role, anon
-- included — lets the public /promote/[slug] page mint a signed URL using
-- the anon client) OR the caller owns the parent article.
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

-- Only the owner of the showcase the folder names may write into it.
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


-- =============================================================================
-- BUCKET: project-proposals  (PRIVATE — a project's proposal file upload)
-- =============================================================================
-- Dashboard fallback: Storage -> New bucket -> name "project-proposals" ->
-- Public bucket: OFF. Then, for `authenticated`, add SELECT/INSERT/DELETE
-- policies all using the condition:
--   public.is_project_member((storage.foldername(name))[1]::uuid, auth.uid())
-- Upload path convention: `<project_id>/<random>.<ext>`.

INSERT INTO storage.buckets (id, name, public)
VALUES ('project-proposals', 'project-proposals', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "project_proposals_member_select" ON storage.objects;
CREATE POLICY "project_proposals_member_select"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'project-proposals'
        AND public.is_project_member((storage.foldername(name))[1]::uuid, auth.uid())
    );

DROP POLICY IF EXISTS "project_proposals_member_insert" ON storage.objects;
CREATE POLICY "project_proposals_member_insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'project-proposals'
        AND public.is_project_member((storage.foldername(name))[1]::uuid, auth.uid())
    );

DROP POLICY IF EXISTS "project_proposals_member_delete" ON storage.objects;
CREATE POLICY "project_proposals_member_delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'project-proposals'
        AND public.is_project_member((storage.foldername(name))[1]::uuid, auth.uid())
    );


-- =============================================================================
-- BUCKET: community-resource-files  (PRIVATE — files attached to a community
-- resource: session slides, protocols, documents)
-- =============================================================================
-- Same posture as showcase-media: every read, member or admin, goes through
-- a signed URL, never a stable/public link — no anon branch at all (a
-- community resource file is never public, even when the community's public
-- preview is 'open' — that setting only ever widens the feed/roster, never
-- member-only resources). Object path convention: `<community_id>/<uuid>.<ext>`
-- (the community's own id, since any admin manages the file, not just its
-- uploader). Dashboard fallback: Storage -> New bucket -> name
-- "community-resource-files" -> Public bucket: OFF -> file size limit 50 MB.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'community-resource-files',
    'community-resource-files',
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

DROP POLICY IF EXISTS "community_resource_files_member_select" ON storage.objects;
CREATE POLICY "community_resource_files_member_select"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'community-resource-files'
        AND public.is_community_member((storage.foldername(name))[1]::uuid, auth.uid())
    );

DROP POLICY IF EXISTS "community_resource_files_admin_insert" ON storage.objects;
CREATE POLICY "community_resource_files_admin_insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'community-resource-files'
        AND public.is_community_admin((storage.foldername(name))[1]::uuid, auth.uid())
    );

DROP POLICY IF EXISTS "community_resource_files_admin_delete" ON storage.objects;
CREATE POLICY "community_resource_files_admin_delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'community-resource-files'
        AND public.is_community_admin((storage.foldername(name))[1]::uuid, auth.uid())
    );

-- Both functions used above are SECURITY DEFINER and need the CALLING role's
-- own EXECUTE grant, or the policy errors before it ever evaluates the
-- function's own logic (a failure mode this repo has hit before — see
-- 2026-09-19_community_feed_preview_anon_grant.sql). Already granted to
-- `authenticated` by 01_schema.sql; re-asserted here once more defensively,
-- since storage.objects policies are exactly where this class of bug bites.
GRANT EXECUTE ON FUNCTION public.is_project_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_community_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_community_admin(UUID, UUID) TO authenticated;
