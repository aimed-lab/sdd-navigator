-- =============================================================================
-- Migration: page_member_details  (2026-10-21)
-- =============================================================================
-- ADDITIVE ONLY. One new function; no table, policy or other function is
-- touched. Written but NOT run against any database as part of this change.
--
-- WHY: the agent's get_page tool shows a page's OWNER the team as
-- [{user_id, name, email, role}]. Names and emails live in public.users /
-- auth.users, which row-level security hides from everyone but the user
-- themselves (and public profiles), so the owner cannot read a member's email
-- through a plain join. This SECURITY DEFINER function returns them, and ONLY
-- when the caller owns the page; for anyone else it returns no rows. It
-- follows the shape of project_member_names() (2026-08-07) and
-- find_account_id_by_email_for_page() (2026-10-20_living_pages.sql).
--
-- user_id is page_members.user_id: the account id (public.users.id, which
-- equals auth.users.id), the same id add_member records and remove_member
-- takes.
--
-- Until this is applied, the app falls back to user_id + role with name and
-- email null (lib/server/pages/pageMembers.ts, listPageMemberDetails).
--
-- Idempotent: safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.page_member_details(p_page_id UUID)
    RETURNS TABLE (
        user_id UUID,
        name    TEXT,
        email   TEXT,
        role    TEXT
    )
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT pm.user_id, u.name, u.email, pm.role
    FROM public.page_members pm
    LEFT JOIN public.users u ON u.id = pm.user_id
    WHERE pm.page_id = p_page_id
      AND public.is_page_owner(p_page_id, auth.uid())
    ORDER BY pm.created_at;
$$;

REVOKE ALL ON FUNCTION public.page_member_details(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.page_member_details(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.page_member_details(UUID) TO authenticated;
