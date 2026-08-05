-- =============================================================================
-- Migration: project_member_names  (2026-08-07)
-- =============================================================================
-- Fixes team-member attribution on the project detail page, the same problem
-- collab_post_owners() (2026-07-26_collab_post_owners.sql) and
-- showcase_owners() (2026-07-26_promote_showcase.sql) already solved for the
-- Collaborate board and the Promote showcase: public.users' own SELECT
-- policy is `is_public = true`, so a plain join from project_members onto
-- public.users returns NULL for any member whose profile isn't public, and
-- their row would render blank instead of falling back to their email.
--
-- SAME SHAPE AS collab_post_owners(): name is returned UNCONDITIONALLY (the
-- same "you're identified by name to the people you're already visible to"
-- rule), and profile_slug is nulled unless the profile is public — because
-- /researchers/<slug> is itself gated on is_public, and returning a slug
-- that page will refuse to serve is worse than not linking at all. Same
-- comment, same reasoning, copied on purpose rather than reworded.
--
-- ONE DIFFERENCE FROM collab_post_owners(), and it matters: collab_posts are
-- public content, so "anyone who can see the post can see its owner's name"
-- is already the rule the board runs on — collab_post_owners() takes no
-- membership parameter because there's no membership to check. A project's
-- team is NOT public. Blindly trusting a caller-supplied project_ids array
-- would let any authenticated user pass an arbitrary project id and read
-- the names of its members, whether or not they belong to it — that's a
-- real information leak this function must not introduce just because it's
-- SECURITY DEFINER (which bypasses RLS entirely, on purpose, for the
-- columns it touches). So this function ALSO requires the CALLER to be a
-- member of a project before it returns anything for that project's
-- members, via the existing is_project_member() — itself SECURITY DEFINER,
-- and safe to call from inside another one.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.project_member_names(project_ids UUID[])
RETURNS TABLE (
    user_id      UUID,
    name         TEXT,
    profile_slug TEXT
)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT DISTINCT
        u.id AS user_id,
        u.name,
        -- Only a PUBLIC profile gets a linkable slug; a private one is
        -- identified by name only — identical to collab_post_owners().
        CASE WHEN u.is_public THEN u.profile_slug ELSE NULL END AS profile_slug
    FROM public.users u
    JOIN public.project_members pm ON pm.user_id = u.id
    WHERE pm.project_id = ANY(project_ids)
      -- The caller must themselves be a member of THIS row's project — not
      -- merely a member of something. Checked per-row (not once against the
      -- whole array) so a project_ids array mixing a project the caller is
      -- in with one they aren't returns names for the former only.
      AND public.is_project_member(pm.project_id, auth.uid());
$$;

-- Only these three columns, only for members of projects the CALLER also
-- belongs to. No anon grant — signed out, auth.uid() is null,
-- is_project_member() is false for everything, and this returns nothing
-- anyway, but the grant is restricted to authenticated to say so plainly.
REVOKE ALL ON FUNCTION public.project_member_names(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_member_names(UUID[]) TO authenticated;
