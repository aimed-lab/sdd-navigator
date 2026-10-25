-- =============================================================================
-- Migration: teams  (2026-10-28)
-- =============================================================================
-- WHY: Prof. Chen (Oct 23) asked to separate TEAMS from COMMUNITIES.
--   * A TEAM is a small private group, made bottom-up by anyone in seconds. It
--     is not a project. It holds team-only material and can belong to zero or
--     many communities.
--   * A COMMUNITY is public, top-down and long-lived. Only site admins create
--     them. A community contains many teams.
-- Teams REUSE the community tables (communities, community_members,
-- community_resources, community_resource_files, community_announcements, the
-- pinned resource, the QR / email join). A team is a communities row with
-- kind = 'team'. Projects are not touched.
--
-- Needs: 2026-08-20 .. 2026-10-24 (communities, community_members, resources,
-- pinned resource, public_preview, pages, public.is_site_admin()).
-- Run once in the Supabase SQL editor. Idempotent. NOT run against any database
-- as part of writing this file. The storage policies are in a separate file,
-- 2026-10-28_teams_storage.sql (run second; see CLAUDE.md on why).
--
-- ── HOW COMMUNITIES WERE CREATED BEFORE THIS FILE ───────────────────────────
-- communities has no INSERT policy. The only way in from the app was the
-- SECURITY DEFINER function create_community_with_admin(p_name, p_description)
-- (2026-08-30), which let ANY signed-in user create a community (always
-- private, is_open false) and made them its admin. The "Start a community"
-- button and the assistant's create_community tool both called it. Only the
-- UI decided who saw the button.
--
-- ── WHAT THIS FILE CHANGES ABOUT CREATION ───────────────────────────────────
-- 1. create_community_with_admin gets a third argument p_kind ('community' by
--    default, or 'team'). kind 'community' raises an error unless
--    public.is_site_admin(); kind 'team' needs only a signed-in user. The old
--    two-argument function is dropped so it cannot be called around the check.
-- 2. A BEFORE INSERT trigger on communities repeats the rule in the table
--    itself: when a signed-in session inserts a kind = 'community' row and is
--    not a site admin, the insert is refused. (Callers with no auth.uid(), such
--    as the SQL editor and the service role used by seed scripts, are not
--    blocked, as before.) So the rule holds even if some other code path
--    inserts into communities.
-- 3. Existing rows all become kind = 'community'. Nothing existing is removed.
--
-- ── TEAM ROWS ARE NOT PUBLIC (security fix from review) ─────────────────────
-- "Communities: public select" was USING (true), so anyone could list every
-- team's slug through the API and join it. It is replaced by two policies:
--   * kind = 'community' rows stay public (anon and signed in), as before;
--   * kind = 'team' rows are readable only by that team's active members and by
--     site admins.
-- A visitor with a team link gets the name, description and size from
-- get_team_join_info(slug), which returns nothing for an unknown slug or a
-- community. Joining goes through join_team(slug) (signed in) or the existing
-- email join (signed out), both SECURITY DEFINER; the self-insert policy on
-- community_members can no longer be used on a team, so a team id alone (for
-- example one stored on a public Promote item) lets nobody in. Everything that
-- read `communities` as the caller was checked; the list is in the report and
-- each place is marked "TEAM PRIVACY" below.
--
-- ── WHY TEAMS ARE JOINABLE BY LINK BUT PRIVATE INSIDE ───────────────────────
-- Joining: the link (/teams/<slug>) is the secret. join_team(slug) and the
-- signed-out email join (join_team_by_email, service role, SECURITY DEFINER; takes
-- the slug, never an id) make a person an active member in one step.
-- Name and description are shown to a visitor only through
-- get_team_join_info.
-- Content: public_preview is the community switch that lets non-members see a
-- feed preview ('standard') or the roster and pinned resource ('open'). For a
-- team it is forced to 'minimal', which shows nothing beyond name and
-- description. Done twice: a trigger sets it (and is_open) on every write, and a
-- CHECK constraint makes any other combination impossible. Resources, files,
-- announcements and the roster were already members-only (their policies call
-- is_community_member), so for a team they stay members-only.
-- Because is_open = true also makes can_post_to_community() true for any signed
-- in user, can_post_to_community is rewritten below so "open" only counts for
-- kind = 'community'. Without that, a stranger could tag a post or Promote item
-- to someone's team.
-- Team slugs always get a random suffix, so a team link cannot be guessed from
-- the team name.
--
-- ── WHAT IS NEW ─────────────────────────────────────────────────────────────
--   communities.kind                'community' | 'team', fixed after creation.
--   community_teams                 links a team to a community.
--   team_pages                      wiki pages curated into a team.
--   can_read_page()                 one extra clause: a non-private page curated into a team
--                                   is readable by that team's active members.
--   community_resources / _files    in a team, ANY active member may add; the
--                                   uploader or a team admin may edit/remove.
--   community_linked_teams()        name + size of the teams linked to a
--                                   community, for community members only.
-- A team's admin is community_members.role = 'admin'; the app calls it "Lead".
-- =============================================================================

