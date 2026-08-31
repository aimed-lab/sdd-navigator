-- =============================================================================
-- Migration: community_admin_membership  (2026-08-30)
-- =============================================================================
-- Adds community CREATION (any signed-in user, always private, creator
-- becomes admin), a real ADMIN role on top of the existing lead/member
-- (admin manages membership and promotes; lead can post but not touch
-- membership — unchanged, can_post_to_community already covers it), the
-- by-email add-member path project_members already has (mirrored, not
-- reinvented), and projects.community_id.
--
-- WHAT ALREADY EXISTED (2026-08-20_communities.sql, 2026-08-21_community_join.sql):
-- communities, community_members (status active/pending, nullable user_id +
-- email, approved_by), is_community_lead, is_community_member,
-- community_member_stats, and the request-to-join flow into a closed
-- community (self-insert with status='pending'). None of that is redone
-- here — only extended.
--
-- ROLE VOCABULARY: community_members.role has been free text since
-- 2026-08-20 with no CHECK constraint at all (project_members.role, by
-- contrast, has always been CHECK'd to ('lead','member')). This migration
-- gives it the same discipline: ('admin','lead','member').
--
-- BACKFILL: every community created before this migration has zero
-- role='admin' rows — the role didn't exist yet. The "always at least one
-- admin" trigger below would leave those communities with nobody able to
-- manage membership at all (SELECT/UPDATE/DELETE on community_members all
-- become admin-gated below, same reason: don't expose member emails to a
-- non-admin lead any more than to a member). Each existing community's
-- earliest active lead (or, failing that, its earliest active member) is
-- promoted to admin so the invariant holds for existing data, not only
-- communities created from tonight onward.
--
-- THE ADMIN GUARD IS A TRIGGER, NOT AN RLS CHECK, same reasoning as
-- project_members' trg_enforce_min_one_lead (2026-08-08_project_co_leads.sql):
-- "at least one X must survive this row's UPDATE/DELETE" needs to inspect
-- the REST of the table (every other row for this community_id), which is
-- exactly what a BEFORE trigger can do against OLD/the table state and an
-- RLS USING/WITH CHECK clause on a single row cannot express on its own.
-- Extended one step further than the project trigger: "an admin cannot
-- remove or demote a DIFFERENT admin" is enforced here too (checked by
-- comparing auth.uid() to the row's own user_id), not just "keep one
-- admin" — the project trigger only ever had one invariant to enforce.
--
-- ANON GRANTS: every SECURITY DEFINER function below gets an explicit
-- REVOKE ALL FROM PUBLIC then REVOKE ALL FROM anon before its GRANT — the
-- standing rule (this has caught this codebase five times now). While
-- here, the SAME fix is applied to create_project_with_lead, which this
-- migration touches anyway to add community_id: its 2026-08-24 REVOKE only
-- covered PUBLIC, never explicitly anon.
--
-- Run once in the Supabase SQL editor, AFTER every migration that precedes
-- it by filename. Idempotent — safe to re-run. NOT run against any
-- database as part of writing this file.
-- =============================================================================

-- ── community_members: role vocabulary ──────────────────────────────────────
ALTER TABLE public.community_members DROP CONSTRAINT IF EXISTS community_members_role_check;
ALTER TABLE public.community_members
    ADD CONSTRAINT community_members_role_check CHECK (role IN ('admin', 'lead', 'member'));

-- ── backfill: give every existing adminless community an admin ─────────────
DO $$
DECLARE
    v_community RECORD;
    v_member_id UUID;
BEGIN
    FOR v_community IN SELECT id FROM public.communities LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.community_members
            WHERE community_id = v_community.id AND status = 'active' AND role = 'admin'
        ) THEN
            SELECT id INTO v_member_id
            FROM public.community_members
            WHERE community_id = v_community.id AND status = 'active'
            ORDER BY (role = 'lead') DESC, COALESCE(approved_at, requested_at) ASC
            LIMIT 1;

            IF v_member_id IS NOT NULL THEN
                UPDATE public.community_members SET role = 'admin' WHERE id = v_member_id;
            END IF;
        END IF;
    END LOOP;
