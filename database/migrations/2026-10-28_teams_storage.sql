-- =============================================================================
-- Migration: teams_storage  (2026-10-28)
-- =============================================================================
-- Run SECOND, after 2026-10-28_teams.sql, and treat as optional: many Supabase
-- projects refuse "CREATE POLICY ... ON storage.objects" from the SQL editor
-- ("must be owner of table objects"). Kept in its own file so that failure
-- cannot roll back the tables in the main migration (same reason as
-- 2026-09-21_community_resource_files_storage.sql). If it is refused, create
-- the same two policies in the dashboard (Storage -> Policies -> bucket
-- community-resource-files) using the expressions below. Until then, only
-- site-wide behaviour that already worked keeps working: team admins can
-- upload files, other team members can add links.
--
-- WHAT IT DOES: in the private bucket community-resource-files, the first
-- folder of an object path is the community (or team) id.
--   * INSERT (upload): a community admin as before, OR any active member when
--     that id is a team.
--   * DELETE: a community admin as before, OR, in a team, an active member who
--     uploaded that object (storage.objects.owner_id is the uploader's id).
-- SELECT is unchanged: any active member of that community or team.
-- Needs public.is_team() from 2026-10-28_teams.sql.
-- Idempotent. NOT run against any database as part of writing this file.
-- =============================================================================

DROP POLICY IF EXISTS "community_resource_files_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "community_resource_files_admin_or_team_insert" ON storage.objects;
CREATE POLICY "community_resource_files_admin_or_team_insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'community-resource-files'
        AND (
            public.is_community_admin((storage.foldername(name))[1]::uuid, auth.uid())
            OR (
                public.is_team((storage.foldername(name))[1]::uuid)
                AND public.is_community_member((storage.foldername(name))[1]::uuid, auth.uid())
            )
        )
    );

DROP POLICY IF EXISTS "community_resource_files_admin_delete" ON storage.objects;
DROP POLICY IF EXISTS "community_resource_files_admin_or_team_delete" ON storage.objects;
CREATE POLICY "community_resource_files_admin_or_team_delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'community-resource-files'
        AND (
            public.is_community_admin((storage.foldername(name))[1]::uuid, auth.uid())
            OR (
                public.is_team((storage.foldername(name))[1]::uuid)
                AND public.is_community_member((storage.foldername(name))[1]::uuid, auth.uid())
                AND owner_id = auth.uid()::text
            )
        )
    );

GRANT EXECUTE ON FUNCTION public.is_team(UUID) TO authenticated;
