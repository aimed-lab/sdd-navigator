-- =============================================================================
-- Migration: community_join  (2026-08-21)
-- =============================================================================
-- THE BUG: 2026-08-20_communities.sql shipped communities that can be READ by
-- everyone but never JOINED by anyone — community_members had no INSERT
-- policy at all, so neuro-oncology (is_open = false) was readable by all 133
-- people it was built for and postable by none of them. This migration adds
-- the missing join/request/leave/approve flow.
--
-- ── REPRESENTING A PENDING REQUEST: reused the community_members row itself,
-- not a second table. Two independent, orthogonal "not yet resolved" states
-- were already implicit in the shape of this table, and both map onto columns
-- rather than a new join_requests table:
--   * status ('active' | 'pending')      — has this been APPROVED to post?
--   * user_id (nullable) + email         — has this row been LINKED to an
--                                           account yet?
-- A join REQUEST into a closed community is simply a row with
-- status = 'pending': same identity (community_id + person), same fields
-- (who, when) as an approved membership, so it doesn't earn a separate table
-- with its own RLS and its own is_member-shaped function to keep in sync.
-- is_community_member() (redefined below) only counts status = 'active' rows
-- — a pending request grants no posting rights until a lead flips it.
--
-- The nullable-user_id + email + reconciliation-on-signup half of this is the
-- EXACT pattern project_members already uses (2026-08-04_projects.sql,
-- 2026-08-07_project_member_names.sql): a row can exist before the person has
-- an account (added by email — there, by a project lead; here, by this
-- migration's seed of the 133-person roster, see
-- 2026-08-21_neuro_oncology_seed.sql), a case-insensitive partial unique
-- index on (community_id, lower(email)) stops it being added twice, and
-- handle_new_user() (extended below, same function project_members already
-- extends) claims any matching unlinked rows by email the moment that person
-- signs up. Reused wholesale, not reinvented.
--
-- ── WHO APPROVES A REQUEST: community_members.role = 'lead' (already existed
-- as a free-text column with no reader — this migration gives it its first
-- one: is_community_lead()). A lead may UPDATE any row in their own
-- community (the approve action: pending -> active, approved_by/approved_at
-- set) but not their own status via the self-insert path — approved_by must
-- be NULL on insert, so nobody can self-approve by forging a row.
--
-- ── THE PUBLIC-READ REGRESSION THIS FIXES: 2026-08-20's community_members
-- SELECT policy was USING(true) — fine when the table held nothing but
-- (community_id, user_id, role, joined_at). It is NOT fine once rows can also
-- carry `email` for a person who hasn't signed up yet — that would publish
-- the neuro-oncology roster's email addresses to anon. This migration
-- narrows SELECT to "your own row, or a lead of that community" and moves the
-- one thing the public UI actually needs — activity counts — behind a new
-- SECURITY DEFINER function (community_member_stats) that returns aggregates
-- only, never a row, same posture as collab_post_interest_counts().
--
-- ── THE ANON-GRANT BUG, AGAIN: every CREATE FUNCTION in Postgres/Supabase
-- grants EXECUTE to PUBLIC (which includes anon) by default. This has now
-- caught this codebase four times. Every SECURITY DEFINER function touched or
-- added here gets an explicit `REVOKE ALL ... FROM PUBLIC` followed by
-- `REVOKE ALL ... FROM anon`, then an explicit, deliberate GRANT to exactly
-- the roles that should be able to call it — including re-revoking anon from
-- is_community_member() and can_post_to_community(), which 2026-08-20 granted
-- to anon unnecessarily (neither is ever called on behalf of a signed-out
-- request: every policy that uses them is already TO authenticated, or
-- requires auth.uid() = owner_id, which is null for anon regardless).
--
-- Run once in the Supabase SQL editor, AFTER 2026-08-20_communities.sql.
-- Idempotent — safe to re-run. NOT run against any database as part of
-- writing this file.
-- =============================================================================