-- ── communities.kind ─────────────────────────────────────────────────────────
ALTER TABLE public.communities
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'community';

ALTER TABLE public.communities DROP CONSTRAINT IF EXISTS communities_kind_check;
ALTER TABLE public.communities
    ADD CONSTRAINT communities_kind_check CHECK (kind IN ('community', 'team'));

-- A team is always open to join and never shows content to outsiders.
ALTER TABLE public.communities DROP CONSTRAINT IF EXISTS communities_team_private_check;
ALTER TABLE public.communities
    ADD CONSTRAINT communities_team_private_check
        CHECK (kind <> 'team' OR (is_open = true AND public_preview = 'minimal'));

CREATE INDEX IF NOT EXISTS idx_communities_kind ON public.communities (kind);

-- ── trigger: kind is fixed, teams get their defaults, community creation ────
CREATE OR REPLACE FUNCTION public.communities_kind_rules()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.kind IS DISTINCT FROM OLD.kind THEN
        RAISE EXCEPTION 'A team cannot be turned into a community, or the other way round.';
    END IF;

    IF NEW.kind = 'team' THEN
        NEW.is_open := true;
        NEW.public_preview := 'minimal';
    END IF;

    -- Only site admins create communities. A call with no signed-in user
    -- (SQL editor, service role) is not a person acting through the app.
    IF TG_OP = 'INSERT'
       AND NEW.kind = 'community'
       AND auth.uid() IS NOT NULL
       AND NOT public.is_site_admin()
    THEN
        RAISE EXCEPTION 'Only site admins can create a community. You can create a team instead.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_communities_kind_rules ON public.communities;
CREATE TRIGGER trg_communities_kind_rules
    BEFORE INSERT OR UPDATE ON public.communities
    FOR EACH ROW
    EXECUTE FUNCTION public.communities_kind_rules();

REVOKE ALL ON FUNCTION public.communities_kind_rules() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.communities_kind_rules() FROM anon;

-- ── helper: is this id a team? ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_team(p_community_id UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.communities c
        WHERE c.id = p_community_id AND c.kind = 'team'
    );
$$;

