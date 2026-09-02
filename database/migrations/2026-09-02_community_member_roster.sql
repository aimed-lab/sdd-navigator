-- Member-facing roster for a community — /communities/[slug]'s Members
-- section. It used to show activity counts only ("14 members, 2 joined in
-- the last 7 days"); a community exists so members can find each other, so
-- any ACTIVE member now sees who's in it: display name (falling back to
-- email only when there's no name) and role, admins first then
-- alphabetical. Non-members still see the count only.
--
-- SAME SHAPE AS project_member_names (2026-08-07_project_member_names.sql):
-- a SECURITY DEFINER function that resolves user_id -> display info, gated
-- by membership of the SAME community being asked about. A community
-- roster is not public — public.users' own SELECT policy (`is_public =
-- true`) would otherwise blank out a private-profile member's name instead
-- of falling back to their email, and community_members itself is already
-- self-or-admin-only (2026-08-30_community_admin_membership.sql) — so the
-- membership check has to live in the database, not just be a page-level
-- "don't render this" decision. A forged call for a community the caller
-- isn't an active member of returns zero rows, not an error, same posture
-- as project_member_names and every other checker function in this file's
-- lineage.
--
-- Deliberately NOT reusing listCommunityMembers' admin-only read
-- (lib/server/communities.ts) — that one exists to power the Manage
-- community card (raw emails, role dropdowns, Remove) and stays exactly as
-- it is. This is a second, narrower read: name-or-email and role only, for
-- any active member, not just admins.
CREATE OR REPLACE FUNCTION public.community_member_roster(community_ids UUID[])
RETURNS TABLE (
    user_id UUID,
    role    TEXT,
    name    TEXT,
    email   TEXT
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
        u.email
    FROM public.community_members cm
    JOIN public.users u ON u.id = cm.user_id
    WHERE cm.community_id = ANY(community_ids)
      AND cm.status = 'active'
      AND public.is_community_member(cm.community_id, auth.uid());
$$;

-- Supabase grants EXECUTE to PUBLIC (and therefore anon) on every new
-- function by default — REVOKE ALL FROM PUBLIC first (which is where that
-- default grant actually lands), then an explicit REVOKE FROM anon as the
-- standing habit in this codebase (not a no-op if anon was ever granted
-- directly), then GRANT back only to authenticated. A signed-out caller
-- gets a permission error on the RPC itself, never a quietly-empty result
-- that could be mistaken for "this community has no members".
REVOKE ALL ON FUNCTION public.community_member_roster(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_member_roster(UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.community_member_roster(UUID[]) TO authenticated;

-- Run once, top to bottom, in the Supabase SQL editor. Idempotent
-- (CREATE OR REPLACE FUNCTION, REVOKE/GRANT are all safe to re-run) — has
-- NOT been run against any database as part of writing this file.