-- ── community_members: reshape for pending/unlinked rows ────────────────────
-- Old PK was (community_id, user_id), which required user_id NOT NULL — a
-- row for someone without an account yet (the seed's whole point) couldn't
-- exist under that PK. Replaced with a surrogate id, same move
-- project_members made from the start.
ALTER TABLE public.community_members DROP CONSTRAINT IF EXISTS community_members_pkey;
ALTER TABLE public.community_members ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.community_members ADD CONSTRAINT community_members_pkey PRIMARY KEY (id);

ALTER TABLE public.community_members ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.community_members ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE public.community_members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.community_members DROP CONSTRAINT IF EXISTS community_members_status_check;
ALTER TABLE public.community_members
    ADD CONSTRAINT community_members_status_check CHECK (status IN ('active', 'pending'));

ALTER TABLE public.community_members ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.community_members ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.community_members ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.users (id);

-- `joined_at` (2026-08-20) predates `requested_at`/`approved_at` and is kept
-- for backward compatibility with anything already reading it, but is no
-- longer the field new code should reason from — requested_at is when the
-- row was created (join or request, same moment for an open community),
-- approved_at is when a lead flipped a request to active (NULL for a
-- self-joined open-community row and for the seed's already-active rows).

-- A user may belong to a community at most once by account, and at most once
-- by email before that account exists — mirrors
-- project_members_project_email_key (2026-08-04_projects.sql).
DROP INDEX IF EXISTS community_members_user_key;
CREATE UNIQUE INDEX community_members_user_key
    ON public.community_members (community_id, user_id) WHERE user_id IS NOT NULL;

DROP INDEX IF EXISTS community_members_email_key;
CREATE UNIQUE INDEX community_members_email_key
    ON public.community_members (community_id, lower(email)) WHERE email IS NOT NULL;

-- =============================================================================
-- ACCESS CONTROL
-- =============================================================================

-- Redefined (not new): only counts APPROVED membership now. A pending
-- request must not grant posting rights — this is the one line that makes
-- that true everywhere is_community_member() is already used
-- (can_post_to_community(), and therefore the collab_posts/lab_resources
-- insert policies from 2026-08-20, unchanged below).
CREATE OR REPLACE FUNCTION public.is_community_member(p_community_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT
        EXISTS (
            SELECT 1
            FROM public.community_members cm
            WHERE cm.community_id = p_community_id
              AND cm.user_id = p_uid
              AND cm.status = 'active'
        )
        OR EXISTS (
            SELECT 1
            FROM public.communities c
            JOIN public.projects p ON p.challenge_key = 'colabofest_2026'
            WHERE c.id = p_community_id
              AND c.slug = 'colabofest-2026'
              AND (
                  p.lead_id = p_uid
                  OR EXISTS (
                      SELECT 1 FROM public.project_members pm
                      WHERE pm.project_id = p.id AND pm.user_id = p_uid
                  )
              )
        );
$$;

-- Unchanged from 2026-08-20 — repeated here only so CREATE OR REPLACE isn't
-- needed; kept for reference. (No function body change; see grants below for
-- what DID change — the anon grant is revoked.)

-- NEW: is this uid an approved LEAD of this community? Gates the approve
-- action (community_members UPDATE) below. SECURITY DEFINER for the same
-- reason as is_project_lead() — lets the UPDATE policy on community_members
-- check community_members without the policy recursing into itself; STABLE
-- + a plain SELECT keeps it a leaf read, same shape as every other checker
-- function in this file.
CREATE OR REPLACE FUNCTION public.is_community_lead(p_community_id UUID, p_uid UUID)
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
          AND cm.role = 'lead'
    );
$$;

-- NEW: public activity counts. The community_members SELECT policy below is
-- narrowed to "your own row, or a lead" (it can no longer be USING(true) —
-- rows may carry a not-yet-account-linked person's email, see header). This
-- is the replacement read path for "how many members" — aggregates only,
-- never a row, same posture as collab_post_interest_counts()
-- (2026-07-26_collab_posts.sql). Deliberately public (anon included): a
-- signed-out visitor on a shared link should see the community is alive
-- before being asked to sign in (see app-layer changes, not this file).
CREATE OR REPLACE FUNCTION public.community_member_stats(p_community_id UUID)
    RETURNS TABLE (member_count BIGINT, joined_last_7d BIGINT)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT
        COUNT(*) FILTER (WHERE cm.status = 'active'),
        COUNT(*) FILTER (
            WHERE cm.status = 'active'
              AND COALESCE(cm.approved_at, cm.requested_at) >= now() - INTERVAL '7 days'
        )
    FROM public.community_members cm
    WHERE cm.community_id = p_community_id;
$$;

-- community_members: replace the public-read policy with self-or-lead. This
-- is a NARROWING relative to 2026-08-20 (see header) — the public count a
-- visitor needs now comes from community_member_stats() above instead.
DROP POLICY IF EXISTS "Community members: public select" ON public.community_members;
DROP POLICY IF EXISTS "Community members: self or lead select" ON public.community_members;
CREATE POLICY "Community members: self or lead select"
    ON public.community_members FOR SELECT
    TO authenticated
    USING (user_id = auth.uid() OR public.is_community_lead(community_id, auth.uid()));

-- Join / request. One row, self-only, never self-approved:
--   * open community  -> may insert status = 'active' directly (join).
--   * closed community -> may insert ONLY status = 'pending' (request).
-- approved_by/approved_at must be NULL on insert either way — the only path
-- that ever sets them is the lead-approve UPDATE policy below.
DROP POLICY IF EXISTS "Community members: self insert" ON public.community_members;
CREATE POLICY "Community members: self insert"
    ON public.community_members FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
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

-- Approve. Lead-only, and only within their own community — is_community_lead
-- re-checked in BOTH USING (which row can even be touched) and WITH CHECK
-- (what the row can become), so a lead can't use this to grant themselves a
-- second community's leadership by editing community_id on someone else's row.
DROP POLICY IF EXISTS "Community members: lead approves" ON public.community_members;
CREATE POLICY "Community members: lead approves"
    ON public.community_members FOR UPDATE
    TO authenticated
    USING (public.is_community_lead(community_id, auth.uid()))
    WITH CHECK (public.is_community_lead(community_id, auth.uid()));

-- Leave. Self-only, any status (a pending request can be withdrawn the same
-- way an active membership can be left).
DROP POLICY IF EXISTS "Community members: self delete" ON public.community_members;
CREATE POLICY "Community members: self delete"
    ON public.community_members FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

-- ── Fix the anon over-grants (2026-08-20) + grant the new functions ────────
-- Every REVOKE ALL below covers PUBLIC first (which is where the implicit
-- Postgres/Supabase default grant lands), then anon explicitly, per the
-- standing rule — even though revoking PUBLIC already removes anon's access,
-- an explicit second REVOKE FROM anon is the actual habit being enforced
-- here and is not a no-op if anon was ever granted directly.
REVOKE ALL ON FUNCTION public.is_community_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_community_member(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_community_member(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.can_post_to_community(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_post_to_community(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_post_to_community(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.is_community_lead(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_community_lead(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_community_lead(UUID, UUID) TO authenticated;

-- community_member_stats is the one function here that DOES need anon —
-- it's the public activity read (see its own comment above) — granted
-- deliberately, not by default: explicit REVOKE FROM PUBLIC/anon first, then
-- an explicit GRANT back to both roles.
REVOKE ALL ON FUNCTION public.community_member_stats(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_member_stats(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.community_member_stats(UUID) TO anon, authenticated;

-- =============================================================================
-- handle_new_user — extended again to claim pending community_members rows
-- =============================================================================
-- Full replacement, same pattern as 2026-08-04_projects.sql's own extension
-- of this function: same SECURITY DEFINER / search_path, same users-insert
-- and project_members-claim behavior, with one addition — claim any
-- community_members rows (added by email, user_id still NULL: the seed in
-- 2026-08-21_neuro_oncology_seed.sql, or any future by-email add) whose email
-- matches the new signup.
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

    -- Claim any community_members rows added by email before this user had
    -- an account (the neuro-oncology roster seed, or a future by-email add).
    UPDATE public.community_members
    SET user_id = NEW.id
    WHERE user_id IS NULL
      AND lower(email) = lower(NEW.email);

    RETURN NEW;
END;
$$;

-- Trigger already exists (created in schema.sql, re-pointed by
-- 2026-08-04_projects.sql) and points at this same function name/signature,
-- so no DROP/CREATE TRIGGER needed here — the CREATE OR REPLACE FUNCTION
-- above is enough to pick up the new behavior.
