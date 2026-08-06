-- =============================================================================
-- Migration: saved_items_unique_fix  (2026-08-11)
-- =============================================================================
-- Fixes a real collision introduced by 2026-08-09_saved_items_projects.sql.
-- saved_items still carries its original UNIQUE (user_id, item_id) from
-- database/schema.sql, unrelated to project_id and never touched by that
-- migration. Today the same paper can't be saved to a personal list AND a
-- project, or to two different projects, by the same user — the second
-- insert collides with the first. lib/server/projectResources.ts's
-- saveToProject() currently catches that as a 23505 and reports a
-- deliberately honest error rather than silently doing nothing; this
-- migration removes the need for that error path entirely.
--
-- PRE-FLIGHT CHECK (run before writing this migration, not asserted):
-- SELECT user_id, item_id, project_id, count(*) FROM public.saved_items
--   GROUP BY user_id, item_id, project_id HAVING count(*) > 1;
-- Queried the live table directly (all 6 existing rows dumped) — zero
-- duplicate (user_id, item_id, project_id) combinations exist. Every
-- current row is a personal save (project_id NULL, no project saves
-- survived past the previous step's cleanup), so this migration is safe
-- to apply as-is. If you've added rows since, re-run the query above
-- first — ADD CONSTRAINT below will fail loudly (not silently) if any
-- duplicates now exist.
--
-- WHY NOT "UNIQUE (user_id, item_id, project_id)" outright: Postgres
-- treats NULL as DISTINCT from NULL in a plain UNIQUE constraint, so two
-- personal saves (project_id NULL both times) of the same item would
-- both satisfy that constraint — reintroducing the exact personal-list
-- duplicate bug the ORIGINAL UNIQUE (user_id, item_id) was written to
-- prevent, just with an extra column not helping.
--
-- WHY NOT "UNIQUE NULLS NOT DISTINCT (...)" (Postgres 15+): this project's
-- REST root (GET /rest/v1/) reports info.version "14.5" — PostgREST
-- surfaces the connected server's actual Postgres version there, and
-- PostgREST puts the literal server_version string in that field. This
-- database is on Postgres 14, where NULLS NOT DISTINCT does not exist
-- (added in 15). Using it here would fail outright at apply time.
--
-- CHOSEN: two partial unique indexes, scoped by project_id IS [NOT] NULL,
-- the exact idiom idx_saved_items_project_id (2026-08-09) already uses in
-- this same table for the same reason (most rows are, and will stay,
-- personal). One index covers "you can't save the same item to your
-- personal list twice" (project_id IS NULL), the other covers "you can't
-- save the same item into the SAME project twice" (project_id IS NOT
-- NULL) — saving the same item into two DIFFERENT projects is two
-- separate rows, each satisfying its own index entry, which is exactly
-- the behavior asked for.
-- =============================================================================

-- Drop the original table-level UNIQUE (user_id, item_id) — Postgres
-- auto-named it saved_items_user_id_item_id_key since schema.sql declared
-- it inline with no explicit name. Superseded by the two partial indexes
-- below; leaving it in place would still block a personal+project or
-- project+project double-save even after those are added.
ALTER TABLE public.saved_items
    DROP CONSTRAINT IF EXISTS saved_items_user_id_item_id_key;

DROP INDEX IF EXISTS public.saved_items_personal_unique;
CREATE UNIQUE INDEX saved_items_personal_unique
    ON public.saved_items (user_id, item_id)
    WHERE project_id IS NULL;

DROP INDEX IF EXISTS public.saved_items_project_unique;
CREATE UNIQUE INDEX saved_items_project_unique
    ON public.saved_items (user_id, item_id, project_id)
    WHERE project_id IS NOT NULL;

-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================
