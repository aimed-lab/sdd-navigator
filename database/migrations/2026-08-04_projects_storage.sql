-- =============================================================================
-- Migration: projects — STORAGE  (2026-08-04)   [RUN SECOND, OPTIONAL]
-- =============================================================================
-- Private bucket for proposal file uploads (project_proposals.file_path).
-- Unlike showcase-images, this bucket is PRIVATE: proposal files are scoped
-- to project membership, not public.
--
-- IF THIS SCRIPT ERRORS, NOTHING ELSE IS BROKEN. It's split out from the core
-- migration for the same reason as promote_showcase_storage.sql: many
-- Supabase projects refuse `CREATE POLICY ... ON storage.objects` from the
-- SQL editor ("must be owner of table objects"), and bundling it with a
-- CREATE TABLE would roll the whole transaction back on that error.
--
-- If that happens here, create the bucket and policies in the dashboard
-- instead:
--   1. Storage → New bucket → name: project-proposals → Public bucket: OFF
--   2. Storage → project-proposals → Policies → add, all for `authenticated`:
--        • SELECT  condition: public.is_project_member(
--              (storage.foldername(name))[1]::uuid, auth.uid())
--        • INSERT  same condition
--        • DELETE  same condition
-- lib/server/ should upload to `<project_id>/<random>.<ext>` so the first
-- path segment is the project id these policies check against.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('project-proposals', 'project-proposals', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Any project member may read a proposal file belonging to their project.
DROP POLICY IF EXISTS "project_proposals_member_select" ON storage.objects;
CREATE POLICY "project_proposals_member_select"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'project-proposals'
        AND public.is_project_member((storage.foldername(name))[1]::uuid, auth.uid())
    );

-- Any project member may upload a proposal file INTO THEIR PROJECT'S FOLDER
-- — the first path segment must be the project id, e.g.
-- "<project_id>/proposal.pdf". That keeps one project's files out of
-- another's folder.
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
