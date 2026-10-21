-- =============================================================================
-- Migration: community_email_join_checklist  (2026-10-23)
-- =============================================================================
-- Two things for the community page:
--
--   1. EMAIL-ONLY JOIN. Someone at a talk scans the QR code, types an email
--      and is a member of an OPEN community: no password, no account. The row
--      is a by-email membership (user_id NULL) exactly like the one an admin
--      creates with "Add a member by email"; handle_new_user() /
--      claim_pending_community_memberships() link it when that person later
--      signs in with the same email. Nothing about that claiming changes.
--
--   2. WELCOME CHECKLIST PROGRESS. Per-member, private to that member.
--
-- Run once in the Supabase SQL editor. Idempotent (IF NOT EXISTS / DROP ... IF
-- EXISTS before CREATE) so it is safe to re-run. NOT run against any database
-- as part of writing this file. No storage.objects policy here, so nothing in
-- this file needs the dashboard fallback.
--
-- ── WHO MAY CALL join_open_community_by_email ────────────────────────────────
-- The app calls it from the server with the SERVICE-ROLE key, after its own
-- per-IP rate limit (lib/server/communityEmailJoin.ts). EXECUTE is therefore
-- granted to service_role ONLY: if it were granted to anon, anyone holding the
-- public anon key could call the RPC directly and skip the rate limit
-- entirely. (The usual "revoke from PUBLIC, then from anon" habit, applied one
-- step further: authenticated is revoked too, a signed-in user joins through
-- the normal self-insert policy instead.)
--
-- ── WHAT THE FUNCTION WILL AND WILL NOT DO ───────────────────────────────────
--   * Only when communities.is_open = true. A request-to-join community
--     returns 'not_open' and writes nothing.
--   * Always role = 'member', status = 'active'. It cannot make an admin or a
--     lead, there is no parameter for it.
--   * The email is trimmed and lowercased, checked for format and length, and
--     stored lowercased (the unique index is on lower(email)).
--   * Duplicates are ignored: a second join with the same email, or an email
--     that already belongs to a linked member of this community, changes
--     nothing and returns 'already_member'. (The app shows the same "You're
--     in" message for 'joined' and 'already_member', so the form cannot be
--     used to find out who is in a community.)
--   * The new row is marked email_verified = false. Nobody has proved they own
--     that address yet. A later email digest should ask these members to
--     confirm before sending more. The flag flips to true by itself the moment
--     the row is linked to an account (trigger below): signing in with that
--     email is the proof.
--
-- Return values: 'joined' | 'already_member' | 'not_open' | 'not_found' |
--                'invalid_email'

-- ── community_members.email_verified ────────────────────────────────────────
-- DEFAULT true: every row that exists today was added by an admin, imported,
-- or joined through an account, so it keeps meaning "no confirmation needed".
-- Only the email-only join writes false.
ALTER TABLE public.community_members
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.mark_community_member_email_verified()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    -- Linking an unlinked row to an account (sign-up, or
    -- claim_pending_community_memberships) proves the person controls that
    -- email address.
    IF OLD.user_id IS NULL AND NEW.user_id IS NOT NULL THEN
        NEW.email_verified := true;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_community_member_email_verified ON public.community_members;
CREATE TRIGGER trg_mark_community_member_email_verified
    BEFORE UPDATE OF user_id ON public.community_members
    FOR EACH ROW
    EXECUTE FUNCTION public.mark_community_member_email_verified();

-- ── join_open_community_by_email ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_open_community_by_email(p_community_id UUID, p_email TEXT)
    RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_email TEXT := lower(btrim(COALESCE(p_email, '')));
    v_open  BOOLEAN;
    v_rows  INTEGER;
BEGIN
    IF length(v_email) > 254
       OR v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
    THEN
        RETURN 'invalid_email';
    END IF;

    SELECT c.is_open INTO v_open FROM public.communities c WHERE c.id = p_community_id;
    IF NOT FOUND THEN
        RETURN 'not_found';
    END IF;
    IF v_open IS NOT TRUE THEN
        RETURN 'not_open';
    END IF;

    -- Already a member through a linked account whose row may not carry this
    -- email (a person who joined while signed in).
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

-- ── community_member_progress ───────────────────────────────────────────────
-- A table of its own rather than a column on community_members: that table's
-- SELECT policy lets an admin read every column of every row, and this
-- progress is meant to be readable and writable by the member alone.
--
--   steps         which tracked checklist steps this member has done, e.g.
--                 {"pinned_opened": true, "link_copied": true}. The other
--                 checklist items (focus, living page) are derived from data
--                 that already exists, not stored here.
--   dismissed_at  set when the member dismisses the checklist.
CREATE TABLE IF NOT EXISTS public.community_member_progress (
    community_id UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    user_id      UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    steps        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    dismissed_at TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, user_id),
    CONSTRAINT community_member_progress_steps_shape
        CHECK (jsonb_typeof(steps) = 'object' AND pg_column_size(steps) < 2048)
);

ALTER TABLE public.community_member_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Member progress: self select" ON public.community_member_progress;
CREATE POLICY "Member progress: self select"
    ON public.community_member_progress FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Insert/update: your own row, and only while you are an active member.
DROP POLICY IF EXISTS "Member progress: self insert" ON public.community_member_progress;
CREATE POLICY "Member progress: self insert"
    ON public.community_member_progress FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid() AND public.is_community_member(community_id, auth.uid()));

DROP POLICY IF EXISTS "Member progress: self update" ON public.community_member_progress;
CREATE POLICY "Member progress: self update"
    ON public.community_member_progress FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid() AND public.is_community_member(community_id, auth.uid()));

REVOKE ALL ON public.community_member_progress FROM PUBLIC;
REVOKE ALL ON public.community_member_progress FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.community_member_progress TO authenticated;
