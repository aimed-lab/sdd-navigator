-- 2026-10-31  Project access audit: a non-member reads nothing of a project
--
-- ColaboFest projects are invite-only. This was checked table by table (see the
-- list below); the three things that needed a fix are in this file (a fourth,
-- claiming an invitation, was dropped: see below).
-- Idempotent: safe to re-run. NOT RUN as part of writing it.
--
-- CHECKED AND CORRECT (a non-member gets zero rows; every policy is
-- is_project_member() or is_project_lead() / is_project_staff())
--   projects                  "Projects: member or community select"
--                             (2026-08-30_community_admin_membership.sql). NOTE: this
--                             policy ALSO shows the projects row to any member of the
--                             project's community (the community page lists its
--                             projects). So "can read the projects row" is NOT
--                             membership; the app decides access from a
--                             project_members row (page.tsx, getProject). The other
--                             tables below are member-only.
--   project_members           "Project members: member select"
--   checklist_items           "Checklist items: member select"
--   project_proposals         "Project proposals: member select"
--   project_updates           member select (2026-10-27_project_updates.sql)
--   project_digests           member select
--   wiki_notes                member select
--   project evidence items    member select
--   project_threads / _replies  member select (2026-10-31_project_announcements_discussions.sql)
--   project_welcome_dismissals  own row, and only while a member
--   storage 'project-proposals' member select / insert / delete (first path
--                             segment = project id)
--   Files tab                 is projects.shared_folder_url, so it is part of the
--                             projects row and is readable by community members
--                             too (see the note on projects above; NOT fixed here)
--   project_member_names()    returns names only for projects the caller belongs to
--   find_account_id_by_email_for_project()  returns NULL unless the caller leads it
--   saved_items (project refs) the person's own rows only
--
-- NEEDED A FIX
--   1. WIKI PAGES. A project wiki page is a public.pages row with project_id set.
--      can_read_page() let anyone read a page whose visibility is 'public', its
--      owner, a page_members row, or a team the page is curated into, whatever
--      project_id said, and the notes / evidence / updates of the page follow
--      can_read_page(). If a project page was ever set to public (or put in a
--      team), a non-member could read it through the API. Fixed: a page with a
--      project_id is readable ONLY by members of that project. (can_edit_page is
--      unchanged; it already needs membership for a project page unless the
--      caller owns the page; an ex-member who owns a page can no longer read it
--      either, which is the point.) Every other page is exactly as before: this
--      is the same body as 2026-10-28_teams.sql wrapped in a project guard.
--   2. MEMBERSHIP HELPERS WERE CALLABLE BY ANON. is_project_member() and
--      friends were created with the default grant (everyone, signed out
--      included), so a signed-out caller could ask "is user X in project Y".
--      They are now for signed-in users only. The policies that call them are
--      evaluated for signed-in roles; a signed-out request now gets "permission
--      denied" or nothing, never data.
--   3. NO ANON GRANTS ON PROJECT TABLES. Row-level security already hides the
--      rows; this removes the table privilege too (defence in depth), and makes
--      sure RLS is on for each table that exists.
--   (Part 4, claim_pending_project_memberships, was DROPPED from this file. The
--    live database already has the verified-email rule: public.verified_auth_email
--    from 2026-10-29_team_join_link_invites.sql (on dev), which is what lets an SSO
--    sign-in claim an invited address. Redefining the function here would replace
--    that rule with a second copy that could drift from it. Nothing else in this
--    file depends on it.)

-- 1. wiki pages -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_read_page(p_page_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.pages p
        WHERE p.id = p_page_id
          AND CASE
              -- a project's page: members of the project only
              WHEN p.project_id IS NOT NULL THEN public.is_project_member(p.project_id, p_uid)
              ELSE (
                  p.visibility = 'public'
                  OR p.owner_id = p_uid
                  OR (
                      p.visibility = 'team'
                      AND EXISTS (
                          SELECT 1 FROM public.page_members pm
                          WHERE pm.page_id = p.id AND pm.user_id = p_uid
                      )
                  )
                  OR (
                      p.visibility <> 'private'
                      AND EXISTS (
                          SELECT 1 FROM public.team_pages tp
                          WHERE tp.page_id = p.id
                            AND public.is_community_member(tp.team_id, p_uid)
                      )
                  )
              )
          END
    );
$$;

REVOKE ALL ON FUNCTION public.can_read_page(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_page(UUID, UUID) TO anon, authenticated;

-- 2. membership helpers: signed-in only ------------------------------------------

REVOKE ALL ON FUNCTION public.is_project_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_member(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_project_member(UUID, UUID) TO authenticated;

-- (is_project_lead, is_project_creator, is_project_manager and is_project_staff
--  already revoke anon; restated so this file stands on its own.)
REVOKE ALL ON FUNCTION public.is_project_lead(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_lead(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_project_lead(UUID, UUID) TO authenticated;

-- 3. no anon privileges, RLS on --------------------------------------------------

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'projects', 'project_members', 'checklist_items', 'project_proposals',
        'project_updates', 'project_digests', 'wiki_notes', 'project_evidence_items',
        'project_threads', 'project_thread_replies', 'project_welcome_dismissals'
    ] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
            EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
        END IF;
    END LOOP;
END
$$;
