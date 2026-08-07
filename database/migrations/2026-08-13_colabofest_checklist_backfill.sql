-- =============================================================================
-- Migration: backfill the ColaboFest readiness checklist onto existing
-- projects  (2026-08-13)
-- =============================================================================
-- 2026-08-12_colabofest_checklist_seed.sql only seeds Section A's nine items
-- at CREATE time, inside create_project_with_lead(). Any project with
-- challenge_key = 'colabofest_2026' created before that migration landed
-- still has zero checklist items, and the "Section A essentials are
-- pre-filled below" copy above an empty list is actively wrong for them
-- (see frontend/components/projects/ChecklistSection.tsx, fixed alongside
-- this migration).
--
-- SCOPE: only projects with challenge_key = 'colabofest_2026' AND zero
-- existing checklist_items rows. A project that already has items — seeded
-- by the earlier migration, or added by hand — is left untouched even if a
-- team deleted every seeded item on purpose; this migration can't tell
-- "never seeded" apart from "seeded then emptied by choice", and the task
-- says explicitly not to guess in that direction.
--
-- Idempotent: safe to re-run. A project picked up by an earlier run now has
-- items, so the NOT EXISTS guard excludes it on a second pass.
-- =============================================================================

INSERT INTO public.checklist_items (project_id, label, status, position)
SELECT p.id, item.label, 'not_yet', item.position
FROM public.projects p
CROSS JOIN (
    VALUES
        ('Our team includes at least one co-investigator from UAB or the CCTS Partner Network.', 1),
        ('We can state the unmet need or translational bottleneck in one or two sentences.', 2),
        ('We have a testable target, mechanism, intervention, or patient-cohort hypothesis.', 3),
        ('We can name the decision or deliverable we need from SPARC.', 4),
        ('A scientific or clinical lead owns the biological interpretation of the project.', 5),
        ('We have credible supporting evidence, preliminary findings, or a strong published foundation.', 6),
        ('We understand what data or structural information the proposed analysis requires.', 7),
        ('A team member or committed collaborator can own downstream validation.', 8),
        ('We can describe the next translational milestone if the project succeeds.', 9)
) AS item(label, position)
WHERE p.challenge_key = 'colabofest_2026'
  AND NOT EXISTS (
      SELECT 1 FROM public.checklist_items ci WHERE ci.project_id = p.id
  );
