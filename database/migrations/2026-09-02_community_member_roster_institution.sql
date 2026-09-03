-- Add `institution` to community_member_roster() — same field
-- collab_post_owners() already exposes for the Collaborate board's "Name ·
-- Institution" line (database/schema.sql, PostCard.tsx's ownerLine), and it
-- already exists on public.users (schema.sql: affiliation TEXT, institution
-- TEXT — affiliation is a role label like "Researcher"/"Laboratory Head",
-- institution is the org name, e.g. "University of Alabama Birmingham").
-- No column added anywhere; this only extends what the RPC selects.
--
-- CREATE OR REPLACE FUNCTION cannot change an existing function's return
-- shape (Postgres: "cannot change return type of existing function") —
-- adding a column to RETURNS TABLE needs a DROP first. Grants do not
-- survive a DROP, so they're re-applied below, identical to
-- 2026-09-02_community_member_roster.sql.
--
-- Run once, top to bottom, in the Supabase SQL editor. Idempotent (DROP
-- FUNCTION IF EXISTS, then CREATE; REVOKE/GRANT are safe to re-run). Has
-- NOT been run against any database as part of writing this file.

DROP FUNCTION IF EXISTS public.community_member_roster(UUID[]);

CREATE FUNCTION public.community_member_roster(community_ids UUID[])
RETURNS TABLE (
    user_id     UUID,
    role        TEXT,
    name        TEXT,
    email       TEXT,
    institution TEXT
)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT
        u.id AS user_id,
        cm.role,
        u.name,
        u.email,
        u.institution
    FROM public.community_members cm
    JOIN public.users u ON u.id = cm.user_id
    WHERE cm.community_id = ANY(community_ids)
      AND cm.status = 'active'
      AND public.is_community_member(cm.community_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.community_member_roster(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_member_roster(UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.community_member_roster(UUID[]) TO authenticated;
