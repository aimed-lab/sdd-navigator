-- =============================================================================
-- Migration: community_resource_files — CORE  (2026-09-21)   [RUN THIS FIRST]
-- =============================================================================
-- Lets a community resource (community_resources,
-- 2026-09-03_community_resources.sql) carry one or more attached files —
-- session slides, decks, protocols, documents — alongside its existing
-- optional url. A resource is still valid with a file, a url, both, or
-- neither; this table only ever ADDS rows, it never makes url required.
--
-- Modeled directly on promote_showcase_media
-- (database/migrations/2026-09-06_promote_media.sql), with the same
-- reasoning for every shape choice, adjusted for the different ownership
-- model: showcase media is OWNER-gated (one person's draft/article),
-- community resources are ADMIN-gated (any admin manages the whole
-- community's shared resource list) — so every write check below is
-- is_community_admin(community_id, ...), never a per-uploader owner_id
-- check, and read is is_community_member(community_id, ...), never a
-- published flag (a community has no public/private toggle on its
-- resources — see 2026-09-03_community_resources.sql's own header).
--
-- Touches ONLY the `public` schema, so it cannot fail on storage
-- permissions. SPLIT DELIBERATELY from the storage bucket/policy setup in
-- 2026-09-21_community_resource_files_storage.sql for the same reason
-- 2026-09-06_promote_media.sql was split from its own storage migration:
-- the Supabase SQL editor runs a script as ONE transaction, and
-- `CREATE POLICY ... ON storage.objects` fails with "must be owner of
-- table objects" on many projects, which would roll back this table too.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.community_resource_files (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id  UUID        NOT NULL REFERENCES public.community_resources (id) ON DELETE CASCADE,
    -- Denormalized off resource_id (not just derivable via a join) for the
    -- exact same reason showcase media's storage policy keys off
    -- showcase_id directly: it lets both the row-level policy below AND the
    -- storage.objects policy in the companion migration check membership
    -- with one flat lookup, no join through community_resources needed on
    -- the storage side (storage.objects has no FK to reach it through
    -- anyway — the object's folder name is the only thing it can key on).
    community_id UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    added_by     UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    -- The storage OBJECT PATH inside the private community-resource-files
    -- bucket (`<community_id>/<uuid>.<ext>`), NOT a public URL — the bucket
    -- has no public read, so every render mints a short-lived signed URL
    -- from this path (see lib/server/communities.ts's
    -- signCommunityResourceFilePath). Column named `url` to mirror
    -- promote_showcase_media.url's naming, but it is a path.
    url          TEXT        NOT NULL,
    filename     TEXT        NOT NULL,
    size_bytes   BIGINT      NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.community_resource_files ENABLE ROW LEVEL SECURITY;

-- Read: any ACTIVE member of the community — same gate as
-- community_resources' own "member select" policy, and deliberately NOT
-- relaxed for a community with public_preview = 'open'. A document is not
-- the same as a title in a feed: the open-preview levels
-- (2026-09-18_community_public_preview.sql) only ever widen what a
-- non-member can see about the FEED/roster, never what they can read or
-- download from inside a member-only resource.
DROP POLICY IF EXISTS "Community resource files: member select" ON public.community_resource_files;
CREATE POLICY "Community resource files: member select"
    ON public.community_resource_files FOR SELECT
    TO authenticated
    USING (public.is_community_member(community_id, auth.uid()));

-- Write: admin-only, same as community_resources' own write policies.
-- WITH CHECK also confirms resource_id actually belongs to community_id —
-- checking is_community_admin(community_id, ...) alone would let an admin
-- of community A attach a file to a resource row that (through a forged
-- resource_id) belongs to community B, by supplying community A's own id
-- as community_id. Same shape as promote_showcase_media_insert_own's
-- "owner_id matches AND the parent row is really theirs" check.
DROP POLICY IF EXISTS "Community resource files: admin insert" ON public.community_resource_files;
CREATE POLICY "Community resource files: admin insert"
    ON public.community_resource_files FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = added_by
        AND public.is_community_admin(community_id, auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.community_resources r
            WHERE r.id = resource_id AND r.community_id = community_id
        )
    );

DROP POLICY IF EXISTS "Community resource files: admin delete" ON public.community_resource_files;
CREATE POLICY "Community resource files: admin delete"
    ON public.community_resource_files FOR DELETE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()));

CREATE INDEX IF NOT EXISTS idx_community_resource_files_resource
    ON public.community_resource_files (resource_id);

-- Every policy above calls is_community_member()/is_community_admin(), both
-- SECURITY DEFINER (2026-08-20_communities.sql /
-- 2026-08-30_community_admin_membership.sql) — the failure this repo has
-- hit twice: a SECURITY DEFINER function used inside a policy still needs
-- the CALLING role to hold EXECUTE on the function itself, or the policy
-- errors before it ever evaluates the function's own logic. Both functions
-- already carry a `GRANT EXECUTE ... TO authenticated` from their own
-- migrations, and every policy here is scoped `TO authenticated` only (no
-- anon path at all — see the header above on why this is member-gated, not
-- public-preview-gated), so no new grant is required by this migration.
-- Re-asserted defensively anyway, once, since GRANT is idempotent and this
-- is exactly the class of bug that has bitten this repo before:
GRANT EXECUTE ON FUNCTION public.is_community_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_community_admin(UUID, UUID) TO authenticated;
