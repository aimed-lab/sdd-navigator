-- =============================================================================
-- Migration: promote_showcase — community_id (2026-09-13)
-- =============================================================================
-- Lets a showcase article belong to a community — a tool posted by a
-- ColaboFest member can appear in ColaboFest's own Showcase section
-- (frontend/components/communities/ — see app/communities/[slug]/page.tsx's
-- "showcase" section case), not just live at its own /promote/[slug] link.
--
-- NULL (the default) means "belongs to no community" — every existing row
-- backfills to that, unchanged from how it behaves today.
--
-- ON DELETE SET NULL, not CASCADE: deleting a community should not delete
-- someone's article, just detach it — the article is the author's content,
-- the community tag is metadata about where else it shows up.
--
-- DELIBERATELY NOT CLEARED WHEN THE AUTHOR LEAVES THE COMMUNITY. An article
-- stays attached after the author's membership ends, the same way a forum
-- post stays in the archive after the poster leaves — the content (a real
-- tool or paper someone in that community once shared) is still useful to
-- the community regardless of the author's current membership status. This
-- is a deliberate choice, not an oversight: nothing in this migration (or
-- anywhere else) hooks the "leave community" path to touch this column.
--
-- RLS: a published article stays PUBLICLY readable whether or not it has a
-- community — promote_showcase_select_published (published = true) is
-- untouched by this migration, and adding a community_id never grants that
-- community's members any read access an unpublished draft didn't already
-- have. The ONLY RLS change here is on WRITE: the INSERT/UPDATE WITH CHECK
-- clauses are tightened so a row can only be tagged with a community_id the
-- writer may actually post to (can_post_to_community — the same helper
-- collab_posts/lab_resources already use for exactly this "may this user
-- tag their own content with this community" question, defined in
-- 2026-08-20_communities.sql, which also covers ColaboFest's
-- projects-backed membership form, not just a plain community_members row).
-- Before this, nothing stopped a forged community_id on your OWN row (the
-- existing policies only ever checked owner_id) — this closes that gap
-- rather than leaving it to the editor's dropdown (a UI convenience, not
-- enforcement) to be the only thing stopping it.
--
-- Idempotent — safe to re-run.
-- =============================================================================

ALTER TABLE public.promote_showcase
    ADD COLUMN IF NOT EXISTS community_id UUID REFERENCES public.communities (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_promote_showcase_community
    ON public.promote_showcase (community_id);

-- ── Writes: keep owner_id check, add the community_id check ─────────────────
--
-- Both policies already existed with an owner_id-only WITH CHECK — re-created
-- here with the added community_id clause, everything else identical.

DROP POLICY IF EXISTS "promote_showcase_insert_own" ON public.promote_showcase;
CREATE POLICY "promote_showcase_insert_own"
    ON public.promote_showcase FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = owner_id
        AND (community_id IS NULL OR public.can_post_to_community(community_id, auth.uid()))
    );

DROP POLICY IF EXISTS "promote_showcase_update_own" ON public.promote_showcase;
CREATE POLICY "promote_showcase_update_own"
    ON public.promote_showcase FOR UPDATE
    TO authenticated
    USING (auth.uid() = owner_id)
    WITH CHECK (
        auth.uid() = owner_id
        AND (community_id IS NULL OR public.can_post_to_community(community_id, auth.uid()))
    );

-- promote_showcase_select_published / _select_own / _delete_own are
-- untouched — this migration only ever changes what community_id a write
-- may set, never who can read a row.
