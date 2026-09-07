-- Batched active-member counts for every community, for list contexts
-- (Explore's new Communities category, /communities) that render many
-- community cards at once and need each card's member count without an
-- N+1 RPC call per card.
--
-- community_member_stats(p_community_id) (2026-08-21_community_join.sql)
-- already computes this same count, but only for ONE community at a time —
-- exactly right for a single community's own page, wrong for a grid of
-- many. This is that same logic (COUNT(*) FILTER (WHERE status = 'active'))
-- grouped across every community in one query instead of parameterized to
-- one, so a card grid does ONE query total, not one per card.
--
-- SECURITY DEFINER, same as community_member_stats: community_members'
-- SELECT policy is narrowed to "your own row, or a lead of that community"
-- (2026-08-21), so a plain anon/authenticated join here would return
-- nothing for almost every row. This function returns COUNTS ONLY, never a
-- community_members row, same "aggregate, not raw rows" posture as
-- community_member_stats and collab_post_interest_counts().
--
-- Idempotent — safe to re-run. NOT run against any database as part of
-- writing this file.

CREATE OR REPLACE FUNCTION public.community_member_counts()
    RETURNS TABLE (community_id UUID, member_count BIGINT)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT cm.community_id, COUNT(*) FILTER (WHERE cm.status = 'active')
    FROM public.community_members cm
    GROUP BY cm.community_id;
$$;

-- THE ANON-GRANT BUG, AGAIN (see 2026-08-21_community_join.sql's own note on
-- this): every CREATE FUNCTION grants EXECUTE to PUBLIC by default, which
-- includes anon. Explicitly revoke first, then grant only to the roles that
-- should call it — communities and their member counts are public data
-- (same posture as community_member_stats and listCommunities()'s own
-- anon-readable SELECT), so anon is a deliberate grant here, not an
-- oversight to close later.
REVOKE ALL ON FUNCTION public.community_member_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_member_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.community_member_counts() TO anon, authenticated;
