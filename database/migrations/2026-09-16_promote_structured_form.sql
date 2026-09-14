-- =============================================================================
-- Migration: promote_structured_form  (2026-09-16)
-- =============================================================================
-- Adds 'event' to promote_showcase.type's allowed values — the only schema
-- change the structured five-question submit form
-- (components/promote/SubmitFlow.tsx) needs. Every other part of that
-- change (a GitHub-URL post-generation path replaced by five short
-- questions asked for every non-paper type; the GitHub fetch kept only as
-- an optional prefill for the tool type's own answers) is application code
-- — no new column, no new table. See lib/showcaseTypes.ts's own header on
-- why: the five slots (oneLiner/contrast/specifics/context/audience) are
-- generated into the SAME headline/standfirst/article_body/linkedin_post
-- columns every other type already writes to.
--
-- WHY 'event' IS NEW: a talk and an event share a where/when context
-- question, but need genuinely different second questions ("what did
-- people think before/now" for a talk vs. "why does this matter now" for
-- an event) — see STRUCTURED_QUESTIONS in lib/showcaseTypes.ts. That only
-- makes sense as two distinct types, not one relabeled, so 'event' joins
-- the picker rather than being folded into 'talk' or 'other'.
--
-- CHECK CONSTRAINT NAME: promote_showcase.type's CHECK was declared inline
-- in CREATE TABLE (database/schema.sql), never given an explicit name —
-- Postgres auto-names an inline column CHECK "<table>_<column>_check", so
-- this drops and recreates that default name specifically
-- (promote_showcase_type_check), the same idiom every other CHECK-widening
-- migration in this repo uses (e.g.
-- 2026-08-30_community_admin_membership.sql's community_members_role_check).
--
-- Run once, top to bottom, in the Supabase SQL editor. Idempotent (DROP
-- CONSTRAINT IF EXISTS before ADD CONSTRAINT) — safe to re-run. NOT run
-- against any database as part of writing this file.
-- =============================================================================

ALTER TABLE public.promote_showcase DROP CONSTRAINT IF EXISTS promote_showcase_type_check;
ALTER TABLE public.promote_showcase
    ADD CONSTRAINT promote_showcase_type_check CHECK (type IN (
        'paper', 'talk', 'poster', 'award', 'tool', 'event', 'other',
        'case_study', 'white_paper', 'achievement'
    ));
