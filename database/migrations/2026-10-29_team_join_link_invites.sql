-- 2026-10-29: joining a team when an email invite for you already exists.
--
-- Bug: a team already had a community_members row for someone's email with
-- user_id NULL (an email invite). join_team only linked that row when
-- auth.users.email_confirmed_at was set, which SSO users never have. The
-- fallback INSERT then hit community_members_email_key (community_id,
-- lower(email)), ON CONFLICT DO NOTHING swallowed it, and the person ended up
-- with no membership ("Couldn't join the team.").
--
-- Fix: join_team now links a matching email-only row to the caller instead of
-- inserting a second one. The backstop claim_pending_* functions use the same
-- rule.
--
-- WHEN AN EMAIL COUNTS AS VERIFIED (so an invite may be linked to a user):
--   auth.users.email_confirmed_at IS NOT NULL
--   OR the user has an auth.identities row whose provider <> 'email' (an SSO /
--      OAuth sign-in: the identity provider vouches for the address).
-- That is public.verified_auth_email(uid), below. A user who is not verified
-- is never linked to an invite; they can still join a team directly (the plain
-- INSERT), they just do not inherit a row made for an email address.
--
-- The email is read ONLY from auth.users.email. public.users is not used as a
-- source, and an empty auth email skips linking.
--
-- Idempotent: CREATE OR REPLACE only; grants are repeated. Run in the Supabase
-- SQL editor after 2026-10-28_teams.sql.

-- 0. The one definition of "verified email". Internal helper for the
--    SECURITY DEFINER functions below; nobody calls it through the API.
CREATE OR REPLACE FUNCTION public.verified_auth_email(p_uid UUID)
    RETURNS TEXT
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT NULLIF(btrim(u.email), '')
    FROM auth.users u
    WHERE u.id = p_uid
      AND (
          u.email_confirmed_at IS NOT NULL
          OR EXISTS (
              SELECT 1 FROM auth.identities i
              WHERE i.user_id = u.id AND i.provider <> 'email'
          )
      );
$$;

REVOKE ALL ON FUNCTION public.verified_auth_email(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verified_auth_email(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.verified_auth_email(UUID) FROM authenticated;

-- 1. join_team: link an invite row, else add the caller.
CREATE OR REPLACE FUNCTION public.join_team(p_slug TEXT)
    RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_uid      UUID := auth.uid();
    v_team     UUID;
    v_auth     TEXT;   -- auth.users.email, whatever its state
    v_verified TEXT;   -- the same, only when verified (see header)
    v_rows     INTEGER;
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

    SELECT NULLIF(btrim(u.email), '') INTO v_auth FROM auth.users u WHERE u.id = v_uid;
    v_verified := public.verified_auth_email(v_uid);

    -- a. They already have a row on this team that is not active: activate it.
    UPDATE public.community_members m
       SET status = 'active'
     WHERE m.community_id = v_team AND m.user_id = v_uid AND m.status <> 'active';
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- b. An email-only invite for their address: link it to them. Only for a
    --    verified email; with no verified email, linking is skipped.
    IF v_rows = 0 AND v_verified IS NOT NULL THEN
        UPDATE public.community_members m
           SET user_id = v_uid, status = 'active'
         WHERE m.community_id = v_team AND m.user_id IS NULL AND lower(m.email) = lower(v_verified);
        GET DIAGNOSTICS v_rows = ROW_COUNT;
    END IF;

    -- c. Otherwise add them.
    IF v_rows = 0 THEN
        INSERT INTO public.community_members (community_id, user_id, email, role, status)
        VALUES (v_team, v_uid, COALESCE(v_auth, ''), 'member', 'active')
        ON CONFLICT DO NOTHING;
    END IF;

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

-- 2. Backstop for communities and teams (called when the app lists them):
--    link email-only rows for the signed-in caller when their email is
--    verified, and never create a second row for someone already on that
--    community.
CREATE OR REPLACE FUNCTION public.claim_pending_community_memberships()
    RETURNS VOID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_uid   UUID := auth.uid();
    v_email TEXT;
BEGIN
    IF v_uid IS NULL THEN RETURN; END IF;

    v_email := public.verified_auth_email(v_uid);
    IF v_email IS NULL THEN RETURN; END IF;

    UPDATE public.community_members cm
       SET user_id = v_uid
     WHERE cm.user_id IS NULL
       AND lower(cm.email) = lower(v_email)
       AND NOT EXISTS (
           SELECT 1 FROM public.community_members x
           WHERE x.community_id = cm.community_id AND x.user_id = v_uid
       );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_community_memberships() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_pending_community_memberships() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_pending_community_memberships() TO authenticated;

-- 3. Same for project invites (2026-08-19), same rule.
CREATE OR REPLACE FUNCTION public.claim_pending_project_memberships()
    RETURNS VOID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_uid   UUID := auth.uid();
    v_email TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RETURN;
    END IF;

    v_email := public.verified_auth_email(v_uid);
    IF v_email IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.project_members
    SET user_id = v_uid
    WHERE user_id IS NULL
      AND lower(email) = lower(v_email);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_project_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_project_memberships() TO authenticated;

-- handle_new_user() (2026-08-21) links email-only rows at first sign-in without
-- a verified-email check. It is not changed here; claim_pending_* and join_team
-- are the places that apply the rule above.
