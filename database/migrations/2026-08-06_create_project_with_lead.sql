-- =============================================================================
-- Migration: create_project_with_lead  (2026-08-06)
-- =============================================================================
-- Fixes project creation. NOT an RLS bug — pg_policy confirms
-- "Projects: authenticated insert" exists with the correct
-- WITH CHECK (auth.uid() = lead_id), and the INSERT itself passes.
--
-- What actually fails: createProject() (frontend/lib/server/projects.ts) does
-- a plain PostgREST insert, which by default sends `Prefer:
-- return=representation` — i.e. INSERT ... RETURNING. Postgres evaluates the
-- SELECT half of that RETURNING against the projects SELECT policy
-- (is_project_member(id, auth.uid())), and at that exact instant the new
-- project's project_members row doesn't exist yet — the second insert hasn't
-- run. is_project_member() correctly returns false, and Postgres reports the
-- denied RETURNING read as the SAME 42501 "new row violates row-level
-- security policy" text the failed INSERT itself would use, which is what
-- made this look like a broken INSERT policy. This is the identical failure
-- mode already documented for the feedback table in
-- database/migrations/2026-07-29_feedback.sql (INSERT ... RETURNING needs a
-- passing SELECT policy on the row just inserted, even for your own row) —
-- same root cause, different table.
--
-- There is no `.select()` call to simply remove here, unlike feedback.ts:
-- createProject() genuinely NEEDS the new row's id back, to insert the
-- matching project_members row against it. So the fix is not "stop asking
-- for the row back" — it's "do both inserts, and the SELECT that returns the
-- id, inside ONE SECURITY DEFINER transaction that never has to satisfy RLS
-- at all," rather than two sequential PostgREST calls with a
-- compensating-delete rollback bolted on for when the second one fails.
--
-- SECURITY DEFINER means this function bypasses RLS entirely, which is
-- exactly why lead_id is taken from auth.uid() INSIDE the function and
-- accepted as a parameter from NOWHERE — a caller-supplied lead_id would let
-- anyone hand this function a project owned by someone else. Same reasoning
-- as every other SECURITY DEFINER function in this codebase
-- (collab_post_owners(), showcase_owners(), etc.): the function is trusted
-- precisely because it does not trust its caller for identity, only for the
-- content fields (name, description, ...).
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_project_with_lead(
    p_name        TEXT,
    p_description TEXT DEFAULT NULL,
    p_deadline    TIMESTAMPTZ DEFAULT NULL,
    p_challenge_key TEXT DEFAULT NULL,
    p_target      TEXT DEFAULT NULL,
    p_indication  TEXT DEFAULT NULL,
    p_modality    TEXT DEFAULT NULL,
    p_stage       TEXT DEFAULT NULL
)
    RETURNS UUID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_email TEXT;
    v_project_id UUID;
BEGIN
    -- Never trust a caller argument for identity. If there is no session,
    -- there is no lead — fail loudly rather than insert a leadless project.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'create_project_with_lead: no authenticated user';
    END IF;

    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'create_project_with_lead: name is required';
    END IF;

    -- public.users is this app's own mirror of the auth identity (kept in
    -- sync by handle_new_user()), so this reads the same email the rest of
    -- the app already treats as canonical rather than reaching into
    -- auth.users directly.
    SELECT email INTO v_email FROM public.users WHERE id = v_uid;

    INSERT INTO public.projects (
        name, description, lead_id, deadline, challenge_key,
        target, indication, modality, stage
    )
    VALUES (
        btrim(p_name), p_description, v_uid, p_deadline, p_challenge_key,
        p_target, p_indication, p_modality, p_stage
    )
    RETURNING id INTO v_project_id;

    -- Runs in the SAME transaction as the insert above — either both rows
    -- exist when this function returns, or (on any error, including the
    -- RAISE EXCEPTIONs above) neither does. No compensating DELETE needed,
    -- and no window where the project exists without its lead member row.
    INSERT INTO public.project_members (project_id, email, user_id, role, added_by)
    VALUES (v_project_id, COALESCE(v_email, ''), v_uid, 'lead', v_uid);

    RETURN v_project_id;
END;
$$;

-- Only a signed-in user may call this — matches the "authenticated insert"
-- RLS policy's intent, now enforced at the function-grant level since the
-- function itself bypasses RLS. anon gets no grant at all.
REVOKE ALL ON FUNCTION public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
