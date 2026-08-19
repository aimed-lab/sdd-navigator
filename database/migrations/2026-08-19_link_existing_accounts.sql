-- =============================================================================
-- Migration: link_existing_accounts  (2026-08-19)
-- =============================================================================
-- Bug: adding a member who ALREADY HAS AN ACCOUNT left them permanently
-- unlinked. handle_new_user() (2026-08-04_projects.sql) only claims a
-- pending project_members row AT SIGNUP — it fires on an INSERT into
-- auth.users, so it has nothing to do for someone who signed up before
-- being added. Confirmed on real data: added after signup, user_id stayed
-- NULL forever. This is the COMMON case (most invitees already have
-- accounts), not an edge case.
--
-- Two fixes, because either alone leaves a hole:
--
-- 1. find_account_id_by_email_for_project() — addProjectMember() calls this
--    at INSERT time to look up an existing account by email and link it
--    immediately, instead of always inserting user_id = NULL and hoping a
--    future signup's trigger catches it. SECURITY DEFINER so the app never
--    reads auth.users directly (RLS wouldn't allow that from the client
--    role anyway; this function runs as its owner specifically to reach
--    auth.users on the app's behalf).
--
--    NOT AN EMAIL-ENUMERATION ORACLE, on purpose:
--      - takes p_project_id and returns NULL unless the CALLER leads that
--        project (checked via the existing is_project_lead()) — you cannot
--        call this for an arbitrary email without already leading a real
--        project, and the project_id you pass is checked, not trusted;
--      - returns ONLY a uuid (the matching auth.users.id) or NULL — never a
--        name, never an email, never a "found but not confirmed" distinction
--        that would let a caller learn more than "did this get linked";
--      - only matches a CONFIRMED account (email_confirmed_at IS NOT NULL) —
--        an unconfirmed signup must not be linkable by someone else typing
--        their email, since that would hand a not-yet-verified mailbox
--        owner's row to whoever added them first;
--      - granted to `authenticated` only, never `anon`.
--
-- 2. claim_pending_project_memberships() — called from listMyProjects()
--    every time a signed-in user loads their projects list. Claims any
--    project_members row still unlinked (user_id IS NULL) whose email
--    matches THIS CALLER'S OWN verified email — auth.uid()/their own
--    auth.users row, never a parameter, so there is nothing to pass that
--    could claim someone else's row. This is what catches:
--      - the REVERSE ordering (added while they had no account, and
--        handle_new_user's UPDATE at signup time raced or was somehow
--        missed — belt-and-suspenders, not the primary path for that case);
--      - added while they had no account, they sign up, but the trigger's
--        write and the row they're about to view are read in a way that
--        never lines up — this makes "did the trigger definitely catch it"
--        no longer something the app has to trust blindly;
--      - ANY future case where someone becomes a member of a project by an
--        email path that isn't itself hooked to auth.users INSERT.
--    IDEMPOTENT (a plain UPDATE ... WHERE user_id IS NULL — running it
--    again when there's nothing to claim is a no-op) and CHEAP (the partial
--    index below scopes it to the handful of still-pending rows in the
--    whole table, not a scan of every membership).
--
-- WHY auth.users HERE, NOT public.users (the usual convention — see
-- 2026-08-06_create_project_with_lead.sql's "reads the same email the rest
-- of the app already treats as canonical rather than reaching into
-- auth.users directly"). That convention is about avoiding an RLS problem
-- on an INSERT during signup with no session yet; it doesn't apply to a
-- read-only SELECT inside a SECURITY DEFINER function, which bypasses RLS
-- regardless of source table. And public.users.email is a snapshot taken
-- once at signup (handle_new_user's INSERT ... ON CONFLICT DO NOTHING —
-- never updated again) with no confirmation status at all, so it cannot
-- answer "does this email have a CONFIRMED account" or stay correct if
-- someone later changes their email in Supabase Auth. auth.users is the
-- live, authoritative source for both — the right call specifically
-- because "verified" is part of the requirement here.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

-- ── Supporting index ──────────────────────────────────────────────────────
-- Both functions below search project_members by email among UNLINKED rows.
-- The existing unique index is (project_id, lower(email)) — project_id-first,
-- so it doesn't serve an email-first lookup across all projects. Partial (WHERE
-- user_id IS NULL) so it only ever covers the small, shrinking set of rows
-- that still need claiming, not the whole table.
DROP INDEX IF EXISTS public.project_members_pending_email_idx;
CREATE INDEX project_members_pending_email_idx
    ON public.project_members (lower(email))
    WHERE user_id IS NULL;

-- ── 1. Link at insert time ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_account_id_by_email_for_project(
    p_project_id UUID,
    p_email TEXT
)
    RETURNS UUID
    LANGUAGE plpgsql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
DECLARE
    v_uid UUID;
BEGIN
    -- Only usable in the context of adding a member to a project the
    -- CALLER leads — is_project_lead() re-checks auth.uid() itself, so a
    -- forged/borrowed project_id from a project the caller doesn't lead
    -- returns NULL, same as a non-existent email would.
    IF NOT public.is_project_lead(p_project_id, auth.uid()) THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_uid
    FROM auth.users
    WHERE lower(email) = lower(p_email)
      AND email_confirmed_at IS NOT NULL
    LIMIT 1;

    RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.find_account_id_by_email_for_project(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_account_id_by_email_for_project(UUID, TEXT) TO authenticated;

-- ── 2. Reconcile on projects-list load ───────────────────────────────────────
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

    -- The caller's OWN verified email, read from auth.users (never a
    -- parameter) — this can only ever claim rows matching the signed-in
    -- caller's own confirmed address, nobody else's.
    SELECT email INTO v_email
    FROM auth.users
    WHERE id = v_uid
      AND email_confirmed_at IS NOT NULL;

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
