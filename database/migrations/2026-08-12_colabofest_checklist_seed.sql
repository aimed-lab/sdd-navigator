-- =============================================================================
-- Migration: seed the ColaboFest readiness checklist  (2026-08-12)
-- =============================================================================
-- Prof. Chen supplied the SPARC Collabofest Team Readiness Self-Checklist
-- PDF. Section A ("Essential project foundation") has exactly nine items,
-- and the PDF frames them as the essential set: "Before submitting, your
-- team should be able to check most or all of these." Sections B-H add
-- roughly fifty more, which nobody fills in a browser — those live in the
-- PDF itself, linked from the Checklist section
-- (frontend/components/projects/ChecklistSection.tsx), not modeled here.
--
-- Full replacement of create_project_with_lead()
-- (2026-08-06_create_project_with_lead.sql). Same signature, same
-- SECURITY DEFINER / search_path / grants — the only change is a third
-- insert, into checklist_items, gated on p_challenge_key = 'colabofest_2026'
-- and run in the SAME transaction as the project and project_members
-- inserts already there. That matters for the same reason the project +
-- member inserts are already one function instead of two sequential
-- PostgREST calls: a separate seeding step run afterwards from the
-- frontend could fail after the project exists (network blip, the caller
-- navigating away) and leave a ColaboFest project with an empty checklist.
-- Inside this function, either all three inserts land or none do.
--
-- The nine items are seeded as ORDINARY rows in checklist_items — same
-- table, same columns, same RLS ("Checklist items: member *",
-- 2026-08-04_projects.sql) as any item a team adds by hand. Nothing marks
-- them as special or uneditable: a team can rename, reorder, delete, or add
-- to them exactly like the STRUCTURE.md spec for the Checklist section
-- already requires, because per the PDF itself this is "a planning aid,
-- not a requirement that every box be checked" and "should not be used as
-- a rigid eligibility screen" — not a fixed form to preserve.
--
-- A regular project (p_challenge_key IS NULL, or anything other than
-- 'colabofest_2026') gets no seeded rows, unchanged from before this
-- migration — the checklist starts empty exactly as it always has.
--
-- CONFIRMED, not changed by this migration: submitProposal()
-- (frontend/lib/server/projects.ts) never reads checklist_items or
-- checklist status. It checks only project membership/leadership and the
-- deadline. The nine seeded items being 'not_yet' can never block a
-- submission — matches the PDF's own "not a rigid eligibility screen"
-- framing.
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

    -- ColaboFest Section A, verbatim from the PDF, in order. Ordinary,
    -- fully editable rows — see the migration header for why nothing marks
    -- them special. Any other p_challenge_key (including NULL, the regular
    -- project case) skips this entirely and the checklist starts empty.
    IF p_challenge_key = 'colabofest_2026' THEN
        INSERT INTO public.checklist_items (project_id, label, status, position)
        VALUES
            (v_project_id, 'Our team includes at least one co-investigator from UAB or the CCTS Partner Network.', 'not_yet', 1),
            (v_project_id, 'We can state the unmet need or translational bottleneck in one or two sentences.', 'not_yet', 2),
            (v_project_id, 'We have a testable target, mechanism, intervention, or patient-cohort hypothesis.', 'not_yet', 3),
            (v_project_id, 'We can name the decision or deliverable we need from SPARC.', 'not_yet', 4),
            (v_project_id, 'A scientific or clinical lead owns the biological interpretation of the project.', 'not_yet', 5),
            (v_project_id, 'We have credible supporting evidence, preliminary findings, or a strong published foundation.', 'not_yet', 6),
            (v_project_id, 'We understand what data or structural information the proposed analysis requires.', 'not_yet', 7),
            (v_project_id, 'A team member or committed collaborator can own downstream validation.', 'not_yet', 8),
            (v_project_id, 'We can describe the next translational milestone if the project succeeds.', 'not_yet', 9);
    END IF;

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
