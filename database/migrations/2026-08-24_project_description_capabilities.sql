-- =============================================================================
-- Migration: project_description_capabilities  (2026-08-24)
-- =============================================================================
-- "Who can help" used to look ONLY at checklist_items.matched_capabilities
-- (2026-08-19_checklist_matched_capabilities.sql). A brand-new project has no
-- checklist yet, so that section rendered "nothing in this project's
-- checklist currently needs outside help" before anyone had a chance to add
-- one — a wrong answer dressed up as a real determination, not an honest
-- "haven't looked yet."
--
-- Adds projects.description_capabilities: the STORED result of classifying
-- the project's OWN description text against the same provider-catalog
-- capability vocabulary, with the SAME prompt and the SAME
-- _ALREADY_HAVE_SIGNALS grounding gate checklist items already go through
-- (see backend/explore-mcp/tools/find_provider.py — this is one prompt,
-- reused, not a second one to keep in sync).
--
-- NULLABLE, NO DEFAULT — this is the whole point of this migration, and the
-- one place it deliberately diverges from checklist_items.matched_capabilities
-- (NOT NULL DEFAULT '{}'). A checklist item gets re-classified every time its
-- label is edited, so a permanent [] there is never stuck being wrong for
-- long. A project's description is set ONCE, at creation
-- (create_project_with_lead below), with no edit path anywhere in the
-- frontend today — so if this column defaulted to '{}' the same way,
-- "never classified" (a pre-migration project, or a creation-time
-- classification failure) would be permanently indistinguishable from
-- "classified, confidently nothing to outsource." NULL means "not assessed
-- yet"; '{}' means "assessed, confidently no service need." Only the NULL
-- case degrades the section to "will fill in as the project takes shape"
-- (see app/api/find-providers-for-project/route.ts) — every project created
-- after this migration always gets a real (possibly empty) array, because
-- classification happens inline in the same create_project_with_lead call
-- that inserts the row, never deferred.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS description_capabilities TEXT[];

-- create_project_with_lead (2026-08-06_create_project_with_lead.sql) gets one
-- new trailing parameter so the description's classification — done in
-- TypeScript, BEFORE this RPC call, by the same classifyChecklistItem() the
-- checklist already uses (see frontend/lib/server/projects.ts createProject())
-- — lands in the SAME transaction as the project row it describes, instead
-- of a second write that could succeed or fail independently of project
-- creation. Adding a parameter changes the function's signature, so
-- CREATE OR REPLACE alone would create a second overload rather than replace
-- the original; the old 8-arg signature is dropped first.
DROP FUNCTION IF EXISTS public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.create_project_with_lead(
    p_name        TEXT,
    p_description TEXT DEFAULT NULL,
    p_deadline    TIMESTAMPTZ DEFAULT NULL,
    p_challenge_key TEXT DEFAULT NULL,
    p_target      TEXT DEFAULT NULL,
    p_indication  TEXT DEFAULT NULL,
    p_modality    TEXT DEFAULT NULL,
    p_stage       TEXT DEFAULT NULL,
    p_description_capabilities TEXT[] DEFAULT NULL
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
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'create_project_with_lead: no authenticated user';
    END IF;

    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'create_project_with_lead: name is required';
    END IF;

    SELECT email INTO v_email FROM public.users WHERE id = v_uid;

    INSERT INTO public.projects (
        name, description, lead_id, deadline, challenge_key,
        target, indication, modality, stage, description_capabilities
    )
    VALUES (
        btrim(p_name), p_description, v_uid, p_deadline, p_challenge_key,
        p_target, p_indication, p_modality, p_stage, p_description_capabilities
    )
    RETURNING id INTO v_project_id;

    INSERT INTO public.project_members (project_id, email, user_id, role, added_by)
    VALUES (v_project_id, COALESCE(v_email, ''), v_uid, 'lead', v_uid);

    RETURN v_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]
) TO authenticated;
