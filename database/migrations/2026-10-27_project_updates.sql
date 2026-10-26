-- 2026-10-27  Project updates (the Updates tab)
--
-- One table, public.project_updates: short posts by project members.
--   kind 'update'        a progress note
--   kind 'announcement'  pinned at the top; only a lead or manager may post one
--   kind 'help'          "we need help with ..."; shows as a banner on the
--                        project's Overview until a lead or manager resolves it
--
-- Access (RLS)
--   * READ:    any member of the project (is_project_member(), any role).
--   * INSERT:  a member, as themselves (author_id = auth.uid()); kind
--              'announcement' only when is_project_staff() (lead or manager); a
--              new post cannot arrive already resolved.
--   * DELETE:  the author, or a lead or manager.
--   * UPDATE:  a lead or manager only, and only to resolve or reopen a help post
--              (see the trigger). Ordinary members cannot update anything.
--   * No access at all for anon.
--
-- WHY A POLICY PLUS A TRIGGER for resolving: row-level security can say WHO may
-- update a row but not WHICH columns they may change, so "a lead or manager can
-- set resolved_at" would otherwise also let them rewrite the body or the author.
-- The BEFORE UPDATE trigger puts every column except resolved_at back to its old
-- value and refuses to resolve anything that is not a help post. (An RPC would
-- work too; the policy+trigger pair keeps the app on plain table calls with the
-- user's own session.)
--
-- Needs 2026-10-27_project_manager_role.sql (is_project_staff). Idempotent: safe
-- to re-run. NOT RUN as part of writing it.

CREATE TABLE IF NOT EXISTS public.project_updates (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    author_id   UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    kind        TEXT        NOT NULL CHECK (kind IN ('update', 'announcement', 'help')),
    body        TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    resolved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_updates_project_created_idx
    ON public.project_updates (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_updates_open_help_idx
    ON public.project_updates (project_id) WHERE kind = 'help' AND resolved_at IS NULL;

ALTER TABLE public.project_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project updates: member select" ON public.project_updates;
CREATE POLICY "Project updates: member select"
    ON public.project_updates FOR SELECT
    TO authenticated
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project updates: member insert" ON public.project_updates;
CREATE POLICY "Project updates: member insert"
    ON public.project_updates FOR INSERT
    TO authenticated
    WITH CHECK (
        author_id = auth.uid()
        AND public.is_project_member(project_id, auth.uid())
        AND resolved_at IS NULL
        AND (kind <> 'announcement' OR public.is_project_staff(project_id, auth.uid()))
    );

DROP POLICY IF EXISTS "Project updates: author or staff delete" ON public.project_updates;
CREATE POLICY "Project updates: author or staff delete"
    ON public.project_updates FOR DELETE
    TO authenticated
    USING (
        author_id = auth.uid()
        OR public.is_project_staff(project_id, auth.uid())
    );

DROP POLICY IF EXISTS "Project updates: staff resolve" ON public.project_updates;
CREATE POLICY "Project updates: staff resolve"
    ON public.project_updates FOR UPDATE
    TO authenticated
    USING (public.is_project_staff(project_id, auth.uid()))
    WITH CHECK (public.is_project_staff(project_id, auth.uid()));

-- Only resolved_at may change, and only on a help post.
CREATE OR REPLACE FUNCTION public.project_updates_only_resolve()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.resolved_at IS DISTINCT FROM OLD.resolved_at AND OLD.kind <> 'help' THEN
        RAISE EXCEPTION 'project_updates: only a help post can be resolved'
            USING ERRCODE = '42501';
    END IF;
    NEW.project_id := OLD.project_id;
    NEW.author_id  := OLD.author_id;
    NEW.kind       := OLD.kind;
    NEW.body       := OLD.body;
    NEW.created_at := OLD.created_at;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.project_updates_only_resolve() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_updates_only_resolve() FROM anon;

DROP TRIGGER IF EXISTS project_updates_only_resolve_trg ON public.project_updates;
CREATE TRIGGER project_updates_only_resolve_trg
    BEFORE UPDATE ON public.project_updates
    FOR EACH ROW EXECUTE FUNCTION public.project_updates_only_resolve();

-- Table privileges: signed-in users only.
REVOKE ALL ON public.project_updates FROM anon;
REVOKE UPDATE ON public.project_updates FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.project_updates TO authenticated;
GRANT UPDATE (resolved_at) ON public.project_updates TO authenticated;
