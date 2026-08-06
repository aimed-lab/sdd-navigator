-- =============================================================================
-- Migration: saved_items_projects  (2026-08-09)
-- =============================================================================
-- Lets a project's Resources section show papers/datasets/tools/trials/
-- grants the TEAM saved from Explore — shared, not just the saver's own
-- view. Adds project_id to public.saved_items and widens its RLS from
-- "rows I own" to "rows I own, OR rows belonging to a project I'm a member
-- of". Personal saves (project_id left null) keep working exactly as
-- today — see point 4 below for exactly what was checked to be sure of
-- that, not just asserted.
--
-- NO NEW FUNCTION. public.is_project_member(project_id, uid) already
-- exists (2026-08-04_projects.sql, SECURITY DEFINER, already granted to
-- authenticated) and is exactly the check these policies need. Reusing it
-- rather than writing a near-duplicate.
-- =============================================================================

-- =============================================================================
-- 1. THE CURRENT POLICIES, verbatim, as they stand today in
--    database/schema.sql — reported before touching anything, per the ask:
--
--    ALTER TABLE public.saved_items ENABLE ROW LEVEL SECURITY;
--
--    CREATE POLICY "saved_items_select_own"
--        ON public.saved_items FOR SELECT
--        TO authenticated
--        USING (auth.uid() = user_id);
--
--    CREATE POLICY "saved_items_insert_own"
--        ON public.saved_items FOR INSERT
--        TO authenticated
--        WITH CHECK (auth.uid() = user_id);
--
--    CREATE POLICY "saved_items_delete_own"
--        ON public.saved_items FOR DELETE
--        TO authenticated
--        USING (auth.uid() = user_id);
--
--    No UPDATE policy exists (none needed here either — a saved item is
--    added or removed, never edited in place) and none is added by this
--    migration. All three existing policies are TO authenticated, USING/
--    WITH CHECK auth.uid() = user_id, nothing else — genuinely "rows I
--    own" today, exactly as described.
-- =============================================================================

-- =============================================================================
-- 2. project_id — nullable, so personal saves (the only kind that exist
--    today) are completely unaffected: every existing row has project_id
--    NULL after this runs, and nothing about them changes. ON DELETE
--    CASCADE so deleting a project takes its shared saves with it, same
--    lifecycle as checklist_items/project_proposals
--    (2026-08-04_projects.sql) — a personal save (project_id NULL) has no
--    project to cascade from, so this can never touch one.
-- =============================================================================

ALTER TABLE public.saved_items
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects (id) ON DELETE CASCADE;

-- =============================================================================
-- 3. Index — the project page will filter Resources by project_id. Partial
--    (WHERE project_id IS NOT NULL) rather than a plain index over the
--    whole table: most rows are, and will stay, personal saves with
--    project_id NULL, so indexing only the minority that actually have one
--    is the useful index — same partial-index idiom already used for
--    idx_collab_posts_funding_status (2026-07-28) and
--    idx_connection_requests_unseen (schema.sql).
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_saved_items_project_id
    ON public.saved_items (project_id)
    WHERE project_id IS NOT NULL;

-- =============================================================================
-- 4. RLS — widened, not loosened for personal saves. Each policy's OWN-ROW
--    branch (auth.uid() = user_id) is preserved UNCHANGED and unconditional
--    in every one of the three; the project branch is purely ADDITIVE,
--    joined with OR (SELECT/DELETE) or AND (INSERT, where it's a
--    restriction, not a grant — see below). A personal save, whose
--    project_id is NULL, can never satisfy the project branch at all
--    (project_id IS NOT NULL is false for it), so its visibility rests
--    entirely on the unchanged own-row branch, identically to today.
-- =============================================================================

DROP POLICY IF EXISTS "saved_items_select_own" ON public.saved_items;
CREATE POLICY "saved_items_select_own"
    ON public.saved_items FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        OR (project_id IS NOT NULL AND public.is_project_member(project_id, auth.uid()))
    );

-- INSERT: user_id = auth.uid() is still required UNCONDITIONALLY — you can
-- only ever save AS YOURSELF, project-scoped or not; that half of the
-- check doesn't loosen at all. The project_id clause is an ADDITIONAL
-- restriction, not a second way in: if project_id is set, the caller must
-- also be a member of that project, which is what stops a non-member
-- injecting a row into someone else's project's shared saves. A personal
-- insert (project_id NULL) skips that clause entirely (project_id IS
-- NULL is true), so it's exactly today's check, unchanged.
DROP POLICY IF EXISTS "saved_items_insert_own" ON public.saved_items;
CREATE POLICY "saved_items_insert_own"
    ON public.saved_items FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        AND (project_id IS NULL OR public.is_project_member(project_id, auth.uid()))
    );

-- DELETE: the row's own owner, same as today, OR any member of the
-- project it belongs to — a shared workspace, so any teammate may tidy up
-- another's save. A personal save has no project to fall back on, so only
-- its owner can ever delete it, same as today.
DROP POLICY IF EXISTS "saved_items_delete_own" ON public.saved_items;
CREATE POLICY "saved_items_delete_own"
    ON public.saved_items FOR DELETE
    TO authenticated
    USING (
        auth.uid() = user_id
        OR (project_id IS NOT NULL AND public.is_project_member(project_id, auth.uid()))
    );

-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================
