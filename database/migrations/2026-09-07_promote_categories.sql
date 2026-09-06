-- =============================================================================
-- Migration: promote_showcase — categories + publish date  (2026-09-07)
-- =============================================================================
-- 1. Widens the `type` CHECK constraint so the new six-way "what are you
--    showcasing?" picker in /promote/submit (paper / talk / poster / award /
--    tool / other — see lib/showcaseTypes.ts) can be stored, WITHOUT dropping
--    the old case_study/white_paper/achievement values — rows created before
--    this picker existed keep their type as-is; nothing here rewrites data.
-- 2. Adds `published_at`, stamped by setArticlePublished(true), so the
--    article page can show a real publish date instead of `created_at`
--    (which is when the DRAFT was created, not when it went public).
--
-- Idempotent — safe to re-run.
-- =============================================================================

-- The constraint was created unnamed inline in the original CREATE TABLE
-- (2026-07-26_promote_showcase.sql), so Postgres named it
-- "<table>_<column>_check" by its default convention. If this DROP finds
-- nothing (a project's constraint ended up named differently), find the
-- actual name with:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public.promote_showcase'::regclass AND contype = 'c';
-- and drop that name instead before re-running this file.
ALTER TABLE public.promote_showcase DROP CONSTRAINT IF EXISTS promote_showcase_type_check;
ALTER TABLE public.promote_showcase
    ADD CONSTRAINT promote_showcase_type_check
    CHECK (type IN (
        -- current picker (lib/showcaseTypes.ts SHOWCASE_TYPES)
        'paper', 'talk', 'poster', 'award', 'tool', 'other',
        -- legacy, pre-picker values — still valid, never offered as a new choice
        'case_study', 'white_paper', 'achievement'
    ));

ALTER TABLE public.promote_showcase
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
