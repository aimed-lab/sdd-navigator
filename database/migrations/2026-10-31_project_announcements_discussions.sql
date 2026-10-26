-- 2026-10-31  Announcements (staff only) and Discussions (members)
--
-- Needs: 2026-10-27_project_updates.sql, 2026-10-27_project_manager_role.sql
-- (is_project_staff) and 2026-10-24_promote_redesign.sql (is_site_admin).
-- Idempotent: safe to re-run. NOT RUN as part of writing it.
--
-- PART 1: ANNOUNCEMENTS (the Updates tab of Slice 2, renamed)
-- Slice 2's public.project_updates is kept. What changes:
--   * pinned (boolean) and edited_at (timestamp) are added.
--   * An ANNOUNCEMENT can be posted, edited, pinned and deleted only by a lead or
--     manager of the project, or a site admin. Members read.
--   * A member can still post a 'help' request (the Overview "needs help" banner
--     from Slice 2 keeps working); only staff resolve it. Members can no longer
--     post a plain 'update' (the kind stays in the CHECK so older rows stay
--     valid; nobody can create one now).
--   * The author of a help post may delete it; an announcement is deleted only
--     by staff or a site admin (an author who was later demoted loses it).
--   * A site admin has the staff rights even when not a member of the project.
--     They still cannot READ the project's rows unless they are a member: add a
--     site admin as a project 'manager' when they need to see it.
--   * Slice 2's trigger only let resolved_at change. It is replaced by one that
--     lets resolved_at change on a help post, and body / pinned change on an
--     announcement (edited_at is stamped when the body changes). Every other
--     column is put back to its old value; a caller with no session is not
--     restricted.
--
-- PART 2: DISCUSSIONS
--   project_threads         a title and a plain-text body, started by a member.
--   project_thread_replies  plain-text replies. project_id is copied onto the
--                           reply (and tied to the thread by a composite foreign
--                           key) so the policies can test membership without a join.
-- Members only (is_project_member). Any member starts a thread or replies. The
-- AUTHOR, a project LEAD or a site admin deletes (a manager who is not a lead
-- can delete only their own). Nobody edits: there is no UPDATE grant. A reply
-- bumps the thread's last_activity_at through a trigger, which is how
-- "newest activity first" works without members being able to update threads.

-- PART 1 ----------------------------------------------------------------------

ALTER TABLE public.project_updates ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.project_updates ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- Pinned announcements first, then newest.
CREATE INDEX IF NOT EXISTS project_updates_announcements_idx
    ON public.project_updates (project_id, pinned DESC, created_at DESC)
    WHERE kind = 'announcement';

DROP POLICY IF EXISTS "Project updates: member insert" ON public.project_updates;
CREATE POLICY "Project updates: member insert"
    ON public.project_updates FOR INSERT
    TO authenticated
    WITH CHECK (
        author_id = auth.uid()
        AND resolved_at IS NULL
        AND (
            -- an announcement: staff or a site admin; pinned only on an announcement
            (kind = 'announcement'
                AND (public.is_project_staff(project_id, auth.uid()) OR public.is_site_admin()))
            -- a help request: any member, never pinned
            OR (kind = 'help'
                AND pinned = false
                AND public.is_project_member(project_id, auth.uid()))
        )
    );

DROP POLICY IF EXISTS "Project updates: author or staff delete" ON public.project_updates;
CREATE POLICY "Project updates: author or staff delete"
    ON public.project_updates FOR DELETE
    TO authenticated
    USING (
        public.is_project_staff(project_id, auth.uid())
        OR public.is_site_admin()
        OR (author_id = auth.uid() AND kind <> 'announcement')
    );

DROP POLICY IF EXISTS "Project updates: staff resolve" ON public.project_updates;
DROP POLICY IF EXISTS "Project updates: staff update" ON public.project_updates;
CREATE POLICY "Project updates: staff update"
    ON public.project_updates FOR UPDATE
    TO authenticated
    USING (public.is_project_staff(project_id, auth.uid()) OR public.is_site_admin())
    WITH CHECK (public.is_project_staff(project_id, auth.uid()) OR public.is_site_admin());

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

    IF OLD.kind = 'announcement' THEN
        -- only the text and the pin may change
        IF NEW.body IS DISTINCT FROM OLD.body THEN
            NEW.edited_at := now();
        ELSE
            NEW.edited_at := OLD.edited_at;
        END IF;
        NEW.resolved_at := OLD.resolved_at;
    ELSIF OLD.kind = 'help' THEN
        -- only resolving / reopening may change
        NEW.body       := OLD.body;
        NEW.pinned     := OLD.pinned;
        NEW.edited_at  := OLD.edited_at;
    ELSE
        -- nothing else is editable
        IF NEW.resolved_at IS DISTINCT FROM OLD.resolved_at THEN
            RAISE EXCEPTION 'project_updates: only a help post can be resolved'
                USING ERRCODE = '42501';
        END IF;
        NEW.body       := OLD.body;
        NEW.pinned     := OLD.pinned;
        NEW.edited_at  := OLD.edited_at;
    END IF;

    NEW.project_id := OLD.project_id;
    NEW.author_id  := OLD.author_id;
    NEW.kind       := OLD.kind;
    NEW.created_at := OLD.created_at;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.project_updates_only_resolve() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_updates_only_resolve() FROM anon;
