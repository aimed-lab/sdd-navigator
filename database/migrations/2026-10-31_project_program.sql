-- 2026-10-31  projects.program: which PROGRAM a project belongs to
--
-- Needs (run first): 2026-08-04_projects.sql, 2026-10-24_promote_redesign.sql
-- (public.is_site_admin) and 2026-10-27_checklist_owners_due.sql.
-- Idempotent: safe to re-run. NOT RUN as part of writing it.
--
-- WHY A SECOND COLUMN
--   projects.challenge_key = 'colabofest_2026' means "entered through the ColaboFest
--   REGISTRATION flow": it turns on the Proposal tab, "Not submitted", the
--   deadline and the seeded partner checklists. The eight winning teams were not
--   registrations and must not get any of that. projects.program says "this
--   project is part of the ColaboFest 2026 program": it turns on the ColaboFest
--   project home (Welcome card, Box folder card, Progress, finalist toggle, team
--   affiliation, the program view). A project can have either, both or neither.
--
-- WHAT THIS DOES
--   1. projects.program TEXT NULL, CHECK (program IS NULL OR program = 'colabofest_2026').
--   2. A BEFORE INSERT / UPDATE trigger (same idea as projects_guard_finalist): only
--      a SITE ADMIN, or a caller with no session (the service role, the SQL editor),
--      can set or change program. Anyone else always gets NULL on insert and the old
--      value back on update, so a project member cannot switch the home on for
--      themselves.
--   3. set_project_program(project, program): the way a site admin who is not a
--      member of the project sets it from the app (returns the new value, or NULL
--      when the caller is not a site admin or the project does not exist).
--   4. The UAB SPARC and Southern Research checklists exist for a CHALLENGE project
--      (the old rule) or a PROGRAM project. Without this, the Progress card on a
--      winning team's home could never get a SPARC or Southern Research item,
--      because checklist_items_guard_list_and_owner() refused those lists unless
--      challenge_key was set. The function is replaced with the same body plus
--      "OR p.program IS NOT NULL".
--
-- To switch the home on for a project (SQL editor):
--   UPDATE public.projects SET program = 'colabofest_2026' WHERE id = '<project id>';

-- 1. the column ---------------------------------------------------------------

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS program TEXT;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_program_check;
ALTER TABLE public.projects
    ADD CONSTRAINT projects_program_check
    CHECK (program IS NULL OR program = 'colabofest_2026');

-- 2. only a site admin (or no session) can set it -------------------------------

CREATE OR REPLACE FUNCTION public.projects_guard_program()
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
        NEW.program := NULL;
    ELSE
        NEW.program := OLD.program;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.projects_guard_program() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.projects_guard_program() FROM anon;
REVOKE ALL ON FUNCTION public.projects_guard_program() FROM authenticated;

DROP TRIGGER IF EXISTS projects_guard_program_trg ON public.projects;
CREATE TRIGGER projects_guard_program_trg
    BEFORE INSERT OR UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.projects_guard_program();

-- 3. site admin sets it from the app --------------------------------------------

CREATE OR REPLACE FUNCTION public.set_project_program(p_project_id UUID, p_program TEXT)
    RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_new TEXT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_site_admin() THEN
        RETURN NULL;
    END IF;
    UPDATE public.projects SET program = NULLIF(btrim(p_program), '')
    WHERE id = p_project_id
    RETURNING program INTO v_new;
    RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.set_project_program(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_project_program(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_project_program(UUID, TEXT) TO authenticated;

-- 4. partner checklists: a challenge project OR a program project ----------------

CREATE OR REPLACE FUNCTION public.checklist_items_guard_list_and_owner()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.list_key <> 'team'
       AND (TG_OP = 'INSERT' OR NEW.list_key IS DISTINCT FROM OLD.list_key)
       AND NOT EXISTS (
           SELECT 1 FROM public.projects p
           WHERE p.id = NEW.project_id
             AND (p.challenge_key IS NOT NULL OR p.program IS NOT NULL)
       ) THEN
        RAISE EXCEPTION 'checklist_items: that list exists only for challenge and program projects'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.assignee_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id)
       AND NOT public.is_project_member(NEW.project_id, NEW.assignee_id) THEN
        RAISE EXCEPTION 'checklist_items: the owner must be a member of the project'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.checklist_items_guard_list_and_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.checklist_items_guard_list_and_owner() FROM anon;
