-- 2026-10-31  Learning pages are curated by team leads
--
-- A team's wiki pages (public.team_pages) used to be addable by any member and
-- removable by whoever added them or a lead. Now only a team LEAD (a community
-- admin of the team) adds or removes them; members only read. The app already
-- refuses it (lib/server/teams/teams.ts); this makes the database say the same, so
-- a hand-made API call cannot get around the app.
--
-- Needs 2026-10-28_teams.sql (team_pages, can_curate_page) and
-- 2026-08-30_community_admin_membership.sql (is_community_admin).
-- Idempotent. NOT RUN as part of writing it.
--
-- Unchanged: the SELECT policy (every active member reads), the
-- team_pages_share_private trigger (an owner's private page becomes 'team' when
-- THEY add it, which is now a lead adding their own page), can_curate_page().

DROP POLICY IF EXISTS "Team pages: member insert" ON public.team_pages;
DROP POLICY IF EXISTS "Team pages: lead insert" ON public.team_pages;
CREATE POLICY "Team pages: lead insert"
    ON public.team_pages FOR INSERT
    TO authenticated
    WITH CHECK (
        added_by = auth.uid()
        AND public.is_community_admin(team_id, auth.uid())
        AND public.can_curate_page(page_id, auth.uid())
    );

DROP POLICY IF EXISTS "Team pages: adder or admin delete" ON public.team_pages;
DROP POLICY IF EXISTS "Team pages: lead delete" ON public.team_pages;
CREATE POLICY "Team pages: lead delete"
    ON public.team_pages FOR DELETE
    TO authenticated
    USING (public.is_community_admin(team_id, auth.uid()));
