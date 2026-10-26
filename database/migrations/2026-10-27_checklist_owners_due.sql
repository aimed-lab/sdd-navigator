-- 2026-10-27  Checklist items get a list, an owner and a due date
--
-- A project's Tasks & checklists tab now shows up to three lists:
--   'team'               "Team tasks" (every project; all existing rows)
--   'sparc'              "UAB SPARC checklist" (challenge projects only)
--   'southern_research'  "Southern Research checklist" (challenge projects only)
-- and each item can have an owner (a member of the project) and a due date.
--
-- Added columns on public.checklist_items
--   list_key     TEXT NOT NULL DEFAULT 'team', one of the three keys above.
--                Every existing row becomes 'team' (the default fills it).
--   assignee_id  UUID NULL -> users(id), ON DELETE SET NULL
--   due_date     DATE NULL
--
-- Access: unchanged. The existing "Checklist items: member select / insert /
-- update / delete" policies (any project member, 2026-08-04_projects.sql) already
-- cover the new columns, so no policy is touched. One trigger is added for two
-- rules RLS cannot express on its own:
--   * the owner of an item must be a member of that project;
--   * the SPARC and Southern Research lists exist only for challenge projects
--     (projects.challenge_key IS NOT NULL).
-- A session-less caller (the SQL editor, the service role) is not restricted.
--
-- Idempotent: safe to re-run. NOT RUN as part of writing it.

ALTER TABLE public.checklist_items
    ADD COLUMN IF NOT EXISTS list_key TEXT NOT NULL DEFAULT 'team';

ALTER TABLE public.checklist_items DROP CONSTRAINT IF EXISTS checklist_items_list_key_check;
ALTER TABLE public.checklist_items
    ADD CONSTRAINT checklist_items_list_key_check
        CHECK (list_key IN ('team', 'sparc', 'southern_research'));

ALTER TABLE public.checklist_items
    ADD COLUMN IF NOT EXISTS assignee_id UUID
        REFERENCES public.users (id) ON DELETE SET NULL;

ALTER TABLE public.checklist_items
    ADD COLUMN IF NOT EXISTS due_date DATE;

CREATE INDEX IF NOT EXISTS checklist_items_project_list_idx
    ON public.checklist_items (project_id, list_key, position);
CREATE INDEX IF NOT EXISTS checklist_items_assignee_idx
    ON public.checklist_items (assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS checklist_items_due_idx
    ON public.checklist_items (due_date) WHERE due_date IS NOT NULL;

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
           WHERE p.id = NEW.project_id AND p.challenge_key IS NOT NULL
       ) THEN
        RAISE EXCEPTION 'checklist_items: that list exists only for challenge projects'
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

DROP TRIGGER IF EXISTS checklist_items_guard_list_and_owner_trg ON public.checklist_items;
CREATE TRIGGER checklist_items_guard_list_and_owner_trg
    BEFORE INSERT OR UPDATE ON public.checklist_items
    FOR EACH ROW EXECUTE FUNCTION public.checklist_items_guard_list_and_owner();
