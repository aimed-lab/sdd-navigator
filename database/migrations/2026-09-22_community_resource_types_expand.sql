-- =============================================================================
-- Migration: expand community_resources.resource_type check  (2026-09-22)
-- =============================================================================
-- Adds four resource types that match how a research community actually
-- shares things day to day — a slide deck, meeting notes, a shared
-- folder/drive, a template or form — alongside the original six (tool,
-- paper, dataset, link, podcast, other) from
-- 2026-09-03_community_resources.sql, which read as a drug-discovery
-- reading list and left a session deck with nowhere to go but "other".
--
-- Plain TEXT + CHECK, not an enum — same reasoning as the original
-- migration's own header: this LOOSENS that same constraint (a superset of
-- the original six values, nothing removed, no existing row can violate
-- it), and stays exactly as easy to extend again later. No data migration
-- needed — every row written before this runs already has one of the
-- original six values, which stays valid.
--
-- Idempotent — DROP CONSTRAINT IF EXISTS before ADD CONSTRAINT, same as
-- the original migration, safe to re-run.
-- =============================================================================

ALTER TABLE public.community_resources
    DROP CONSTRAINT IF EXISTS community_resources_type_check;
ALTER TABLE public.community_resources
    ADD CONSTRAINT community_resources_type_check
        CHECK (resource_type IN (
            'tool', 'paper', 'dataset', 'link', 'podcast', 'other',
            'slides', 'notes', 'folder', 'template'
        ));
