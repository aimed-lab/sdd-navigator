-- =============================================================================
-- Migration: description_capabilities_gate_version  (2026-08-24)
-- =============================================================================
-- The gap this closes: projects.description_capabilities (this same day's
-- earlier migration, 2026-08-24_project_description_capabilities.sql) is
-- classified exactly ONCE, at project creation — there is no edit path for
-- `description` anywhere in the frontend, so nothing ever re-triggers it.
-- That means "classified under the whole-text gate, before the
-- sentence-scoping fix" and "classified under the current gate, confidently
-- nothing to outsource" are BOTH a plain [], indistinguishable from each
-- other and from a project that was simply created before the column
-- existed. This is the exact same shape of ambiguity already hit twice
-- before: the checklist items silently mis-classified during the 2026-08-23
-- catalog outage (see checklistClassify.ts's own header comment), and the
-- 2026-08-19 NLRP3 checklist items that needed a hand migration
-- (2026-08-19_reclassify_nlrp3_checklist.sql) to even find, because nothing
-- recorded that they'd been classified under a since-changed prompt.
--
-- description_capabilities_gate_version records WHICH version of the
-- classification gate (tools/find_provider.py's CLASSIFIER_GATE_VERSION)
-- produced the value currently sitting in description_capabilities. NULL
-- alongside a NULL description_capabilities means "never classified at
-- all." A non-NULL description_capabilities whose version is BEHIND the
-- current CLASSIFIER_GATE_VERSION means "classified, but under logic we've
-- since changed" — treated the same as "never assessed" by
-- app/api/find-providers-for-project/route.ts until it's reclassified,
-- rather than trusted as a live answer that happens to be stale. Only a
-- non-NULL description_capabilities at the CURRENT version is a trustworthy
-- "assessed, confidently nothing" or "assessed, here's what matched."
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS description_capabilities_gate_version INTEGER;

-- One more trailing parameter on create_project_with_lead, same reasoning
-- as the prior migration's own addition of p_description_capabilities:
-- both values land in the SAME transaction as the project row, computed in
-- TypeScript before the RPC call (see lib/server/projects.ts's
-- createProject()).
DROP FUNCTION IF EXISTS public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]
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
    p_description_capabilities TEXT[] DEFAULT NULL,
    p_description_capabilities_gate_version INTEGER DEFAULT NULL
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
        target, indication, modality, stage,
        description_capabilities, description_capabilities_gate_version
    )
    VALUES (
        btrim(p_name), p_description, v_uid, p_deadline, p_challenge_key,
        p_target, p_indication, p_modality, p_stage,
        p_description_capabilities, p_description_capabilities_gate_version
    )
    RETURNING id INTO v_project_id;

    INSERT INTO public.project_members (project_id, email, user_id, role, added_by)
    VALUES (v_project_id, COALESCE(v_email, ''), v_uid, 'lead', v_uid);

    RETURN v_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER
) TO authenticated;