REVOKE ALL ON FUNCTION public.project_updates_only_resolve() FROM authenticated;

DROP TRIGGER IF EXISTS project_updates_only_resolve_trg ON public.project_updates;
CREATE TRIGGER project_updates_only_resolve_trg
    BEFORE UPDATE ON public.project_updates
    FOR EACH ROW EXECUTE FUNCTION public.project_updates_only_resolve();

REVOKE UPDATE ON public.project_updates FROM authenticated;
GRANT UPDATE (resolved_at, body, pinned) ON public.project_updates TO authenticated;

-- PART 2 ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_threads (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    author_id        UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    title            TEXT        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    body             TEXT        NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, project_id)
);

CREATE INDEX IF NOT EXISTS project_threads_project_activity_idx
    ON public.project_threads (project_id, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS public.project_thread_replies (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id  UUID        NOT NULL,
    project_id UUID        NOT NULL,
    author_id  UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    body       TEXT        NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (thread_id, project_id)
        REFERENCES public.project_threads (id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS project_thread_replies_thread_idx
    ON public.project_thread_replies (thread_id, created_at);

ALTER TABLE public.project_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_thread_replies ENABLE ROW LEVEL SECURITY;

-- threads
DROP POLICY IF EXISTS "Threads: member select" ON public.project_threads;
CREATE POLICY "Threads: member select"
    ON public.project_threads FOR SELECT
    TO authenticated
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Threads: member insert" ON public.project_threads;
CREATE POLICY "Threads: member insert"
    ON public.project_threads FOR INSERT
    TO authenticated
    WITH CHECK (author_id = auth.uid() AND public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Threads: author, lead or site admin delete" ON public.project_threads;
CREATE POLICY "Threads: author, lead or site admin delete"
    ON public.project_threads FOR DELETE
    TO authenticated
    USING (
        author_id = auth.uid()
        OR public.is_project_lead(project_id, auth.uid())
        OR public.is_site_admin()
    );

-- replies
DROP POLICY IF EXISTS "Replies: member select" ON public.project_thread_replies;
CREATE POLICY "Replies: member select"
    ON public.project_thread_replies FOR SELECT
    TO authenticated
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Replies: member insert" ON public.project_thread_replies;
CREATE POLICY "Replies: member insert"
    ON public.project_thread_replies FOR INSERT
    TO authenticated
    WITH CHECK (author_id = auth.uid() AND public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Replies: author, lead or site admin delete" ON public.project_thread_replies;
CREATE POLICY "Replies: author, lead or site admin delete"
    ON public.project_thread_replies FOR DELETE
    TO authenticated
    USING (
        author_id = auth.uid()
        OR public.is_project_lead(project_id, auth.uid())
        OR public.is_site_admin()
    );

-- A reply moves its thread to the top ("newest activity first").
CREATE OR REPLACE FUNCTION public.project_thread_bump()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    UPDATE public.project_threads
    SET last_activity_at = NEW.created_at
    WHERE id = NEW.thread_id AND project_id = NEW.project_id;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.project_thread_bump() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_thread_bump() FROM anon;
REVOKE ALL ON FUNCTION public.project_thread_bump() FROM authenticated;

DROP TRIGGER IF EXISTS project_thread_bump_trg ON public.project_thread_replies;
CREATE TRIGGER project_thread_bump_trg
    AFTER INSERT ON public.project_thread_replies
    FOR EACH ROW EXECUTE FUNCTION public.project_thread_bump();

-- Grants: signed-in only; nobody edits.
REVOKE ALL ON public.project_threads FROM PUBLIC;
REVOKE ALL ON public.project_threads FROM anon;
REVOKE ALL ON public.project_threads FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.project_threads TO authenticated;

REVOKE ALL ON public.project_thread_replies FROM PUBLIC;
REVOKE ALL ON public.project_thread_replies FROM anon;
REVOKE ALL ON public.project_thread_replies FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.project_thread_replies TO authenticated;
