-- =============================================================================
-- Migration: project_digests  (2026-08-19)
-- =============================================================================
-- Persists the project agent's prior-art digest, which today lives only in
-- component state (frontend/components/projects/AgentSection.tsx) — a team
-- runs the agent, gets a 30KB document, reloads the page, and it's gone
-- unless they downloaded it. This is also what the project wiki (memory
-- that must survive by definition) is currently blocked on.
--
-- WHAT'S PERSISTED: the digest ONLY, not the proposed resources/checklist
-- items. Those are a decision moment — a human reviews them and either
-- Accepts (which already persists, through saveToProjectAction/
-- addChecklistItemAction) or Discards. A STALE stored proposal would
-- confuse rather than help ("why does this say propose X, I already have
-- X"), unlike the digest, which is a point-in-time research summary that's
-- still useful stale, dated as such.
--
-- ONE ROW PER PROJECT, REPLACED ON EACH RUN — NOT A HISTORY. project_id is
-- the PRIMARY KEY itself (not a separate row id) specifically so a save is
-- a plain upsert-on-project_id, never an accumulating table. If history is
-- wanted later: this table would need a real surrogate id (UUID) instead of
-- project_id as the key, project_id would become a plain indexed FK column,
-- and every insert would need to be an INSERT rather than an upsert — a
-- straightforward change, but a real one, not something to half-build here
-- by e.g. leaving a surrogate id unused. Not building it now because
-- nothing has asked for "compare this run to three runs ago" yet, and a
-- history table nobody reads is only cost.
--
-- COLUMNS: project id, markdown, generated_at (the backend's own generation
-- timestamp — this is "the date it was generated" the frontend displays,
-- distinct from whenever the save itself happened to land), counts (the
-- per-source result counts, JSONB — see tools/prior_art_brief.py's
-- render_digest(): papers/stopped_trials/recruiting_trials/tools/datasets/
-- genesets/grants), and goal_text (what the digest was generated from —
-- lets a later viewer tell whether the project's description has moved on
-- from what's stored here, without needing a history table to compare
-- against).
--
-- RLS: same pattern as checklist_items (2026-08-04_projects.sql) —
-- membership via is_project_member(), not ownership. A non-member gets
-- ZERO rows, not a hidden one client-side. ANY member may read or write
-- (write happens server-side only, from app/api/project-agent/status/
-- route.ts after a successful run — see that route and
-- lib/server/projects.ts's saveProjectDigest() — never from a client POST;
-- there is deliberately no reason for the browser to write this table
-- directly). No DELETE policy: nothing in this feature deletes a digest
-- row; a project's digest is replaced by upsert or ages out silently with
-- the project itself (ON DELETE CASCADE).
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.project_digests (
    project_id    UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    markdown      TEXT        NOT NULL,
    -- The backend's own generation timestamp (tools/prior_art_brief.py's
    -- render_digest(), UTC ISO string) — NOT this row's own insert/update
    -- time. Stored as the value the frontend displays ("generated Aug 19,
    -- 2026"); Postgres's own row metadata doesn't carry this distinction.
    generated_at  TIMESTAMPTZ NOT NULL,
    counts        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    goal_text     TEXT        NOT NULL,
    saved_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_digests_pkey PRIMARY KEY (project_id)
);

ALTER TABLE public.project_digests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project digests: member select" ON public.project_digests;
CREATE POLICY "Project digests: member select"
    ON public.project_digests FOR SELECT
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project digests: member insert" ON public.project_digests;
CREATE POLICY "Project digests: member insert"
    ON public.project_digests FOR INSERT
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

-- UPDATE, not just INSERT — "replaced on each run" is an upsert
-- (INSERT ... ON CONFLICT (project_id) DO UPDATE), which needs both
-- privileges under RLS for the conflict-update branch.
DROP POLICY IF EXISTS "Project digests: member update" ON public.project_digests;
CREATE POLICY "Project digests: member update"
    ON public.project_digests FOR UPDATE
    USING (public.is_project_member(project_id, auth.uid()))
    WITH CHECK (public.is_project_member(project_id, auth.uid()));
