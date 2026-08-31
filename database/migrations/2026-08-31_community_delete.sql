-- =============================================================================
-- Migration: community_delete  (2026-08-31)
-- =============================================================================
-- Lets a community's admin delete it. Admin-only —
-- "Communities: admin delete" checks is_community_admin(id, auth.uid()),
-- same function 2026-08-30_community_admin_membership.sql added for
-- everything else admin-gated.
--
-- DECISION 1 — what happens to the community's projects: NOT deleted.
-- projects.community_id was added (same migration) as
-- `REFERENCES public.communities (id) ON DELETE SET NULL` — already the
-- same idiom collab_posts.community_id and lab_resources.community_id use
-- (2026-08-20_communities.sql). Deleting the community sets community_id
-- back to NULL on every project that pointed at it, same as it already
-- does for a post or a resource; the project itself, its members,
-- checklist, resources, and shared folder are all untouched — it just
-- becomes a personal project again, exactly what it would have been had it
-- never been linked to a community in the first place.
--
-- DECISION 2 — RLS policy, not a SECURITY DEFINER function. The simpler
-- one works here because every side effect this delete needs is ALREADY a
-- plain FK constraint, not something that needs a transaction of its own:
--   * community_members.community_id -> ON DELETE CASCADE
--     (2026-08-20_communities.sql) removes every membership row for free.
--   * collab_posts.community_id / lab_resources.community_id / (this
--     migration's own) projects.community_id -> ON DELETE SET NULL, same
--     as above.
-- There's nothing left for a function to coordinate that Postgres's own
-- referential-action machinery doesn't already do as part of the single
-- DELETE statement — no multi-step logic, no value to compute, no
-- "return the new state" the caller needs back. Compare
-- create_community_with_admin, which genuinely needs a function: it writes
-- to TWO tables (communities + the founding community_members row) that
-- have no FK relationship pulling the second write along for free. Deleting
-- has only ONE table this app writes to directly; the rest cascade.
--
-- Run once in the Supabase SQL editor, AFTER
-- 2026-08-30_community_admin_membership.sql (needs is_community_admin).
-- Idempotent — safe to re-run. NOT run against any database as part of
-- writing this file.
-- =============================================================================

DROP POLICY IF EXISTS "Communities: admin delete" ON public.communities;
CREATE POLICY "Communities: admin delete"
    ON public.communities FOR DELETE
    TO authenticated
    USING (public.is_community_admin(id, auth.uid()));
