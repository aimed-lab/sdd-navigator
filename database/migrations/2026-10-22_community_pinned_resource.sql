-- =============================================================================
-- Migration: community pinned resource  (2026-10-22)
-- =============================================================================
-- An admin can pin ONE community resource (for example the talk slides plus a
-- compendium). It shows on the community's Home tab as "PINNED BY ADMIN".
--
-- Shape: a nullable `communities.pinned_resource_id`, not an is_pinned flag on
-- community_resources. One column on the community makes "only ONE pinned" a
-- fact of the schema (a flag would need a partial unique index and a
-- two-row update to move the pin). ON DELETE SET NULL: deleting the pinned
-- resource just unpins it.
--
-- Reads and writes of `communities` are unchanged: the column rides on the
-- existing "Communities: admin update" policy (only an admin can set it) and
-- the existing public read.
--
-- NOT run against any database by whoever wrote it. Run once in the Supabase
-- SQL editor. Idempotent: safe to re-run.
--
-- PARTS
--   1. The column + a same-community check (runs anywhere; run this first).
--   2. Signed-out access to the PINNED resource's files, for communities whose
--      public_preview = 'open' ONLY. Needed because today every community
--      resource file is member-only (see 2026-09-21_community_resource_files*.sql).
--      Run part 2 as its own script if the storage statement errors with
--      "must be owner of table objects" (same reason the storage migrations
--      are split); the rows part and the storage part are separated below.
--   3. OPTIONAL, commented out: signed-out access to the whole Resources list
--      and to announcements on 'open' communities. Not enabled by default
--      because it widens more than the pinned resource.
-- =============================================================================


-- ── 1. The column ────────────────────────────────────────────────────────────

ALTER TABLE public.communities
    ADD COLUMN IF NOT EXISTS pinned_resource_id UUID
    REFERENCES public.community_resources (id) ON DELETE SET NULL;

-- A community can only pin ITS OWN resource. A plain FK cannot say that (the
-- resource's community_id must equal this row's id), and the admin-update RLS
-- policy only proves the caller is an admin of THIS community, not that the
-- resource belongs to it.
CREATE OR REPLACE FUNCTION public.communities_pinned_resource_check()
RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.pinned_resource_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.community_resources r
        WHERE r.id = NEW.pinned_resource_id AND r.community_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'The pinned resource must belong to this community'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS communities_pinned_resource_check ON public.communities;
CREATE TRIGGER communities_pinned_resource_check
    BEFORE INSERT OR UPDATE OF pinned_resource_id ON public.communities
    FOR EACH ROW EXECUTE FUNCTION public.communities_pinned_resource_check();


-- ── 2a. Signed-out access to the pinned resource's rows ──────────────────────
-- WHAT IS BLOCKED TODAY: community_resources and community_resource_files have
-- one SELECT policy each, `TO authenticated ... is_community_member(...)`. A
-- signed-out visitor (role anon) and a signed-in non-member both get zero rows.
--
-- WHAT THIS ADDS: one extra SELECT policy on each table, for anon AND
-- authenticated, true ONLY for the resource that a community with
-- public_preview = 'open' has pinned. Nothing else in the community becomes
-- readable: other resources, their files, and everything for 'standard' and
-- 'minimal' communities stay exactly as they are. (Policies are OR-ed, so the
-- member policies keep working unchanged.)
--
-- The subquery reads `communities`, which is publicly readable already.

DROP POLICY IF EXISTS "Community resources: pinned on open community" ON public.community_resources;
CREATE POLICY "Community resources: pinned on open community"
    ON public.community_resources FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.communities c
            WHERE c.id = community_resources.community_id
              AND c.pinned_resource_id = community_resources.id
              AND c.public_preview = 'open'
        )
    );

DROP POLICY IF EXISTS "Community resource files: pinned on open community" ON public.community_resource_files;
CREATE POLICY "Community resource files: pinned on open community"
    ON public.community_resource_files FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.communities c
            WHERE c.id = community_resource_files.community_id
              AND c.pinned_resource_id = community_resource_files.resource_id
              AND c.public_preview = 'open'
        )
    );

-- The anon role also needs table-level SELECT for a policy to apply at all
-- (the failure 2026-09-19_community_feed_preview_anon_grant.sql fixed for the
-- feed). Column-wide, but RLS above limits it to the pinned rows.
GRANT SELECT ON public.community_resources TO anon;
GRANT SELECT ON public.community_resource_files TO anon;


-- ── 2b. Signed-out access to the pinned resource's FILES (storage) ───────────
-- WHAT IS BLOCKED TODAY: the private bucket `community-resource-files` has only
-- `community_resource_files_member_select` (TO authenticated, members only), so
-- createSignedUrl() fails for a signed-out visitor: they can see the pinned
-- card but could not open the file.
--
-- WHAT THIS ADDS: one SELECT policy on storage.objects, scoped to objects that
-- are files of the pinned resource of an 'open' community. The bucket stays
-- private (no public URLs); the app still mints a short-lived signed URL.
--
-- If this errors with "must be owner of table objects", the policy cannot be
-- created from the SQL editor on this project. Create it in the dashboard
-- instead (Storage > Policies > community-resource-files > New policy > SELECT,
-- roles anon + authenticated) using the USING expression below.

DROP POLICY IF EXISTS "community_resource_files_pinned_open_select" ON storage.objects;
CREATE POLICY "community_resource_files_pinned_open_select"
    ON storage.objects FOR SELECT
    TO anon, authenticated
    USING (
        bucket_id = 'community-resource-files'
        AND EXISTS (
            SELECT 1
            FROM public.community_resource_files f
            JOIN public.communities c ON c.id = f.community_id
            WHERE f.url = storage.objects.name
              AND c.pinned_resource_id = f.resource_id
              AND c.public_preview = 'open'
        )
    );


-- ── 3. OPTIONAL: the whole Resources list and announcements, signed out ─────
-- The product spec shows Resources and Updates to a signed-out visitor on an
-- 'open' community. The feed items and roster already work that way (2026-09-20).
-- Resources and announcements do NOT: they are member-only today. They are left
-- OFF here so this migration widens nothing beyond the pinned resource. To turn
-- them on, uncomment and run:
--
-- DROP POLICY IF EXISTS "Community resources: open community select" ON public.community_resources;
-- CREATE POLICY "Community resources: open community select"
--     ON public.community_resources FOR SELECT
--     TO anon, authenticated
--     USING (EXISTS (SELECT 1 FROM public.communities c
--                    WHERE c.id = community_resources.community_id AND c.public_preview = 'open'));
--
-- DROP POLICY IF EXISTS "Community announcements: open community select" ON public.community_announcements;
-- CREATE POLICY "Community announcements: open community select"
--     ON public.community_announcements FOR SELECT
--     TO anon, authenticated
--     USING (EXISTS (SELECT 1 FROM public.communities c
--                    WHERE c.id = community_announcements.community_id AND c.public_preview = 'open'));
-- GRANT SELECT ON public.community_announcements TO anon;
--
-- (Resource FILES for those other resources would still be member-only; opening
-- them needs the same storage + community_resource_files change as part 2,
-- without the `pinned_resource_id` condition.)
