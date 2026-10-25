-- 2026-10-27  Program manager role on projects (project_members.role = 'manager')
--
-- A manager (for example the ColaboFest program manager) is a MEMBER of the
-- project: is_project_member() is true for them, so they read and edit
-- everything any member can. They can also post announcements, resolve help
-- posts and see the program view (2026-10-27_project_updates.sql and the app).
-- They are NOT a lead: is_project_lead() still means role = 'lead', so a manager
-- cannot delete the project, manage leads, add or remove members, or submit a
-- proposal.
--
-- WHAT CHANGES
--   1. project_members_role_check allows 'manager' (lead, manager, member).
--   2. is_project_manager() and is_project_staff() (lead OR manager) helpers.
--   3. "Project members: lead delete": a lead may also remove a manager
--      (it used to allow removing role 'member' only).
--   4. "Project members: promote or self-demote": a lead may also set a member to
--      manager, and set a manager back to member (see the note below).
--   5. enforce_min_one_lead(): same rule as before (a project always keeps at
--      least one lead) but written for any lead -> non-lead change, and it now
--      also refuses a lead changing ANOTHER lead's role. That rule used to be
--      enforced by the update policy's WITH CHECK, which this migration relaxes
--      so that 'manager' can be set; the trigger keeps the rule.
--
-- WHAT WAS CHECKED AND IS NOT CHANGED (everything that looks at role)
--   * is_project_lead()          role = 'lead'; a manager is not a lead. Callers:
--                                project_members insert, project_proposals delete,
--                                find_account_id_by_email_for_project, the pages
--                                lead-delete policy: all unaffected.
--   * is_project_creator()       projects.lead_id, untouched; project DELETE stays
--                                creator-only.
--   * is_project_member()        any row, any role: managers are members.
--   * create_project_with_lead() and the ColaboFest seed insert role 'lead'.
--   * claim_pending_project_memberships() / handle_new_user() link user_id and do
--                                not look at role.
--   * "Project members: lead insert" any role may be inserted by a lead, including
--                                'manager' (the CHECK now allows it).
--   * wiki_notes / pages / checklist policies use is_project_member().
--
-- NOTE on setting a manager back to a member: the WITH CHECK below accepts
-- role = 'member' when the row's CURRENT role is manager, by calling
-- is_project_manager(). A policy cannot see the old row, but that function reads
-- the table from the statement's snapshot, i.e. the row as it was before this
-- update, so it answers "was this person a manager". For a lead's row it answers
-- false, so a lead can never be made a member through this policy (and the
-- trigger refuses it as well).
--
-- Idempotent: safe to re-run. NOT RUN as part of writing it.

-- 1. the CHECK ---------------------------------------------------------------

ALTER TABLE public.project_members DROP CONSTRAINT IF EXISTS project_members_role_check;
ALTER TABLE public.project_members
    ADD CONSTRAINT project_members_role_check CHECK (role IN ('lead', 'manager', 'member'));

-- 2. helpers -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_project_manager(p_project_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = p_project_id AND pm.user_id = p_uid AND pm.role = 'manager'
    );
$$;

-- Lead or manager: who may post announcements and resolve help posts.
CREATE OR REPLACE FUNCTION public.is_project_staff(p_project_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = p_project_id AND pm.user_id = p_uid AND pm.role IN ('lead', 'manager')
    );
$$;

REVOKE ALL ON FUNCTION public.is_project_manager(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_manager(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_project_manager(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.is_project_staff(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_staff(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_project_staff(UUID, UUID) TO authenticated;

-- 3. a lead may remove a member or a manager (never another lead) -------------

DROP POLICY IF EXISTS "Project members: lead delete" ON public.project_members;
CREATE POLICY "Project members: lead delete"
    ON public.project_members FOR DELETE
    USING (
        public.is_project_lead(project_id, auth.uid())
        AND role IN ('member', 'manager')
    );

-- 4. a lead may promote to lead, make a manager, or undo a manager ------------
-- A lead may also step down to member themselves (user_id = auth.uid()).

DROP POLICY IF EXISTS "Project members: promote or self-demote" ON public.project_members;
CREATE POLICY "Project members: promote or self-demote"
    ON public.project_members FOR UPDATE
    USING (public.is_project_lead(project_id, auth.uid()))
    WITH CHECK (
        role IN ('lead', 'manager')
        OR (role = 'member' AND user_id = auth.uid())
        OR (role = 'member' AND public.is_project_manager(project_id, user_id))
    );

-- 5. the trigger -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_min_one_lead()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    IF OLD.role = 'lead' AND NEW.role <> 'lead' THEN
        -- A lead can only step down themselves, never another lead.
        IF auth.uid() IS NOT NULL AND OLD.user_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'A lead can only step down themselves.'
                USING ERRCODE = '42501';
        END IF;
        IF NOT EXISTS (
            SELECT 1
            FROM public.project_members
            WHERE project_id = OLD.project_id
              AND role = 'lead'
              AND id <> OLD.id
        ) THEN
            RAISE EXCEPTION 'A project must always have at least one lead.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_min_one_lead() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_min_one_lead() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_min_one_lead() FROM authenticated;

DROP TRIGGER IF EXISTS trg_enforce_min_one_lead ON public.project_members;
CREATE TRIGGER trg_enforce_min_one_lead
    BEFORE UPDATE ON public.project_members
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_min_one_lead();
