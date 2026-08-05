-- =============================================================================
-- Migration: projects — team project workspace  (2026-08-04)  [RUN FIRST]
-- =============================================================================
-- A universal team project workspace, NOT a ColaboFest submission tool.
-- ColaboFest is one thing that can live inside it (challenge_key = a value,
-- not a schema branch). Flow: create a project -> add people -> explore
-- resources scoped to the project -> build your own checklist -> one click
-- turns a missing item into a Collaborate post -> shared folder for the
-- team -> promote the work when it's done.
--
-- ACCESS CONTROL: visibility here is MEMBERSHIP, not ownership, unlike every
-- other table in this codebase (which is auth.uid() = owner_id). A member
-- sees a project and everything belonging to it; a non-member never receives
-- the row at all, not merely a hidden one client-side.
--
-- is_project_member() below is SECURITY DEFINER specifically so that the
-- policy on `projects` can check membership, and the policy on
-- `project_members` can check the project, WITHOUT either policy querying
-- the other's table directly under RLS. A plain "policy on projects queries
-- project_members, policy on project_members queries projects" pair is
-- infinite recursion in Postgres — the single most common way a team schema
-- like this breaks. The function runs with the privileges of its owner, so
-- it reads the table without ever re-entering RLS on it.
-- =============================================================================

-- ── TABLE: projects ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
    id                     UUID        NOT NULL DEFAULT gen_random_uuid(),
    name                   TEXT        NOT NULL,
    description            TEXT,
    lead_id                UUID        REFERENCES public.users (id),
    deadline               TIMESTAMPTZ,
    -- NULL = an ordinary project. 'colabofest_2026' = entered in that
    -- challenge; drives checklist seeding and whether the proposal section
    -- applies. Deliberately plain text, not an FK/enum/constraint, so next
    -- year's challenge is a value the app writes, not a migration.
    challenge_key          TEXT,
    shared_folder_url      TEXT,
    shared_folder_set_by   UUID        REFERENCES public.users (id),
    shared_folder_set_at   TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT projects_pkey PRIMARY KEY (id)
);

