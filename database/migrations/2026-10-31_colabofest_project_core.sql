-- 2026-10-31  ColaboFest project home: finalist flag, member affiliation,
--             welcome-card dismissal
--
-- Needs (run first): 2026-08-04_projects.sql, 2026-08-08_project_co_leads.sql,
-- 2026-10-24_promote_redesign.sql (public.is_site_admin) and
-- 2026-10-27_project_manager_role.sql (the 'manager' role). Idempotent: safe to
-- re-run. NOT RUN as part of writing it.
--
-- WHAT THIS ADDS
--   1. projects.finalist (boolean, default false). Only a SITE ADMIN can change
--      it. Row-level security cannot restrict one column, so a BEFORE INSERT /
--      UPDATE trigger does: a signed-in caller who is not a site admin always
--      gets finalist = false on insert and the old value back on update. A call
--      with no session (the service role, the SQL editor) is never restricted.
--   2. project_members.affiliation: NULL, 'sparc' or 'southern_research'. It is
--      what the Team card shows as the person's label (SPARC / Southern
--      Research). Slice 2 has no organisation field (the checked columns are
--      id, email, user_id, role, added_by, created_at), so this is new. Only a
--      LEAD of the project (or a site admin) can set it. Column privileges limit
--      what a signed-in caller can change on a member row to role and
--      affiliation (the app only ever updated role), so the new lead policy
--      below cannot be used to move a row to another account.
--   3. project_welcome_dismissals: one row per (project, person) once they press
--      "Dismiss" on the Welcome card. Stored in the database, not in the
--      browser, so it follows the person to another device. A person sees and
--      writes only their own row, and only on a project they belong to.

-- 1. finalist -----------------------------------------------------------------

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS finalist BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.projects_guard_finalist()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    -- No session (service role, SQL editor): never restricted.
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;
    IF public.is_site_admin() THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.finalist := false;
    ELSE
        NEW.finalist := OLD.finalist;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.projects_guard_finalist() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.projects_guard_finalist() FROM anon;
REVOKE ALL ON FUNCTION public.projects_guard_finalist() FROM authenticated;

DROP TRIGGER IF EXISTS projects_guard_finalist_trg ON public.projects;
CREATE TRIGGER projects_guard_finalist_trg
    BEFORE INSERT OR UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.projects_guard_finalist();

-- A site admin sets the flag through this function (they are not necessarily a
-- member of the project, so the "Projects: member update" policy would not let
-- the plain UPDATE through). It returns the new value, or NULL when the caller
-- is not a site admin or the project does not exist.
CREATE OR REPLACE FUNCTION public.set_project_finalist(p_project_id UUID, p_finalist BOOLEAN)
    RETURNS BOOLEAN
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_new BOOLEAN;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_site_admin() THEN
        RETURN NULL;
    END IF;
    UPDATE public.projects SET finalist = COALESCE(p_finalist, false)
    WHERE id = p_project_id
    RETURNING finalist INTO v_new;
    RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.set_project_finalist(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_project_finalist(UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_project_finalist(UUID, BOOLEAN) TO authenticated;

-- 2. affiliation --------------------------------------------------------------

ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS affiliation TEXT;

ALTER TABLE public.project_members DROP CONSTRAINT IF EXISTS project_members_affiliation_check;
ALTER TABLE public.project_members
    ADD CONSTRAINT project_members_affiliation_check
    CHECK (affiliation IS NULL OR affiliation IN ('sparc', 'southern_research'));

-- A lead may set affiliation. (The older "promote or self-demote" policy cannot
-- cover this: its WITH CHECK refuses a row that stays a plain member.)
DROP POLICY IF EXISTS "Project members: lead set affiliation" ON public.project_members;
CREATE POLICY "Project members: lead set affiliation"
    ON public.project_members FOR UPDATE
    TO authenticated
    USING (public.is_project_lead(project_id, auth.uid()) OR public.is_site_admin())
    WITH CHECK (public.is_project_lead(project_id, auth.uid()) OR public.is_site_admin());

-- A signed-in caller may change only role and affiliation on a member row. This
-- is done with column privileges, not a trigger, on purpose: the SECURITY DEFINER
-- functions that legitimately link an invited email to an account
-- (claim_pending_project_memberships, handle_new_user) run as the table owner and
-- are not affected, whereas a trigger cannot tell them apart from an API call.
-- The app only ever updated role (setMemberRole, promote, step down).
-- Every UPDATE policy on this table is a LEAD policy (or the site-admin one
-- above), so only a lead or a site admin can set affiliation at all.
REVOKE UPDATE ON public.project_members FROM authenticated;
GRANT UPDATE (role, affiliation) ON public.project_members TO authenticated;

-- 3. welcome dismissals -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_welcome_dismissals (
    project_id   UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    user_id      UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

ALTER TABLE public.project_welcome_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Welcome dismissals: own select" ON public.project_welcome_dismissals;
CREATE POLICY "Welcome dismissals: own select"
    ON public.project_welcome_dismissals FOR SELECT
    TO authenticated
    USING (user_id = auth.uid() AND public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Welcome dismissals: own insert" ON public.project_welcome_dismissals;
CREATE POLICY "Welcome dismissals: own insert"
    ON public.project_welcome_dismissals FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid() AND public.is_project_member(project_id, auth.uid()));

-- No UPDATE policy (a dismissal is never edited) and no DELETE (kept simple).
REVOKE ALL ON public.project_welcome_dismissals FROM PUBLIC;
REVOKE ALL ON public.project_welcome_dismissals FROM anon;
REVOKE ALL ON public.project_welcome_dismissals FROM authenticated;
GRANT SELECT, INSERT ON public.project_welcome_dismissals TO authenticated;
