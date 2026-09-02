-- =============================================================================
-- Migration: community_announcements  (2026-09-02)
-- =============================================================================
-- Backs the Announcements section on /communities/[slug]. Any ACTIVE member
-- of a community can read its announcements; only an admin can create, edit,
-- or delete one. That's enforced here, in RLS, using the same two checker
-- functions every other community feature already uses
-- (is_community_member, is_community_admin — both
-- database/migrations/2026-08-20_communities.sql /
-- 2026-08-30_community_admin_membership.sql), not in the page or the Server
-- Action layer. A non-member's SELECT matches zero rows; a non-admin's
-- INSERT/UPDATE/DELETE is rejected by Postgres — same posture as
-- collab_posts' owner-only policies and community_members' admin-only ones.
--
-- Run once, top to bottom, in the Supabase SQL editor. Idempotent — every
-- statement below is safe to re-run (CREATE TABLE IF NOT EXISTS, DROP POLICY
-- IF EXISTS before CREATE POLICY, DROP TRIGGER IF EXISTS before CREATE
-- TRIGGER). Has NOT been run against any database as part of writing this
-- file.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.community_announcements (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    author_id    UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    title        TEXT        NOT NULL,
    body         TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.community_announcements ENABLE ROW LEVEL SECURITY;

-- Read: any ACTIVE member of the community — not public, unlike
-- collab_posts/communities themselves. A signed-out visitor or a non-member
-- gets zero rows, not an error, same as every is_community_member()-gated
-- read in this codebase.
DROP POLICY IF EXISTS "Community announcements: member select" ON public.community_announcements;
CREATE POLICY "Community announcements: member select"
    ON public.community_announcements FOR SELECT
    TO authenticated
    USING (public.is_community_member(community_id, auth.uid()));

-- Write: admin-only, all three directions. author_id is derived from the
-- session in lib/server/communities.ts; WITH CHECK enforces it at the DB
-- level so a forged author_id in a request body is rejected by Postgres,
-- not by app code (same shape as collab_posts_insert_own).
DROP POLICY IF EXISTS "Community announcements: admin insert" ON public.community_announcements;
CREATE POLICY "Community announcements: admin insert"
    ON public.community_announcements FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = author_id
        AND public.is_community_admin(community_id, auth.uid())
    );

-- WITH CHECK re-checks admin on the (possibly new) community_id, same as
-- "Communities: admin update" (2026-08-31_community_sections.sql) — not
-- that this table ever exposes a way to change community_id from the UI,
-- but a forged update can't use this row to migrate itself into a
-- community the caller doesn't admin either.
DROP POLICY IF EXISTS "Community announcements: admin update" ON public.community_announcements;
CREATE POLICY "Community announcements: admin update"
    ON public.community_announcements FOR UPDATE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()))
    WITH CHECK (public.is_community_admin(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community announcements: admin delete" ON public.community_announcements;
CREATE POLICY "Community announcements: admin delete"
    ON public.community_announcements FOR DELETE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()));

-- Keep updated_at honest on edit — reuses touch_updated_at(), already
-- created by 2026-07-26_collab_posts.sql (this migration runs after it in
-- date order, so the function already exists; not redefined here).
DROP TRIGGER IF EXISTS community_announcements_touch_updated_at ON public.community_announcements;
CREATE TRIGGER community_announcements_touch_updated_at
    BEFORE UPDATE ON public.community_announcements
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_community_announcements_community_created
    ON public.community_announcements (community_id, created_at DESC);