END $$;

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Admin check — same shape as is_community_lead (2026-08-21), which this
-- does NOT replace (nothing currently reads role='lead' through it besides
-- the two policies below, both being repointed at this new function; left
-- defined, unreferenced, rather than dropped, in case a lead-specific check
-- is wanted again later).
CREATE OR REPLACE FUNCTION public.is_community_admin(p_community_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.community_members cm
        WHERE cm.community_id = p_community_id
          AND cm.user_id = p_uid
          AND cm.status = 'active'
          AND cm.role = 'admin'
    );
$$;

-- Create a community + its founding admin row in one transaction — same
-- move as create_project_with_lead (2026-08-06, extended below): a
-- SECURITY DEFINER function so there's no partial state (a community with
-- no admin, or an admin row with no community) to ever observe or roll
-- back. ALL COMMUNITIES ARE PRIVATE — is_open is hardcoded false here, not
-- a parameter; the open-community path from 2026-08-20/21 still exists in
-- the schema (is_open, the self-insert active-on-open-community branch)
-- for whatever already used it, but nothing new created through this
-- function can ever set it.
--
-- Slug: same idea as AgentSection's client-side slugify() (lowercase,
-- non-alphanumeric runs collapsed to '-', trimmed), done here in SQL
-- because it has to be checked against the live unique index anyway — on a
-- collision, a short random suffix is appended and it retries.
CREATE OR REPLACE FUNCTION public.create_community_with_admin(
    p_name        TEXT,
    p_description TEXT DEFAULT NULL
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
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'create_community_with_admin: no authenticated user';
    END IF;

    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'create_community_with_admin: name is required';
    END IF;

    -- `u.id`, not bare `id` — RETURNS TABLE (id UUID, slug TEXT) above puts
    -- an `id` OUT-parameter variable in scope for this whole function body,
    -- and an unqualified `id` here is ambiguous against public.users.id
    -- (42702, caught the first time this was actually run — see
    -- 2026-08-30_community_admin_membership_fix.sql).
    SELECT u.email INTO v_email FROM public.users u WHERE u.id = v_uid;

    v_base_slug := trim(both '-' from lower(regexp_replace(btrim(p_name), '[^a-zA-Z0-9]+', '-', 'g')));
    IF v_base_slug = '' THEN
        v_base_slug := 'community';
    END IF;

    v_slug := v_base_slug;
    WHILE EXISTS (SELECT 1 FROM public.communities c WHERE c.slug = v_slug) LOOP
        v_slug := v_base_slug || '-' || substr(md5(random()::text), 1, 5);
    END LOOP;

    INSERT INTO public.communities (slug, name, description, is_open)
    VALUES (v_slug, btrim(p_name), NULLIF(btrim(COALESCE(p_description, '')), ''), false)
    RETURNING communities.id INTO v_community_id;

    INSERT INTO public.community_members (
        community_id, user_id, email, role, status, approved_at, approved_by
    )
    VALUES (v_community_id, v_uid, COALESCE(v_email, ''), 'admin', 'active', now(), v_uid);

    RETURN QUERY SELECT v_community_id, v_slug;
END;
$$;

-- Existing-account lookup for the by-email add path — line-for-line the
-- same shape as find_account_id_by_email_for_project
-- (2026-08-19_link_existing_accounts.sql), admin-gated instead of
-- lead-gated. Reused pattern, not a second design: resolve now if the
-- account already exists (so the add is "a member immediately", fully
-- linked, no waiting), fall back to the unlinked-by-email row otherwise —
-- handle_new_user() (2026-08-21) already claims that row the moment the
-- email signs up, unchanged by this migration.
CREATE OR REPLACE FUNCTION public.find_account_id_by_email_for_community(
    p_community_id UUID,
    p_email        TEXT
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
    IF NOT public.is_community_admin(p_community_id, auth.uid()) THEN
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

-- Backstop reconciliation — same shape and same reason as
-- claim_pending_project_memberships (2026-08-19): handle_new_user() already
-- claims a matching unlinked row the moment its email signs up, but a
-- backstop that runs on read (called from listCommunities(), mirroring
-- listMyProjects()'s own call) catches anything that trigger ever misses.
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

    SELECT email INTO v_email
    FROM auth.users
    WHERE id = v_uid
      AND email_confirmed_at IS NOT NULL;

    IF v_email IS NULL THEN RETURN; END IF;

    UPDATE public.community_members
    SET user_id = v_uid
    WHERE user_id IS NULL
      AND lower(email) = lower(v_email);
END;
$$;

-- =============================================================================
-- TRIGGER: at least one admin, and only that admin may step themselves down
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enforce_community_admin_guard()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_acting_uid    UUID := auth.uid();
    v_other_admins  INTEGER;
BEGIN
    -- Only a row that WAS an active admin is restricted by this guard — a
    -- pending row, a lead, or a plain member can be updated/deleted freely
    -- (subject to the RLS policies that gate who may attempt it at all).
    IF OLD.role = 'admin' AND OLD.status = 'active'
       AND (TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NEW.status <> 'active')
    THEN
        -- Rule 1: nobody may remove or demote a DIFFERENT admin — only
        -- that admin may step themselves down. Independent of how many
        -- admins the community currently has.
        IF v_acting_uid IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION 'An admin cannot remove or demote another admin.';
        END IF;

        -- Rule 2: a community always keeps at least one admin — even the
        -- last admin stepping down themselves is blocked.
        SELECT COUNT(*) INTO v_other_admins
        FROM public.community_members
        WHERE community_id = OLD.community_id
          AND status = 'active'
          AND role = 'admin'
          AND id <> OLD.id;

        IF v_other_admins = 0 THEN
            RAISE EXCEPTION 'A community must always keep at least one admin.';
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_community_admin_guard ON public.community_members;
CREATE TRIGGER trg_enforce_community_admin_guard
    BEFORE UPDATE OR DELETE ON public.community_members
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_community_admin_guard();

-- =============================================================================
-- RLS: community_members — admin replaces lead as the membership manager
-- =============================================================================
-- SELECT: self, or admin. NOT lead any more — "do not expose member emails
-- to non-admins" means a lead sees exactly what a member sees: their own
-- row, nobody else's.
DROP POLICY IF EXISTS "Community members: self or lead select" ON public.community_members;
DROP POLICY IF EXISTS "Community members: self or admin select" ON public.community_members;
CREATE POLICY "Community members: self or admin select"
    ON public.community_members FOR SELECT
    TO authenticated
    USING (user_id = auth.uid() OR public.is_community_admin(community_id, auth.uid()));

-- INSERT (self-request, unchanged in shape from 2026-08-21) — now also
-- pins role = 'member': the original WITH CHECK never constrained role at
-- all, so a forged self-insert could previously request-to-join directly
-- as 'admin' or 'lead'. Every community is private now (is_open = false
-- for anything created through create_community_with_admin), so in
-- practice this is almost always the status='pending' branch — the
-- status='active'-on-an-open-community branch is kept only because
-- existing open communities (predating "all communities are private")
-- still rely on it.
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
            (status = 'active'
                AND EXISTS (SELECT 1 FROM public.communities c WHERE c.id = community_id AND c.is_open))
            OR
            (status = 'pending'
                AND EXISTS (SELECT 1 FROM public.communities c WHERE c.id = community_id AND NOT c.is_open))
        )
    );

-- INSERT (admin adds by email) — the second way in. Immediately active, no
-- approval step, role fixed to 'member' at add time (promoting to
-- lead/admin afterward goes through the UPDATE policy below, same as any
-- other promotion). user_id may already be resolved
-- (find_account_id_by_email_for_community) or left NULL for
-- handle_new_user()/claim_pending_community_memberships() to link later.
DROP POLICY IF EXISTS "Community members: admin insert by email" ON public.community_members;
CREATE POLICY "Community members: admin insert by email"
    ON public.community_members FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_community_admin(community_id, auth.uid())
        AND role = 'member'
        AND status = 'active'
        AND approved_by IS NULL
    );

