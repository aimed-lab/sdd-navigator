-- =============================================================================
-- Migration: community-resource-files storage bucket + policies  (2026-09-21)
-- =============================================================================
-- Run AFTER 2026-09-21_community_resource_files.sql (that one creates
-- community_resource_files, which the policies below reference).
--
-- SPLIT DELIBERATELY from the table migration: the Supabase SQL editor runs
-- a script as ONE transaction, and `CREATE POLICY ... ON storage.objects`
-- fails with "must be owner of table objects" on many projects — which
-- would roll back the table too. If this section errors, create the bucket
-- in the dashboard instead (Storage → New bucket → name
-- "community-resource-files", Public OFF, file size limit 50 MB) and run
-- only the policies below.
--
-- PRIVATE bucket, same posture as showcase-media
-- (2026-09-06_promote_media_storage.sql): every read, member or admin,
-- goes through a signed URL minted per request (see
-- lib/server/communities.ts's signCommunityResourceFilePath), never a
-- stable/public link. The 50 MB limit and accepted mime set match
-- showcase-media exactly (images, PDF, PPTX) — same set of file kinds a
-- session deck or protocol actually comes in.
-- =============================================================================

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

-- Object path convention is `<community_id>/<uuid>.<ext>` — the community's
-- own id as the top-level folder, the same "parent entity's id, not the
-- uploader's uid" convention showcase-media uses (folder = showcase_id
-- there), swapped here for the actual parent: a community resource file
-- belongs to the COMMUNITY (any admin manages it, not one owner), not to
-- the individual admin who happened to upload it. That is what lets the
-- policies below key membership/admin checks off
-- storage.foldername(name)[1] directly, with no join needed.

-- SELECT: any ACTIVE member of the community the folder names — `TO
-- authenticated` only, no anon branch at all (unlike showcase-media's
-- published-select policy). A community resource file is never public: a
-- non-member gets nothing here even when the community's public preview is
-- set to "open", since that setting only ever widens the feed/roster, never
-- member-only resources (see the table migration's own header).
DROP POLICY IF EXISTS "community_resource_files_member_select" ON storage.objects;
CREATE POLICY "community_resource_files_member_select"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'community-resource-files'
        AND public.is_community_member((storage.foldername(name))[1]::uuid, auth.uid())
    );

-- INSERT/DELETE: admin-only, same as the row-level table's own policies —
-- there is no per-uploader "own" branch the way showcase-media has one,
-- since a community resource is managed by any admin, not by whoever
-- happened to add it.
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

-- Same gotcha as the table migration: both functions used above are
-- SECURITY DEFINER and need the calling role's own EXECUTE grant, or the
-- policy errors before evaluating its logic, not just "returns false".
-- Already granted to `authenticated` by their own migrations
-- (2026-08-20_communities.sql / 2026-08-30_community_admin_membership.sql)
-- and re-asserted by the table migration above — re-asserted once more
-- here since storage.objects policies are exactly where this repo has been
-- bitten by a missing grant before:
GRANT EXECUTE ON FUNCTION public.is_community_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_community_admin(UUID, UUID) TO authenticated;
