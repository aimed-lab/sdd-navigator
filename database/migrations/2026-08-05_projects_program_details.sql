-- =============================================================================
-- Migration: projects_program_details  (2026-08-05)
-- =============================================================================
-- Adds the four "Programme details (optional)" fields from the Stitch
-- create-project forms (frontend/design/projects/STRUCTURE.md, screens 2 and
-- 3): target, indication, modality, stage. All four are optional on both
-- forms — a project can be created with just a name and a goal — so every
-- column here is nullable with no default, same as connection_requests'
-- optional fields and unlike checklist_items.status (which is NOT NULL
-- DEFAULT 'not_yet' because every checklist item has some status).
--
-- modality and stage are TEXT + CHECK, not enum types — same shape as
-- collab_posts.funding_status (see 2026-07-28_collab_posts_funding_status.sql):
-- matches the existing pattern in this codebase rather than introducing a
-- second way of doing the same thing. Both CHECKs explicitly allow NULL, so
-- every existing projects row (and any future row that skips Programme
-- details entirely) passes untouched.
--
-- Option values are copied verbatim from the <select> elements in
-- frontend/design/projects/stitch_smartdrugdiscovery_research_platform/
-- smartdrugdiscovery_create_regular_project_form/code.html so the form and
-- the database agree on the same strings without a translation layer.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

-- ── projects.target ──────────────────────────────────────────────────────
-- Free text, e.g. "KRAS G12D", "PHGDH" — no fixed vocabulary, so no CHECK.
ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS target TEXT;

-- ── projects.indication ──────────────────────────────────────────────────
-- Free text, e.g. "pancreatic cancer" — no fixed vocabulary, so no CHECK.
ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS indication TEXT;

-- ── projects.modality ─────────────────────────────────────────────────────
ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS modality TEXT;

ALTER TABLE public.projects
    DROP CONSTRAINT IF EXISTS projects_modality_check;
ALTER TABLE public.projects
    ADD CONSTRAINT projects_modality_check
        CHECK (modality IS NULL OR modality IN
               ('small_molecule', 'biologic', 'protac', 'aso_rna', 'cell_therapy', 'other'));

-- ── projects.stage ────────────────────────────────────────────────────────
ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS stage TEXT;

ALTER TABLE public.projects
    DROP CONSTRAINT IF EXISTS projects_stage_check;
ALTER TABLE public.projects
    ADD CONSTRAINT projects_stage_check
        CHECK (stage IS NULL OR stage IN
               ('target_id', 'hit_finding', 'lead_opt', 'preclinical', 'ind_enabling'));
