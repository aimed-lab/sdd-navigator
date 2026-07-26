-- =============================================================================
-- Migration: collab_post_owners  (2026-07-26)
-- =============================================================================
-- Fixes owner attribution on the Collaborate board.
--
-- THE PROBLEM
-- public.users RLS is `SELECT USING (is_public = true)`, so the board's owner
-- join returns NULL for any poster who has not made their full profile public,
-- and their card renders as an anonymous "Community member". That is wrong for
-- an attributed board.
--
-- THE RULE THIS ENCODES
-- Posting to a public board is an implicit choice to be identified BY NAME. It
-- is NOT a choice to publish your whole profile. So:
--   * name / affiliation / institution  -> always visible for a post owner
--   * profile_slug                      -> only when the profile IS public
--   * everything else on public.users   -> never exposed here (no email, bio,
--     interests, country, notification prefs, …)
--
-- profile_slug is nulled for non-public owners deliberately: it is the "View
-- profile" link target, and /researchers/<slug> is itself gated on is_public, so
-- returning it would produce a link into a page RLS refuses to serve. Callers
-- already treat a null slug as "no public profile".
--
-- Same shape as collab_post_interest_counts() in the collab_posts migration: a
-- narrow SECURITY DEFINER read that exposes exactly one thing and nothing else,
-- rather than weakening the RLS policy on public.users.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.collab_post_owners()
RETURNS TABLE (
    id           UUID,
    name         TEXT,
    affiliation  TEXT,
    institution  TEXT,
    profile_slug TEXT
)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT
        u.id,
        u.name,
        u.affiliation,
        u.institution,
        -- Only a PUBLIC profile gets a linkable slug; a private one is
        -- identified by name only.
        CASE WHEN u.is_public THEN u.profile_slug ELSE NULL END AS profile_slug
    FROM public.users u
    WHERE EXISTS (
        SELECT 1 FROM public.collab_posts p WHERE p.owner_id = u.id
    );
$$;

-- Only these five columns, only for users who have actually posted.
REVOKE ALL ON FUNCTION public.collab_post_owners() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collab_post_owners() TO anon, authenticated;
