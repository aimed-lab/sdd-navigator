-- =============================================================================
-- Migration: community_member_focus  (2026-09-13)
-- =============================================================================
-- WHY: for a cohort like HEREP — eleven scholars across five institutions who
-- don't know each other — the thing that actually connects them is what they
-- work on, and today's member card (name, role, institution) doesn't show
-- it. Adds a short "research focus" line to the MEMBERSHIP
-- (community_members.focus), not to public.users: the same person in two
-- communities may want to describe themselves differently in each.
--
-- WHO CAN SET IT: the member themselves, from the community page. An admin
-- can also set ANY member's focus, since for an imported cohort an admin
-- fills it in from a roster before anyone has signed in
-- (community_members rows can exist with user_id NULL, added by email — see
-- 2026-08-21_community_join.sql — well before that person ever visits the
-- page to fill in their own line).
--
-- THE NEW RLS CASE: "Community members: admin manages" (2026-08-30) is the
-- only existing UPDATE policy on this table, and it's admin-only — a member
-- updating their OWN row is new. A plain USING (user_id = auth.uid())
-- self-update policy is NOT enough by itself: WITH CHECK on an UPDATE
-- policy only constrains what the NEW row may look like, it cannot compare
-- NEW to OLD to say "role/status must not have changed" — RLS policy
-- expressions have no OLD to reference. That comparison needs a trigger,
-- exactly the same reasoning trg_enforce_community_admin_guard already
-- relies on (that migration's own header explains why an invariant over
-- OLD/NEW, or over the rest of the table, needs a BEFORE trigger and can't
-- be expressed as a USING/WITH CHECK clause alone).
--
-- So this is handled in two parts, same division of labor as everywhere
-- else in this file: RLS decides WHO may attempt an update at all (adds one
-- more "or it's your own row" clause), a trigger decides WHAT a non-admin
-- update may actually change (only `focus` — role, status, user_id, email,
-- community_id, approved_by/approved_at, requested_at, joined_at are all
-- rejected). An admin's update is exempted from the trigger entirely (they
-- already pass through "Community members: admin manages", which is
-- unrestricted by column) so promoting/demoting/removing still works
-- exactly as it did.
--
-- community_member_roster() (2026-09-02, extended 2026-09-02) gets `focus`
-- added to its return shape the same way `institution` was added to it —
-- DROP + CREATE (return shape changes aren't a CREATE OR REPLACE-able
-- change), grants re-applied after.
--
-- Run once, top to bottom, in the Supabase SQL editor. Idempotent (ADD
-- COLUMN IF NOT EXISTS, DROP POLICY/TRIGGER/FUNCTION IF EXISTS before
-- CREATE, REVOKE/GRANT are all safe to re-run). NOT run against any
-- database as part of writing this file.
-- =============================================================================

-- ── community_members: the new column ───────────────────────────────────────
ALTER TABLE public.community_members ADD COLUMN IF NOT EXISTS focus TEXT;

-- =============================================================================
-- TRIGGER: a non-admin's update to their own row may only change `focus`
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enforce_community_member_self_update_guard()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    -- An admin may change anything on any row in their own community — this
    -- guard exists only to restrict the NEW self-update policy below; the
    -- existing "Community members: admin manages" path is untouched by it.
    IF public.is_community_admin(NEW.community_id, auth.uid()) THEN
        RETURN NEW;
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role
        OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.email IS DISTINCT FROM OLD.email
        OR NEW.community_id IS DISTINCT FROM OLD.community_id
        OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
        OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
        OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
        OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
    THEN
        RAISE EXCEPTION 'You can only edit your own research focus.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_community_member_self_update_guard ON public.community_members;
CREATE TRIGGER trg_enforce_community_member_self_update_guard
    BEFORE UPDATE ON public.community_members
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_community_member_self_update_guard();

-- =============================================================================
-- RLS: the new self-update policy
-- =============================================================================
-- Broad on its face (USING/WITH CHECK only re-check ownership, not which
-- columns), same shape as "Community members: self delete" — the trigger
-- above is what actually narrows a non-admin's update down to `focus`.
-- Multiple UPDATE policies on the same table are OR'd together by Postgres
-- RLS, so this is additive: an admin still has their own unrestricted path
-- via "Community members: admin manages", this just adds "or it's your own
-- row" for everyone else.
DROP POLICY IF EXISTS "Community members: self update focus" ON public.community_members;
CREATE POLICY "Community members: self update focus"
    ON public.community_members FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- =============================================================================
-- community_member_roster(): add `focus` to what it returns
-- =============================================================================
DROP FUNCTION IF EXISTS public.community_member_roster(UUID[]);

CREATE FUNCTION public.community_member_roster(community_ids UUID[])
RETURNS TABLE (
    user_id     UUID,
    role        TEXT,
    name        TEXT,
    email       TEXT,
    institution TEXT,
    focus       TEXT
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
        u.institution,
        cm.focus
    FROM public.community_members cm
    JOIN public.users u ON u.id = cm.user_id
    WHERE cm.community_id = ANY(community_ids)
      AND cm.status = 'active'
      AND public.is_community_member(cm.community_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.community_member_roster(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_member_roster(UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.community_member_roster(UUID[]) TO authenticated;
