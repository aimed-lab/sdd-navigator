-- 2026-11-06  The three ColaboFest finalist tasks, as checklist items
--
-- For every ColaboFest PROGRAM project (projects.program = 'colabofest_2026') that is a
-- FINALIST (projects.finalist = true), add three items to its checklist
-- (public.checklist_items, list 'team'), due 2026-11-11. The finalist page reads the
-- status of each task from the item with the same label, so the labels below must match
-- FINALIST_TASKS in frontend/lib/colabofestConfig.ts. 'ready' means Done, 'not_yet' means
-- To do. The project lead and the managers mark them from the page.
--
-- Idempotent: an item that already exists (same project, same label) is skipped, so it is
-- safe to re-run, and a project made a finalist later is covered by running it again.
-- Needs 2026-10-27_checklist_owners_due.sql (list_key, due_date) and
-- 2026-10-31_colabofest_project_core.sql / 2026-10-31_project_program.sql
-- (finalist, program). NOT RUN as part of writing it.

INSERT INTO public.checklist_items (project_id, label, status, position, list_key, due_date)
SELECT p.id, t.label, 'not_yet', t.position, 'team', DATE '2026-11-11'
FROM public.projects p
CROSS JOIN (
    VALUES
        ('Finalize your readiness checklist', 1001),
        ('Write your 6-week work plan',       1002),
        ('Schedule your kickoff meeting',     1003)
) AS t (label, position)
WHERE p.program = 'colabofest_2026'
  AND p.finalist = true
  AND NOT EXISTS (
      SELECT 1
      FROM public.checklist_items c
      WHERE c.project_id = p.id
        AND c.label = t.label
  );
