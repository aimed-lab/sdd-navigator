-- =============================================================================
-- Migration: community_sections  (2026-08-31, same day)
-- =============================================================================
-- Adds a nullable, admin-configurable section list to `communities`, so a
-- community can choose which parts of its own page show, and in what
-- order.
--
-- SCHEMA: `sections JSONB`, nullable, no default. NULL means "show
-- everything, in the built-in default order" — every existing community
-- (every row created before this migration, and any created after it
-- without ever touching the Sections editor) has NULL here and renders
-- exactly as it did before this migration, unchanged. The built-in default
-- order/keys live in frontend code (lib/communityTypes.ts), not in this
-- table — there's nothing to backfill.
--
-- SHAPE, when set: an ORDERED JSON array, one object per section,
-- `[{"key":"projects","enabled":true}, ...]`. Order in the array IS
-- display order — there's no separate position column. Not validated by a
-- CHECK constraint (keys/shape are a frontend concern —
-- lib/communityTypes.ts's SECTION_KEYS/resolveSections()  — the same
-- posture this codebase already takes with description_capabilities
-- TEXT[], another admin-opaque JSON-ish column with no DB-side shape
-- enforcement).
--
-- ── PRE-FLIGHT CHECK (asked for explicitly): does `communities` have an
-- UPDATE policy already? NO. Confirmed by reading every migration that
-- touches `communities` RLS (2026-08-20_communities.sql adds SELECT only;
-- 2026-08-31_community_delete.sql adds DELETE; grepped for "FOR UPDATE...
-- ON public.communities" across database/migrations/ — zero matches). The
-- table has had no UPDATE path at all until now — not even a service-role
-- convenience one — so this migration adds one, admin-gated the same way
-- DELETE already is.
--
-- SCOPE OF THE NEW UPDATE POLICY: whole-row, not column-restricted to just
-- `sections`. Postgres RLS policies gate rows, not individual columns
-- (column-level restriction would need a BEFORE UPDATE trigger or the
-- separate GRANT-by-column mechanism, neither of which any other policy in
-- this codebase uses) — an admin able to update `sections` this way is
-- therefore also able to update `name`/`description`/`is_open` through the
-- same policy. That's judged acceptable, not incidental: an admin editing
-- their own community's name/description is a reasonable thing to allow
-- regardless of this feature, and no UI in this migration exposes a way to
-- do it yet — only updateCommunitySections() (lib/server/communities.ts)
-- calls through this policy, and it only ever sends `{ sections }`.
--
-- Run once in the Supabase SQL editor, AFTER
-- 2026-08-31_community_delete.sql (needs is_community_admin, already
-- defined by 2026-08-30_community_admin_membership.sql). Idempotent — safe
-- to re-run. NOT run against any database as part of writing this file.
-- =============================================================================

ALTER TABLE public.communities
    ADD COLUMN IF NOT EXISTS sections JSONB;

DROP POLICY IF EXISTS "Communities: admin update" ON public.communities;
CREATE POLICY "Communities: admin update"
    ON public.communities FOR UPDATE
    TO authenticated
    USING (public.is_community_admin(id, auth.uid()))
    WITH CHECK (public.is_community_admin(id, auth.uid()));