-- UPDATE: admin manages membership — approve a pending request, promote or
-- demote a role, reject by... no, reject is a DELETE (see below); this is
-- approve/promote/demote only. Re-checked in both USING and WITH CHECK so
-- an admin can't rewrite community_id to touch a row outside their own
-- community.
DROP POLICY IF EXISTS "Community members: lead approves" ON public.community_members;
DROP POLICY IF EXISTS "Community members: admin manages" ON public.community_members;
CREATE POLICY "Community members: admin manages"
    ON public.community_members FOR UPDATE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()))
    WITH CHECK (public.is_community_admin(community_id, auth.uid()));

-- DELETE: self (leave, or withdraw a pending request — unchanged) OR admin
-- (reject a pending request, remove a member). The trigger above, not this
-- policy, is what actually stops an admin deleting a DIFFERENT admin's row
-- — this policy only decides who may attempt a delete at all.
DROP POLICY IF EXISTS "Community members: self delete" ON public.community_members;
DROP POLICY IF EXISTS "Community members: self or admin delete" ON public.community_members;
CREATE POLICY "Community members: self or admin delete"
    ON public.community_members FOR DELETE
    TO authenticated
    USING (user_id = auth.uid() OR public.is_community_admin(community_id, auth.uid()));

-- ── grants ───────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.is_community_admin(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_community_admin(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_community_admin(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.create_community_with_admin(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_community_with_admin(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_community_with_admin(TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.find_account_id_by_email_for_community(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_account_id_by_email_for_community(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_account_id_by_email_for_community(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_pending_community_memberships() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_pending_community_memberships() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_pending_community_memberships() TO authenticated;

-- =============================================================================
-- projects.community_id — nullable, ON DELETE SET NULL, same idiom as
-- collab_posts.community_id / lab_resources.community_id (2026-08-20)
-- =============================================================================
ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS community_id UUID REFERENCES public.communities (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_community ON public.projects (community_id);

-- A community member (not necessarily a project member) can see that a
-- project exists and its summary row — "a community page lists its
-- projects, members can see the list". Full project detail (checklist,
-- resources, shared folder, who-can-help) stays gated exactly as before:
-- project_members/checklist_items/etc. keep their own is_project_member-only
-- policies, untouched by this migration. A personal project
-- (community_id IS NULL) is completely unaffected — the OR below is only
-- ever reachable when community_id is set.
DROP POLICY IF EXISTS "Projects: member select" ON public.projects;
DROP POLICY IF EXISTS "Projects: member or community select" ON public.projects;
CREATE POLICY "Projects: member or community select"
    ON public.projects FOR SELECT
    USING (
        public.is_project_member(id, auth.uid())
        OR (community_id IS NOT NULL AND public.is_community_member(community_id, auth.uid()))
    );

-- create_project_with_lead — same append-only-parameter move as
-- 2026-08-24_description_capabilities_gate_version.sql's own extension of
-- this function, one more trailing DEFAULT NULL param. Also closes a real
-- gap while this function is already being replaced: its 2026-08-24 REVOKE
-- covered PUBLIC only, never explicitly anon (the standing rule this repo
-- has been bitten by five times) — fixed below alongside the new param,
-- not as a separate migration.
DROP FUNCTION IF EXISTS public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER
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
    p_description_capabilities_gate_version INTEGER DEFAULT NULL,
    p_community_id UUID DEFAULT NULL
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

    -- A project may only be linked to a community its creator is already a
    -- member of — checked here (SECURITY DEFINER, so this doesn't recurse
    -- into community_members' own RLS), not left to the projects INSERT
    -- policy, which never looks at community_id at all.
    IF p_community_id IS NOT NULL AND NOT public.is_community_member(p_community_id, v_uid) THEN
        RAISE EXCEPTION 'create_project_with_lead: not a member of that community';
    END IF;

    SELECT email INTO v_email FROM public.users WHERE id = v_uid;

    INSERT INTO public.projects (
        name, description, lead_id, deadline, challenge_key,
        target, indication, modality, stage,
        description_capabilities, description_capabilities_gate_version,
        community_id
    )
    VALUES (
        btrim(p_name), p_description, v_uid, p_deadline, p_challenge_key,
        p_target, p_indication, p_modality, p_stage,
        p_description_capabilities, p_description_capabilities_gate_version,
        p_community_id
    )
    RETURNING id INTO v_project_id;

    INSERT INTO public.project_members (project_id, email, user_id, role, added_by)
    VALUES (v_project_id, COALESCE(v_email, ''), v_uid, 'lead', v_uid);

    RETURN v_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER, UUID
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER, UUID
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER, UUID
) TO authenticated;