REVOKE ALL ON FUNCTION public.is_team(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_team(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_team(UUID) TO authenticated;

-- ── create function: community = site admins only, team = any signed-in user ─
DROP FUNCTION IF EXISTS public.create_community_with_admin(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_community_with_admin(
    p_name        TEXT,
    p_description TEXT DEFAULT NULL,
    p_kind        TEXT DEFAULT 'community'
)
    RETURNS TABLE (id UUID, slug TEXT)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_uid          UUID := auth.uid();
    v_email        TEXT;
    v_base_slug    TEXT;
    v_slug         TEXT;
    v_community_id UUID;
    v_kind         TEXT := COALESCE(NULLIF(btrim(p_kind), ''), 'community');
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'create_community_with_admin: no authenticated user';
    END IF;

    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'create_community_with_admin: name is required';
    END IF;

    IF v_kind NOT IN ('community', 'team') THEN
        RAISE EXCEPTION 'create_community_with_admin: kind must be community or team';
    END IF;

    IF v_kind = 'community' AND NOT public.is_site_admin() THEN
        RAISE EXCEPTION 'create_community_with_admin: only site admins can create a community';
    END IF;

    SELECT u.email INTO v_email FROM public.users u WHERE u.id = v_uid;

    v_base_slug := trim(both '-' from lower(regexp_replace(btrim(p_name), '[^a-zA-Z0-9]+', '-', 'g')));
    IF v_base_slug = '' THEN
        v_base_slug := v_kind;
    END IF;

    IF v_kind = 'team' THEN
        -- Always suffixed, so a team link cannot be guessed from its name.
        v_slug := v_base_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    ELSE
        v_slug := v_base_slug;
    END IF;
    WHILE EXISTS (SELECT 1 FROM public.communities c WHERE c.slug = v_slug) LOOP
        v_slug := v_base_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    END LOOP;

    INSERT INTO public.communities (slug, name, description, is_open, kind)
    VALUES (
        v_slug,
        btrim(p_name),
        NULLIF(btrim(COALESCE(p_description, '')), ''),
        v_kind = 'team',
        v_kind
    )
    RETURNING communities.id INTO v_community_id;

    INSERT INTO public.community_members (
        community_id, user_id, email, role, status, approved_at, approved_by
    )
    VALUES (v_community_id, v_uid, COALESCE(v_email, ''), 'admin', 'active', now(), v_uid);

    RETURN QUERY SELECT v_community_id, v_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.create_community_with_admin(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_community_with_admin(TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_community_with_admin(TEXT, TEXT, TEXT) TO authenticated;

-- =============================================================================
-- TEAM PRIVACY: who can read a team row, and how a non-member joins
-- =============================================================================

-- 1. Read policies. Two separate policies (permissive ones are OR-ed) so the anon
--    role never has to evaluate a function it cannot execute.
DROP POLICY IF EXISTS "Communities: public select" ON public.communities;
DROP POLICY IF EXISTS "Communities: communities are public" ON public.communities;
CREATE POLICY "Communities: communities are public"
    ON public.communities FOR SELECT
    TO anon, authenticated
    USING (kind = 'community');

DROP POLICY IF EXISTS "Communities: team members and site admins read teams" ON public.communities;
CREATE POLICY "Communities: team members and site admins read teams"
    ON public.communities FOR SELECT
    TO authenticated
    USING (
        kind = 'team'
        AND (public.is_community_member(id, auth.uid()) OR public.is_site_admin())
    );

-- 2. What a visitor with a team link may see: id, name, description, size. Nothing
--    for an unknown slug or for a community.
CREATE OR REPLACE FUNCTION public.get_team_join_info(p_slug TEXT)
    RETURNS TABLE (id UUID, name TEXT, description TEXT, member_count BIGINT)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT c.id, c.name, c.description,
           (SELECT COUNT(*) FROM public.community_members m
             WHERE m.community_id = c.id AND m.status = 'active')
    FROM public.communities c
    WHERE c.slug = p_slug AND c.kind = 'team'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_team_join_info(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_join_info(TEXT) TO anon, authenticated;

-- 3. Signed-in join by slug. Links a row an admin added by email, then adds the
--    caller as an active member. Returns 'joined', 'already_member', 'not_found',
--    'sign_in' or 'failed'.
CREATE OR REPLACE FUNCTION public.join_team(p_slug TEXT)
    RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_uid       UUID := auth.uid();
    v_team      UUID;
    v_email     TEXT;
    v_confirmed TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RETURN 'sign_in';
    END IF;

    SELECT c.id INTO v_team FROM public.communities c WHERE c.slug = p_slug AND c.kind = 'team';
    IF v_team IS NULL THEN
        RETURN 'not_found';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.community_members m
        WHERE m.community_id = v_team AND m.user_id = v_uid AND m.status = 'active'
    ) THEN
        RETURN 'already_member';
    END IF;

    SELECT u.email INTO v_confirmed FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
    IF v_confirmed IS NOT NULL THEN
        UPDATE public.community_members m
        SET user_id = v_uid
        WHERE m.community_id = v_team AND m.user_id IS NULL AND lower(m.email) = lower(v_confirmed);
    END IF;

    SELECT pu.email INTO v_email FROM public.users pu WHERE pu.id = v_uid;

    INSERT INTO public.community_members (community_id, user_id, email, role, status)
    VALUES (v_team, v_uid, COALESCE(v_email, ''), 'member', 'active')
    ON CONFLICT DO NOTHING;

    IF EXISTS (
        SELECT 1 FROM public.community_members m
        WHERE m.community_id = v_team AND m.user_id = v_uid AND m.status = 'active'
    ) THEN
        RETURN 'joined';
    END IF;
    RETURN 'failed';
END;
$$;

REVOKE ALL ON FUNCTION public.join_team(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_team(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.join_team(TEXT) TO authenticated;

-- 3b. Email join (signed out). Two separate functions, both service_role only (the
--     server applies the per-IP limit first):
--       * join_open_community_by_email(uuid, text): the community path, kept as it
--         was (same signature and body) EXCEPT that it refuses a team. A team id
--         sent here, from anywhere, answers 'not_found' and writes nothing.
--       * join_team_by_email(slug, text): the team path. It resolves the slug to
--         the id INSIDE the function and only for kind = 'team'; no id is ever
--         accepted from outside.
CREATE OR REPLACE FUNCTION public.join_open_community_by_email(p_community_id UUID, p_email TEXT)
    RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_email TEXT := lower(btrim(COALESCE(p_email, '')));
    v_open  BOOLEAN;
    v_kind  TEXT;
    v_rows  INTEGER;
BEGIN
    IF length(v_email) > 254
       OR v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
    THEN
        RETURN 'invalid_email';
    END IF;

    SELECT c.is_open, c.kind INTO v_open, v_kind FROM public.communities c WHERE c.id = p_community_id;
    IF NOT FOUND THEN
        RETURN 'not_found';
    END IF;
    -- A team is joined by slug through join_team_by_email, never by id.
    IF v_kind = 'team' THEN
        RETURN 'not_found';
    END IF;
    IF v_open IS NOT TRUE THEN
        RETURN 'not_open';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.community_members cm
        JOIN public.users u ON u.id = cm.user_id
        WHERE cm.community_id = p_community_id
          AND lower(u.email) = v_email
    ) THEN
        RETURN 'already_member';
    END IF;

    INSERT INTO public.community_members (community_id, user_id, email, role, status, email_verified)
    VALUES (p_community_id, NULL, v_email, 'member', 'active', false)
    ON CONFLICT (community_id, lower(email)) WHERE email IS NOT NULL
    DO NOTHING;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN 'already_member';
    END IF;

    RETURN 'joined';
END;
$$;

REVOKE ALL ON FUNCTION public.join_open_community_by_email(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_open_community_by_email(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.join_open_community_by_email(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.join_open_community_by_email(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.join_team_by_email(p_slug TEXT, p_email TEXT)
    RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_email TEXT := lower(btrim(COALESCE(p_email, '')));
    v_team  UUID;
    v_rows  INTEGER;
BEGIN
    IF length(v_email) > 254
       OR v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
    THEN
        RETURN 'invalid_email';
    END IF;

    SELECT c.id INTO v_team FROM public.communities c WHERE c.slug = p_slug AND c.kind = 'team';
    IF v_team IS NULL THEN
        RETURN 'not_found';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.community_members cm
        JOIN public.users u ON u.id = cm.user_id
        WHERE cm.community_id = v_team
          AND lower(u.email) = v_email
    ) THEN
        RETURN 'already_member';
    END IF;

    INSERT INTO public.community_members (community_id, user_id, email, role, status, email_verified)
    VALUES (v_team, NULL, v_email, 'member', 'active', false)
    ON CONFLICT (community_id, lower(email)) WHERE email IS NOT NULL
    DO NOTHING;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN 'already_member';
    END IF;

    RETURN 'joined';
END;
$$;

REVOKE ALL ON FUNCTION public.join_team_by_email(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_team_by_email(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.join_team_by_email(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.join_team_by_email(TEXT, TEXT) TO service_role;

-- 4. community_members self-insert: communities only. The old policy read
--    `communities` as the caller (c.is_open), which a non-member can no longer
--    see for a team, and a team must not be joinable by id alone. The two
--    helpers read the table as its owner and say yes only for a community.
CREATE OR REPLACE FUNCTION public.is_open_community(p_id UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM public.communities c WHERE c.id = p_id AND c.kind = 'community' AND c.is_open);
$$;

CREATE OR REPLACE FUNCTION public.is_closed_community(p_id UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM public.communities c WHERE c.id = p_id AND c.kind = 'community' AND NOT c.is_open);
$$;

REVOKE ALL ON FUNCTION public.is_open_community(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_open_community(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_open_community(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.is_closed_community(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_closed_community(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_closed_community(UUID) TO authenticated;

DROP POLICY IF EXISTS "Community members: self insert" ON public.community_members;
CREATE POLICY "Community members: self insert"
    ON public.community_members FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND role = 'member'
        AND approved_by IS NULL
        AND approved_at IS NULL
        AND (
            (status = 'active' AND public.is_open_community(community_id))
            OR
            (status = 'pending' AND public.is_closed_community(community_id))
        )
    );

-- 5. Member counts: a team's count (and id) is not public. Communities as before;
--    a team only for its own members and site admins.
CREATE OR REPLACE FUNCTION public.community_member_counts()
    RETURNS TABLE (community_id UUID, member_count BIGINT)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT cm.community_id, COUNT(*) FILTER (WHERE cm.status = 'active')
    FROM public.community_members cm
    JOIN public.communities c ON c.id = cm.community_id
    WHERE c.kind = 'community'
       OR public.is_community_member(c.id, auth.uid())
       OR public.is_site_admin()
    GROUP BY cm.community_id;
$$;

REVOKE ALL ON FUNCTION public.community_member_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_member_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.community_member_counts() TO anon, authenticated;

-- 6. Names for public pages (Promote items). Anyone gets the NAME; the slug (the
--    way into a team) only for a community, or for a team's own members and site
--    admins. The Promote code reads this instead of embedding `communities`.
CREATE OR REPLACE FUNCTION public.community_labels(p_ids UUID[])
    RETURNS TABLE (id UUID, name TEXT, slug TEXT, kind TEXT)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT c.id, c.name,
           CASE WHEN c.kind = 'community'
                  OR public.is_community_member(c.id, auth.uid())
                  OR public.is_site_admin()
                THEN c.slug END,
           c.kind
    FROM public.communities c
    WHERE c.id = ANY(p_ids);
$$;

REVOKE ALL ON FUNCTION public.community_labels(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_labels(UUID[]) TO anon, authenticated;

-- ── "open" no longer lets a stranger post into a team ───────────────────────
-- Same function as 2026-08-20, with one change: the "or the community is open"
-- branch only applies to communities, not teams. Posts, resources and Promote
-- items tagged to a team therefore need a real membership.
CREATE OR REPLACE FUNCTION public.can_post_to_community(p_community_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.communities c
        WHERE c.id = p_community_id
          AND (
              (c.is_open AND c.kind = 'community')
              OR public.is_community_member(p_community_id, p_uid)
          )
    );
$$;

REVOKE ALL ON FUNCTION public.can_post_to_community(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_post_to_community(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_post_to_community(UUID, UUID) TO authenticated;

-- =============================================================================
-- RESOURCES: in a team, any active member may add; uploader or admin removes
-- =============================================================================
-- Communities keep the old rule (admin only). The new branch applies only when
-- is_team(community_id). added_by is pinned to the caller, so a member cannot
-- add something in someone else's name.

DROP POLICY IF EXISTS "Community resources: admin insert" ON public.community_resources;
DROP POLICY IF EXISTS "Community resources: admin or team member insert" ON public.community_resources;
CREATE POLICY "Community resources: admin or team member insert"
    ON public.community_resources FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = added_by
        AND (
            public.is_community_admin(community_id, auth.uid())
            OR (public.is_team(community_id) AND public.is_community_member(community_id, auth.uid()))
        )
    );

DROP POLICY IF EXISTS "Community resources: admin update" ON public.community_resources;
DROP POLICY IF EXISTS "Community resources: admin or team uploader update" ON public.community_resources;
CREATE POLICY "Community resources: admin or team uploader update"
    ON public.community_resources FOR UPDATE
    TO authenticated
    USING (
        public.is_community_admin(community_id, auth.uid())
        OR (public.is_team(community_id) AND added_by = auth.uid())
    )
    WITH CHECK (
        public.is_community_admin(community_id, auth.uid())
        OR (public.is_team(community_id) AND added_by = auth.uid())
    );

DROP POLICY IF EXISTS "Community resources: admin delete" ON public.community_resources;
DROP POLICY IF EXISTS "Community resources: admin or team uploader delete" ON public.community_resources;
CREATE POLICY "Community resources: admin or team uploader delete"
    ON public.community_resources FOR DELETE
    TO authenticated
    USING (
        public.is_community_admin(community_id, auth.uid())
        OR (public.is_team(community_id) AND added_by = auth.uid())
    );

-- Files attached to a resource follow the resource: in a team, a member may
-- attach a file to a resource THEY added; the uploader or an admin removes it.
DROP POLICY IF EXISTS "Community resource files: admin insert" ON public.community_resource_files;
DROP POLICY IF EXISTS "Community resource files: admin or team uploader insert" ON public.community_resource_files;
CREATE POLICY "Community resource files: admin or team uploader insert"
    ON public.community_resource_files FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = added_by
        AND EXISTS (
            SELECT 1 FROM public.community_resources r
            WHERE r.id = resource_id AND r.community_id = community_resource_files.community_id
        )
        AND (
            public.is_community_admin(community_id, auth.uid())
            OR (
                public.is_team(community_id)
                AND public.is_community_member(community_id, auth.uid())
                AND EXISTS (
                    SELECT 1 FROM public.community_resources r
                    WHERE r.id = resource_id AND r.added_by = auth.uid()
                )
            )
        )
    );

DROP POLICY IF EXISTS "Community resource files: admin delete" ON public.community_resource_files;
DROP POLICY IF EXISTS "Community resource files: admin or team uploader delete" ON public.community_resource_files;
CREATE POLICY "Community resource files: admin or team uploader delete"
    ON public.community_resource_files FOR DELETE
    TO authenticated
    USING (
        public.is_community_admin(community_id, auth.uid())
        OR (public.is_team(community_id) AND added_by = auth.uid())
    );

-- =============================================================================
-- community_teams: which communities a team is linked to
-- =============================================================================
-- community_id must be a community and team_id a team (trigger below).
-- Link: the team's admin, who must also be a member of the community.
-- Unlink: the team's admin or the community's admin.
-- Read: members of the team, and admins of the community (to see and unlink).
-- Other community members get names and sizes from community_linked_teams().

CREATE TABLE IF NOT EXISTS public.community_teams (
    community_id UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    team_id      UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    added_by     UUID        REFERENCES public.users (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, team_id),
    CONSTRAINT community_teams_different CHECK (community_id <> team_id)
);

CREATE INDEX IF NOT EXISTS idx_community_teams_team ON public.community_teams (team_id);

CREATE OR REPLACE FUNCTION public.community_teams_kinds()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.communities c WHERE c.id = NEW.team_id AND c.kind = 'team') THEN
        RAISE EXCEPTION 'The linked team must be a team.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.communities c WHERE c.id = NEW.community_id AND c.kind = 'community') THEN
        RAISE EXCEPTION 'A team can only be linked to a community.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_community_teams_kinds ON public.community_teams;
CREATE TRIGGER trg_community_teams_kinds
    BEFORE INSERT OR UPDATE ON public.community_teams
    FOR EACH ROW
    EXECUTE FUNCTION public.community_teams_kinds();

REVOKE ALL ON FUNCTION public.community_teams_kinds() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_teams_kinds() FROM anon;

ALTER TABLE public.community_teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Community teams: select" ON public.community_teams;
CREATE POLICY "Community teams: select"
    ON public.community_teams FOR SELECT
    TO authenticated
    USING (
        public.is_community_member(team_id, auth.uid())
        OR public.is_community_admin(community_id, auth.uid())
    );

DROP POLICY IF EXISTS "Community teams: team admin link" ON public.community_teams;
CREATE POLICY "Community teams: team admin link"
    ON public.community_teams FOR INSERT
    TO authenticated
    WITH CHECK (
        added_by = auth.uid()
        AND public.is_community_admin(team_id, auth.uid())
        AND public.is_community_member(community_id, auth.uid())
    );

DROP POLICY IF EXISTS "Community teams: unlink" ON public.community_teams;
CREATE POLICY "Community teams: unlink"
    ON public.community_teams FOR DELETE
    TO authenticated
    USING (
        public.is_community_admin(team_id, auth.uid())
        OR public.is_community_admin(community_id, auth.uid())
    );

REVOKE ALL ON public.community_teams FROM PUBLIC;
REVOKE ALL ON public.community_teams FROM anon;
GRANT SELECT, INSERT, DELETE ON public.community_teams TO authenticated;

-- The "Teams" section on a community page: name and size only, for members of
-- that community. No slug, so the list is not a way into a team.
CREATE OR REPLACE FUNCTION public.community_linked_teams(p_community_id UUID)
    RETURNS TABLE (team_id UUID, name TEXT, member_count BIGINT)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT t.id, t.name,
           (SELECT COUNT(*) FROM public.community_members m
             WHERE m.community_id = t.id AND m.status = 'active')
    FROM public.community_teams ct
    JOIN public.communities t ON t.id = ct.team_id
    WHERE ct.community_id = p_community_id
      AND public.is_community_member(p_community_id, auth.uid())
    ORDER BY t.name;
$$;

REVOKE ALL ON FUNCTION public.community_linked_teams(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_linked_teams(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.community_linked_teams(UUID) TO authenticated;

-- =============================================================================
-- team_pages: wiki pages curated into a team
-- =============================================================================
-- how = 'curated' (a member added an existing page) or 'made' (the assistant
-- made it for the team); the team page labels them "Curated" / "Made by AI".
-- Add: any active member of the team, for a page they can already read.
-- Remove: whoever added it, or a team admin. The page itself is never changed.

CREATE TABLE IF NOT EXISTS public.team_pages (
    team_id    UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    page_id    UUID        NOT NULL REFERENCES public.pages (id) ON DELETE CASCADE,
    added_by   UUID        REFERENCES public.users (id) ON DELETE SET NULL,
    how        TEXT        NOT NULL DEFAULT 'curated',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, page_id),
    CONSTRAINT team_pages_how_check CHECK (how IN ('curated', 'made'))
);

CREATE INDEX IF NOT EXISTS idx_team_pages_page ON public.team_pages (page_id);

CREATE OR REPLACE FUNCTION public.team_pages_kind()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.communities c WHERE c.id = NEW.team_id AND c.kind = 'team') THEN
        RAISE EXCEPTION 'Pages can only be curated into a team.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_pages_kind ON public.team_pages;
CREATE TRIGGER trg_team_pages_kind
    BEFORE INSERT OR UPDATE ON public.team_pages
    FOR EACH ROW
    EXECUTE FUNCTION public.team_pages_kind();

REVOKE ALL ON FUNCTION public.team_pages_kind() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_pages_kind() FROM anon;

ALTER TABLE public.team_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team pages: member select" ON public.team_pages;
CREATE POLICY "Team pages: member select"
    ON public.team_pages FOR SELECT
    TO authenticated
    USING (public.is_community_member(team_id, auth.uid()));

-- A page can be curated if the person can read it AND it is public or it is
-- their own (their own at any visibility). Somebody else's page is curatable
-- only when public: a team-visibility or private page of another person is never
-- re-shared, whatever route gave the person access to it.
CREATE OR REPLACE FUNCTION public.can_curate_page(p_page_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.pages p
        WHERE p.id = p_page_id
          AND public.can_read_page(p.id, p_uid)
          AND (p.visibility = 'public' OR p.owner_id = p_uid)
    );
$$;

REVOKE ALL ON FUNCTION public.can_curate_page(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_curate_page(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_curate_page(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "Team pages: member insert" ON public.team_pages;
CREATE POLICY "Team pages: member insert"
    ON public.team_pages FOR INSERT
    TO authenticated
    WITH CHECK (
        added_by = auth.uid()
        AND public.is_community_member(team_id, auth.uid())
        AND public.can_curate_page(page_id, auth.uid())
    );

-- When the OWNER adds their own private page, its visibility becomes 'team' (the
-- app tells them first: "This page will be visible to your team."). Setting the
-- page back to Private later removes the team's access, because can_read_page()
-- below only honours a team for a page that is not private.
CREATE OR REPLACE FUNCTION public.team_pages_share_private()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    IF NEW.added_by IS NOT NULL THEN
        UPDATE public.pages p
        SET visibility = 'team'
        WHERE p.id = NEW.page_id
          AND p.visibility = 'private'
          AND p.owner_id = NEW.added_by;
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.team_pages_share_private() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_pages_share_private() FROM anon;

DROP TRIGGER IF EXISTS trg_team_pages_share_private ON public.team_pages;
CREATE TRIGGER trg_team_pages_share_private
    AFTER INSERT ON public.team_pages
    FOR EACH ROW
    EXECUTE FUNCTION public.team_pages_share_private();

DROP POLICY IF EXISTS "Team pages: adder or admin delete" ON public.team_pages;
CREATE POLICY "Team pages: adder or admin delete"
    ON public.team_pages FOR DELETE
    TO authenticated
    USING (
        added_by = auth.uid()
        OR public.is_community_admin(team_id, auth.uid())
    );

REVOKE ALL ON public.team_pages FROM PUBLIC;
REVOKE ALL ON public.team_pages FROM anon;
GRANT SELECT, INSERT, DELETE ON public.team_pages TO authenticated;

-- ── can_read_page(): one extra clause ───────────────────────────────────────
-- Same body as 2026-10-26_project_wiki_pages.sql plus: a page curated into a
-- team (and not private) is readable by that team's active members. Every other rule is exactly
-- as before. can_edit_page() is NOT changed: curating a page lets the team
-- read it, not edit it. Notes, evidence and updates on the page follow
-- automatically because their policies call can_read_page().
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
          AND (
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
                  p.project_id IS NOT NULL
                  AND public.is_project_member(p.project_id, p_uid)
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
    );
$$;

REVOKE ALL ON FUNCTION public.can_read_page(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_page(UUID, UUID) TO anon, authenticated;
