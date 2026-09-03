-- =============================================================================
-- Migration: community_resources  (2026-09-03)
-- =============================================================================
-- Backs the Resources section on /communities/[slug] — same shape as
-- community_announcements (2026-09-02_community_announcements.sql): any
-- ACTIVE member of a community can read its resources; only an admin can
-- add, edit, or delete one. Enforced here, in RLS, with the same two
-- checker functions every other community feature already uses
-- (is_community_member, is_community_admin — both
-- database/migrations/2026-08-20_communities.sql /
-- 2026-08-30_community_admin_membership.sql), not in the page or the
-- Server Action layer. A non-member's SELECT matches zero rows; a
-- non-admin's INSERT/UPDATE/DELETE is rejected by Postgres.
--
-- resource_type is PLAIN TEXT with a CHECK constraint, not a Postgres enum —
-- Chen wants user-definable types with popularity ranking later, and an
-- enum (ALTER TYPE ... ADD VALUE, which can't even run inside the same
-- transaction as other DDL in older Postgres) is painful to extend compared
-- to loosening or dropping a CHECK constraint. The six values below are a
-- starting set, not a permanent one.
--
-- Run once, top to bottom, in the Supabase SQL editor. Idempotent — every
-- statement below is safe to re-run (CREATE TABLE IF NOT EXISTS, DROP
-- POLICY/CONSTRAINT IF EXISTS before CREATE, DROP TRIGGER IF EXISTS before
-- CREATE TRIGGER). Has NOT been run against any database as part of
-- writing this file.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.community_resources (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id  UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    added_by      UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    title         TEXT        NOT NULL,
    resource_type TEXT        NOT NULL DEFAULT 'other',
    url           TEXT,
    description   TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Plain TEXT + CHECK, not an enum — see header. Dropped and re-added rather
-- than left bare so re-running this file after the set of values changes
-- (before Chen's user-definable version lands) still converges.
ALTER TABLE public.community_resources
    DROP CONSTRAINT IF EXISTS community_resources_type_check;
ALTER TABLE public.community_resources
    ADD CONSTRAINT community_resources_type_check
        CHECK (resource_type IN ('tool', 'paper', 'dataset', 'link', 'podcast', 'other'));

ALTER TABLE public.community_resources ENABLE ROW LEVEL SECURITY;

-- Read: any ACTIVE member of the community — not public. A signed-out
-- visitor or a non-member gets zero rows, not an error, same as
-- community_announcements' own member-select policy.
DROP POLICY IF EXISTS "Community resources: member select" ON public.community_resources;
CREATE POLICY "Community resources: member select"
    ON public.community_resources FOR SELECT
    TO authenticated
    USING (public.is_community_member(community_id, auth.uid()));

-- Write: admin-only, all three directions. added_by is derived from the
-- session in lib/server/communities.ts; WITH CHECK enforces it at the DB
-- level so a forged added_by in a request body is rejected by Postgres,
-- same shape as community_announcements_insert's author_id check.
DROP POLICY IF EXISTS "Community resources: admin insert" ON public.community_resources;
CREATE POLICY "Community resources: admin insert"
    ON public.community_resources FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = added_by
        AND public.is_community_admin(community_id, auth.uid())
    );

DROP POLICY IF EXISTS "Community resources: admin update" ON public.community_resources;
CREATE POLICY "Community resources: admin update"
    ON public.community_resources FOR UPDATE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()))
    WITH CHECK (public.is_community_admin(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community resources: admin delete" ON public.community_resources;
CREATE POLICY "Community resources: admin delete"
    ON public.community_resources FOR DELETE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()));

-- Keep updated_at honest on edit — reuses touch_updated_at(), already
-- created by 2026-07-26_collab_posts.sql (this migration runs after it in
-- date order, so the function already exists; not redefined here).
DROP TRIGGER IF EXISTS community_resources_touch_updated_at ON public.community_resources;
CREATE TRIGGER community_resources_touch_updated_at
    BEFORE UPDATE ON public.community_resources
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_community_resources_community_type
    ON public.community_resources (community_id, resource_type);