-- ── TABLE: project_members ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_members (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id  UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    email       TEXT        NOT NULL,
    -- Nullable ON PURPOSE: members are added by email before they
    -- necessarily have an account, and get linked by handle_new_user
    -- (below) when they sign up.
    user_id     UUID        REFERENCES public.users (id),
    role        TEXT        NOT NULL DEFAULT 'member',
    added_by    UUID        REFERENCES public.users (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_members_pkey PRIMARY KEY (id),
    CONSTRAINT project_members_role_check CHECK (role IN ('lead', 'member'))
);

DROP INDEX IF EXISTS project_members_project_email_key;
CREATE UNIQUE INDEX project_members_project_email_key
    ON public.project_members (project_id, lower(email));

-- ── TABLE: checklist_items ───────────────────────────────────────────────
-- Its own table, NOT jsonb on projects, because a Collaborate post
-- references a specific item so it can be ticked off when someone helps.
CREATE TABLE IF NOT EXISTS public.checklist_items (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id  UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    label       TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'not_yet',
    position    INTEGER     NOT NULL DEFAULT 0,
    updated_by  UUID        REFERENCES public.users (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT checklist_items_pkey PRIMARY KEY (id),
    CONSTRAINT checklist_items_status_check
        CHECK (status IN ('not_yet', 'in_progress', 'ready'))
);

-- ── TABLE: project_proposals ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_proposals (
    id            UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id    UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    title         TEXT,
    category      TEXT,
    summary       TEXT,
    file_path     TEXT,
    submitted_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_proposals_pkey PRIMARY KEY (id)
);

-- ── LINKS INTO EXISTING TABLES ────────────────────────────────────────────
-- Both nullable: posting to Collaborate or promoting to the showcase
-- without a project must keep working exactly as it does today.

-- One-click bridge: a missing checklist item becomes a Collaborate post.
ALTER TABLE public.collab_posts
    ADD COLUMN IF NOT EXISTS checklist_item_id UUID
        REFERENCES public.checklist_items (id) ON DELETE SET NULL;

-- "Promote the finished work" — ties a showcase entry back to its project.
ALTER TABLE public.promote_showcase
    ADD COLUMN IF NOT EXISTS project_id UUID
        REFERENCES public.projects (id) ON DELETE SET NULL;

-- =============================================================================
-- ACCESS CONTROL
-- =============================================================================

-- SECURITY DEFINER: lets the policies below check membership without the
-- policy on `projects` querying `project_members` (and vice versa) under
-- RLS, which is what causes the infinite-recursion failure mode.
CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.project_members pm
        WHERE pm.project_id = p_project_id
          AND pm.user_id = p_uid
    );
$$;

-- Companion check for "is this uid the lead of this project" — used for the
-- lead-only actions (add/remove members, submit, delete). Same
-- SECURITY DEFINER reasoning as is_project_member().
CREATE OR REPLACE FUNCTION public.is_project_lead(p_project_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.projects p
        WHERE p.id = p_project_id
          AND p.lead_id = p_uid
    );
$$;

ALTER TABLE public.projects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_proposals  ENABLE ROW LEVEL SECURITY;

-- ── projects ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Projects: member select" ON public.projects;
CREATE POLICY "Projects: member select"
    ON public.projects FOR SELECT
    USING (public.is_project_member(id, auth.uid()));

DROP POLICY IF EXISTS "Projects: authenticated insert" ON public.projects;
CREATE POLICY "Projects: authenticated insert"
    ON public.projects FOR INSERT
    WITH CHECK (auth.uid() = lead_id);

DROP POLICY IF EXISTS "Projects: member update" ON public.projects;
CREATE POLICY "Projects: member update"
    ON public.projects FOR UPDATE
    USING (public.is_project_member(id, auth.uid()))
    WITH CHECK (public.is_project_member(id, auth.uid()));

DROP POLICY IF EXISTS "Projects: lead delete" ON public.projects;
CREATE POLICY "Projects: lead delete"
    ON public.projects FOR DELETE
    USING (public.is_project_lead(id, auth.uid()));

-- ── project_members ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Project members: member select" ON public.project_members;
CREATE POLICY "Project members: member select"
    ON public.project_members FOR SELECT
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project members: lead insert" ON public.project_members;
CREATE POLICY "Project members: lead insert"
    ON public.project_members FOR INSERT
    WITH CHECK (public.is_project_lead(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project members: lead delete" ON public.project_members;
CREATE POLICY "Project members: lead delete"
    ON public.project_members FOR DELETE
    USING (public.is_project_lead(project_id, auth.uid()));

-- ── checklist_items ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Checklist items: member select" ON public.checklist_items;
CREATE POLICY "Checklist items: member select"
    ON public.checklist_items FOR SELECT
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Checklist items: member insert" ON public.checklist_items;
CREATE POLICY "Checklist items: member insert"
    ON public.checklist_items FOR INSERT
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Checklist items: member update" ON public.checklist_items;
CREATE POLICY "Checklist items: member update"
    ON public.checklist_items FOR UPDATE
    USING (public.is_project_member(project_id, auth.uid()))
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Checklist items: member delete" ON public.checklist_items;
CREATE POLICY "Checklist items: member delete"
    ON public.checklist_items FOR DELETE
    USING (public.is_project_member(project_id, auth.uid()));

-- ── project_proposals ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Project proposals: member select" ON public.project_proposals;
CREATE POLICY "Project proposals: member select"
    ON public.project_proposals FOR SELECT
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project proposals: member insert" ON public.project_proposals;
CREATE POLICY "Project proposals: member insert"
    ON public.project_proposals FOR INSERT
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project proposals: member update" ON public.project_proposals;
CREATE POLICY "Project proposals: member update"
    ON public.project_proposals FOR UPDATE
    USING (public.is_project_member(project_id, auth.uid()))
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project proposals: lead delete" ON public.project_proposals;
CREATE POLICY "Project proposals: lead delete"
    ON public.project_proposals FOR DELETE
    USING (public.is_project_lead(project_id, auth.uid()));

-- Submitting a proposal (setting submitted_at) is a member-update above;
-- "only the lead submits" per the spec is enforced at the app layer by
-- gating the submit action to is_project_lead — RLS still allows any
-- member to update the row (folder link / summary edits are member-wide),
-- but the submit action itself should check leadership before calling in.
-- (No separate policy needed: submitted_at is just a column on a row every
-- member can already UPDATE.)

-- =============================================================================
-- handle_new_user — extended to claim pending project_members rows
-- =============================================================================
-- Full replacement of the trigger function defined in schema.sql. Same
-- SECURITY DEFINER / search_path, same users-insert behavior, with one
-- addition: link any project_members rows whose email matches the new
-- user, setting user_id so they show up as a linked member instead of a
-- pending email-only invite.
CREATE OR REPLACE FUNCTION public.handle_new_user()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    INSERT INTO public.users (id, name, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.email, '')
    )
    ON CONFLICT (id) DO NOTHING;

    -- Claim any project_members rows added by email before this user had
    -- an account.
    UPDATE public.project_members
    SET user_id = NEW.id
    WHERE user_id IS NULL
      AND lower(email) = lower(NEW.email);

    RETURN NEW;
END;
$$;

-- Trigger already exists (created in schema.sql) and points at this same
-- function name/signature, so no DROP/CREATE TRIGGER needed here — the
-- CREATE OR REPLACE FUNCTION above is enough to pick up the new behavior.
