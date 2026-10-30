-- 2026-11-07  The SPARC team (project managers) can add and remove plain members
--
-- On a ColaboFest project the SPARC team has the role 'manager'. Until now only a LEAD
-- could add a member (invite by email) or remove one. This lets a manager do both for
-- ordinary members, and nothing more:
--   * INSERT: a manager may add a row with role = 'member' (never a lead or manager).
--   * DELETE: a manager may remove a row whose role is 'member' (never a lead or another
--     manager).
--   * find_account_id_by_email_for_project() answers for a manager as well as a lead, so an
--     invited email that already has an account is linked at once (otherwise it stays
--     pending until that person signs in, which also works).
-- Everything a lead can do is unchanged. Needs 2026-10-27_project_manager_role.sql
-- (is_project_manager) and 2026-08-19_link_existing_accounts.sql. Idempotent.
-- NOT RUN as part of writing it.

DROP POLICY IF EXISTS "Project members: manager insert" ON public.project_members;
CREATE POLICY "Project members: manager insert"
    ON public.project_members FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_project_manager(project_id, auth.uid())
        AND role = 'member'
    );

DROP POLICY IF EXISTS "Project members: manager delete" ON public.project_members;
CREATE POLICY "Project members: manager delete"
    ON public.project_members FOR DELETE
    TO authenticated
    USING (
        public.is_project_manager(project_id, auth.uid())
        AND role = 'member'
    );

CREATE OR REPLACE FUNCTION public.find_account_id_by_email_for_project(
    p_project_id UUID,
    p_email TEXT
)
    RETURNS UUID
    LANGUAGE plpgsql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
DECLARE
    v_uid UUID;
BEGIN
    -- Only usable in the context of adding a member to a project the CALLER leads or
    -- manages; anything else returns NULL, the same as a non-existent email would.
    IF NOT (public.is_project_lead(p_project_id, auth.uid())
            OR public.is_project_manager(p_project_id, auth.uid())) THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_uid
    FROM auth.users
    WHERE lower(email) = lower(p_email)
      AND email_confirmed_at IS NOT NULL
    LIMIT 1;

    RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.find_account_id_by_email_for_project(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_account_id_by_email_for_project(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_account_id_by_email_for_project(UUID, TEXT) TO authenticated;
