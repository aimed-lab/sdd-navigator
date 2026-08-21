-- =============================================================================
-- Migration: communities  (2026-08-20)
-- =============================================================================
-- WHY: the UAB Neuro-oncology group (133 members) asked for a way to share lab
-- expertise/techniques/resources after their spring retreat. Their lead
-- circulated a Box spreadsheet on 2026-07-20 with nine sheets for exactly this
-- purpose; a month later it's still headers-only, zero rows across all nine
-- sheets. The container wasn't the problem — effort was. This migration adds a
-- thin "community" grouping on TOP of the two things that already exist
-- (the Collaborate board and the lab_resources registry) rather than a new
-- feature, specifically so a community starts useful with zero posts and zero
-- resources: low friction, obvious what to add, no new surface to learn.
--
-- ── communities ──────────────────────────────────────────────────────────────
-- A small, curated list (not user-creatable in v1 — there is no "create
-- community" UI/action anywhere in this change). Seeded with exactly three
-- rows below. `is_open` decides how posting works (see the RLS section):
--   * TRUE  — any authenticated user may post/register a resource into it.
--   * FALSE — posting requires a community_members row (see below).
--
-- ── community_members ────────────────────────────────────────────────────────
-- Same shape as project_members (2026-08-04_projects.sql): who belongs to a
-- community. PK is (community_id, user_id) — a user has exactly one
-- membership row per community, `role` is a plain text label (e.g. 'member',
-- 'lead'), not constrained to a fixed set, since community roles aren't acted
-- on anywhere yet (unlike project_members.role, which is checked by
-- is_project_lead()). Nothing in this migration writes to this table for the
-- neuro-oncology or biokdd communities — those start with zero members, same
-- as their zero posts/resources; a human (service role, from the Supabase
-- dashboard) adds members by hand until an invite/join flow exists. ColaboFest
-- is the one community whose membership is instead DERIVED (see below), so it
-- never needs rows here at all.
--
-- ── collab_posts.community_id / lab_resources.community_id ─────────────────
-- Both nullable, additive, same idiom as every other optional link in this
-- codebase (collab_posts.checklist_item_id, promote_showcase.project_id,
-- etc.) — posting or registering a resource with NO community keeps working
-- exactly as it does today.
--
-- ── ASSUMPTIONS (recorded here because the task asked to note them) ────────
-- 1. is_open seed values: colabofest-2026 = TRUE (a hackathon-style event —
--    open participation is the whole point, and membership is derived from a
--    project anyway, see #2), biokdd = TRUE (a workshop/community track,
--    treated as open the same way ColaboFest is — no roster of who's "in"
--    BioKDD exists anywhere in this schema), neuro-oncology = FALSE (this is
--    the actual UAB group the feature was built for; posting on their behalf
--    should require being one of the 133 members, added via
--    community_members, not open to any signed-in stranger).
-- 2. ColaboFest membership is DERIVED, not stored: a user is a ColaboFest
--    member iff they lead or belong to (project_members) at least one
--    `projects` row with challenge_key = 'colabofest_2026' — that value
--    already exists and is actively used (see
--    database/migrations/2026-08-06_create_project_with_lead.sql and
--    2026-08-12_colabofest_checklist_seed.sql). NOTE: this contradicts
--    CLAUDE.md's "projects is effectively a dead table" — that claim is
--    stale for `projects.challenge_key` specifically; the migrations above
--    show it's live. Confirmed via schema.sql + migrations before writing
--    this, per this file's own instruction to verify rather than assume.
-- 3. community_members.role is free text, unconstrained (no CHECK), because
--    nothing in this change reads it to gate an action — unlike
--    project_members.role / is_project_lead(). Kept only so a future
--    "who's the community lead" feature has a place to read from without a
--    new migration.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run. NOT run
-- against any database as part of writing this file.
-- =============================================================================

-- ── TABLE: communities ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.communities (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    slug        TEXT        NOT NULL,
    name        TEXT        NOT NULL,
    description TEXT,
    is_open     BOOLEAN     NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT communities_pkey PRIMARY KEY (id)
);

DROP INDEX IF EXISTS communities_slug_key;
CREATE UNIQUE INDEX communities_slug_key ON public.communities (slug);

-- ── TABLE: community_members ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_members (
    community_id UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    user_id      UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    role         TEXT        NOT NULL DEFAULT 'member',
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT community_members_pkey PRIMARY KEY (community_id, user_id)
);

-- ── SEED: exactly three communities ─────────────────────────────────────────
INSERT INTO public.communities (slug, name, description, is_open)
VALUES
    ('colabofest-2026', 'ColaboFest 2026',
     'The annual cross-lab hackathon — open to anyone entering a project with '
     || 'the ColaboFest challenge. Membership follows your project, not a '
     || 'separate signup.',
     true),
    ('biokdd', 'BioKDD',
     'Community track for biomedical knowledge discovery and data mining — '
     || 'share techniques, tools, and datasets across labs working the same '
     || 'problems.',
     true),
    ('neuro-oncology', 'UAB Neuro-oncology',
     'The UAB Neuro-oncology group''s shared space for lab expertise, '
     || 'techniques, and resources — the successor to the spring-retreat '
     || 'spreadsheet. Posting requires being a member of the group.',
     false)
ON CONFLICT (slug) DO NOTHING;

-- ── LINKS INTO EXISTING TABLES ────────────────────────────────────────────
ALTER TABLE public.collab_posts
    ADD COLUMN IF NOT EXISTS community_id UUID
        REFERENCES public.communities (id) ON DELETE SET NULL;

ALTER TABLE public.lab_resources
    ADD COLUMN IF NOT EXISTS community_id UUID
        REFERENCES public.communities (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_collab_posts_community    ON public.collab_posts (community_id);
CREATE INDEX IF NOT EXISTS idx_lab_resources_community   ON public.lab_resources (community_id);
CREATE INDEX IF NOT EXISTS idx_community_members_user    ON public.community_members (user_id);

-- =============================================================================
-- ACCESS CONTROL
-- =============================================================================

-- SECURITY DEFINER, same reasoning as is_project_member() /
-- is_project_lead() (2026-08-04_projects.sql): lets the policy on
-- community_members (and the write policies on collab_posts/lab_resources)
-- check membership without a policy-on-policy recursion.
--
-- Covers BOTH storage forms of membership:
--   * an explicit community_members row, for ordinary communities, OR
--   * for ColaboFest specifically, a `projects` row with
--     challenge_key = 'colabofest_2026' that this user leads or belongs to
--     (project_members) — see assumption #2 above. Matched by the
--     community's slug, not a hardcoded id, so this keeps working across
--     environments where communities.id differs.
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

-- Whether p_uid may INSERT a post/resource tagged with p_community_id:
-- membership (is_community_member, including the derived ColaboFest form
-- above) OR the community is open. NULL community_id is handled by the
-- callers (the policies below), not here — an untagged post/resource never
-- calls this function at all.
CREATE OR REPLACE FUNCTION public.can_post_to_community(p_community_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.communities c
        WHERE c.id = p_community_id
          AND (c.is_open OR public.is_community_member(p_community_id, p_uid))
    );
$$;

ALTER TABLE public.communities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;

-- ── communities: everyone (incl. anon) reads ────────────────────────────────
DROP POLICY IF EXISTS "Communities: public select" ON public.communities;
CREATE POLICY "Communities: public select"
    ON public.communities FOR SELECT
    USING (true);
-- No INSERT/UPDATE/DELETE policy: communities are curated by the service
-- role (dashboard), not app-writable in v1 — same posture as `providers`.

-- ── community_members: everyone (incl. anon) reads ──────────────────────────
-- Deliberately public, unlike project_members (member-only): a community
-- roster is meant to be browsable ("who's already in this group") the same
-- way the Collaborate board itself is public. No email or other PII lives on
-- this table — just user_id, so a client wanting to *display* a member's
-- name would still go through public.users' own (is_public-gated) rules.
DROP POLICY IF EXISTS "Community members: public select" ON public.community_members;
CREATE POLICY "Community members: public select"
    ON public.community_members FOR SELECT
    USING (true);
-- No INSERT/UPDATE/DELETE policy here either: membership rows are managed by
-- the service role for now (there is no "join community" action in this
-- change) — ColaboFest needs none at all, since its membership is derived.

-- ── collab_posts: extend the existing owner-insert policy ──────────────────
-- Same owner check as before (auth.uid() = owner_id), PLUS: if the post
-- tags a community, the poster must be allowed to post there
-- (can_post_to_community — membership, or an open community). Untagged
-- posts (community_id IS NULL) are completely unaffected.
DROP POLICY IF EXISTS "collab_posts_insert_own" ON public.collab_posts;
CREATE POLICY "collab_posts_insert_own"
    ON public.collab_posts FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = owner_id
        AND (
            community_id IS NULL
            OR public.can_post_to_community(community_id, auth.uid())
        )
    );

-- ── lab_resources: extend the existing owner-insert policy ─────────────────
DROP POLICY IF EXISTS "authenticated users can insert own resource" ON public.lab_resources;
CREATE POLICY "authenticated users can insert own resource"
    ON public.lab_resources FOR INSERT
    WITH CHECK (
        auth.uid() = owner_id
        AND (
            community_id IS NULL
            OR public.can_post_to_community(community_id, auth.uid())
        )
    );

REVOKE ALL ON FUNCTION public.is_community_member(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_community_member(UUID, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.can_post_to_community(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_post_to_community(UUID, UUID) TO anon, authenticated;
