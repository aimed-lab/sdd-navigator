-- 2026-10-26  Wiki pages inside projects (public.pages gets project_id and
--             parent_page_id)
--
-- What this adds
--   * pages.project_id      nullable FK -> projects, ON DELETE SET NULL. A page
--                           with a project_id is "a project wiki page".
--   * pages.parent_page_id  nullable FK -> pages, ON DELETE SET NULL. A
--                           sub-page points at its parent; deleting the parent
--                           leaves the sub-page as a top-level page.
--   * indexes on both columns.
--
-- Access for a project page (a page with project_id set)
--   * READ and EDIT (title, notes, evidence, updates): any member of the
--     project, any role, i.e. a project_members row linked to the user's
--     users.id. Done by extending can_read_page() and can_edit_page(), which
--     every page table's policies already call, so notes, evidence and updates
--     follow automatically.
--   * CREATE: a project member may create a page in the project (the existing
--     "Pages: insert own" policy, owner_id = auth.uid(), plus the guard trigger
--     below, which refuses a project_id the caller is not a member of and a
--     parent page from another project).
--   * UPDATE of the page row itself: a project member may update it, but the
--     guard trigger lets a non-owner change the TITLE only; slug, seed,
--     owner, visibility, refresh setting, project and parent are put back to
--     their old values. The owner keeps full control as before.
--   * DELETE: only the page owner (existing "Pages: owner delete") or a lead
--     of the project (new "Pages: project lead delete").
--
-- Pages with no project_id behave exactly as before: every new clause is
-- guarded by `project_id IS NOT NULL`, and no existing policy is dropped or
-- weakened. Sub-pages follow the same rules (they carry the project_id too).
--
-- Needs public.pages (2026-10-20_living_pages.sql), public.projects,
-- public.is_project_member() and public.is_project_lead()
-- (2026-08-04_projects.sql, 2026-08-08_project_co_leads.sql).
-- Idempotent: safe to re-run. NOT RUN as part of writing it.

-- ── columns, constraint, indexes ────────────────────────────────────────────

ALTER TABLE public.pages
    ADD COLUMN IF NOT EXISTS project_id UUID
        REFERENCES public.projects (id) ON DELETE SET NULL;

ALTER TABLE public.pages
    ADD COLUMN IF NOT EXISTS parent_page_id UUID
        REFERENCES public.pages (id) ON DELETE SET NULL;

ALTER TABLE public.pages DROP CONSTRAINT IF EXISTS pages_parent_not_self_check;
ALTER TABLE public.pages
    ADD CONSTRAINT pages_parent_not_self_check
        CHECK (parent_page_id IS NULL OR parent_page_id <> id);

CREATE INDEX IF NOT EXISTS pages_project_id_idx
    ON public.pages (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pages_parent_page_id_idx
    ON public.pages (parent_page_id) WHERE parent_page_id IS NOT NULL;

-- ── access helpers: a project member can read and edit the project's pages ──
-- Same bodies as 2026-10-20_living_pages.sql plus one clause each.

CREATE OR REPLACE FUNCTION public.can_read_page(p_page_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.pages p
        WHERE p.id = p_page_id
          AND (
              p.visibility = 'public'
              OR p.owner_id = p_uid
              OR (
                  p.visibility = 'team'
                  AND EXISTS (
                      SELECT 1 FROM public.page_members pm
                      WHERE pm.page_id = p.id AND pm.user_id = p_uid
                  )
              )
              OR (
                  p.project_id IS NOT NULL
                  AND public.is_project_member(p.project_id, p_uid)
              )
          )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_page(p_page_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.pages p
        WHERE p.id = p_page_id
          AND (
              p.owner_id = p_uid
              OR (
                  p.visibility = 'team'
                  AND EXISTS (
                      SELECT 1 FROM public.page_members pm
                      WHERE pm.page_id = p.id AND pm.user_id = p_uid AND pm.role = 'editor'
                  )
              )
              OR (
                  p.project_id IS NOT NULL
                  AND public.is_project_member(p.project_id, p_uid)
              )
          )
    );
$$;

-- Grants are unchanged by CREATE OR REPLACE, restated for clarity.
REVOKE ALL ON FUNCTION public.can_read_page(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_page(UUID, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.can_edit_page(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_edit_page(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_edit_page(UUID, UUID) TO authenticated;

-- ── policies on pages (added next to the existing ones, none replaced) ──────

-- A project member may update a project page. Which columns they can really
-- change is decided by the guard trigger below (title only).
DROP POLICY IF EXISTS "Pages: project member update" ON public.pages;
CREATE POLICY "Pages: project member update"
    ON public.pages FOR UPDATE
    TO authenticated
    USING (
        project_id IS NOT NULL
        AND public.is_project_member(project_id, auth.uid())
    )
    WITH CHECK (
        project_id IS NOT NULL
        AND public.is_project_member(project_id, auth.uid())
    );

-- A lead of the project may delete any of its pages (the page owner can
-- already, through "Pages: owner delete").
DROP POLICY IF EXISTS "Pages: project lead delete" ON public.pages;
CREATE POLICY "Pages: project lead delete"
    ON public.pages FOR DELETE
    TO authenticated
    USING (
        project_id IS NOT NULL
        AND public.is_project_lead(project_id, auth.uid())
    );

-- ── guard trigger ────────────────────────────────────────────────────────────
-- Row-level security cannot limit WHICH columns an update touches, so this
-- does. A session-less caller (auth.uid() IS NULL: the service role the
-- refresh job and the website use, or the SQL editor) is never restricted.

CREATE OR REPLACE FUNCTION public.pages_guard_project_fields()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    -- A project page may only be attached to a project the caller belongs to,
    -- and a parent page must be in the same project.
    IF TG_OP = 'INSERT'
       OR (OLD.owner_id IS NOT DISTINCT FROM auth.uid()) THEN
        IF NEW.project_id IS NOT NULL
           AND (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id)
           AND NOT public.is_project_member(NEW.project_id, auth.uid()) THEN
            RAISE EXCEPTION 'pages: not a member of that project'
                USING ERRCODE = '42501';
        END IF;
        IF NEW.parent_page_id IS NOT NULL
           AND (TG_OP = 'INSERT' OR NEW.parent_page_id IS DISTINCT FROM OLD.parent_page_id)
           AND NOT EXISTS (
               SELECT 1 FROM public.pages par
               WHERE par.id = NEW.parent_page_id
                 AND NEW.project_id IS NOT NULL
                 AND par.project_id = NEW.project_id
           ) THEN
            RAISE EXCEPTION 'pages: the parent page must be in the same project'
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE by someone who is not the owner (a project member): title only.
    NEW.slug            := OLD.slug;
    NEW.seed_type       := OLD.seed_type;
    NEW.seed_input      := OLD.seed_input;
    NEW.owner_id        := OLD.owner_id;
    NEW.visibility      := OLD.visibility;
    NEW.refresh_enabled := OLD.refresh_enabled;
    NEW.project_id      := OLD.project_id;
    NEW.parent_page_id  := OLD.parent_page_id;
    NEW.created_at      := OLD.created_at;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pages_guard_project_fields() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pages_guard_project_fields() FROM anon;

-- Named so it runs before pages_touch_updated_at (triggers fire alphabetically).
DROP TRIGGER IF EXISTS pages_guard_project_fields_trg ON public.pages;
CREATE TRIGGER pages_guard_project_fields_trg
    BEFORE INSERT OR UPDATE ON public.pages
    FOR EACH ROW EXECUTE FUNCTION public.pages_guard_project_fields();
