-- =============================================================================
-- SDD Navigator — Consolidated dev schema (NO DATA)
-- =============================================================================
-- Hand-built by reading database/schema.sql plus every one of the 58 files in
-- database/migrations/ (2026-07-14 .. 2026-09-22) and collapsing them to the
-- FINAL state — one CREATE TABLE per table, one CREATE POLICY per policy
-- (last definition only), one CREATE FUNCTION per function. Pure one-off data
-- fixes/backfills and anything superseded by a later migration are NOT
-- replayed here; see this task's final report for the full per-migration
-- classification.
--
-- Run this in the Supabase SQL editor on a brand-new, empty project, top to
-- bottom. Idempotent: CREATE ... IF NOT EXISTS / DROP POLICY IF EXISTS /
-- DROP FUNCTION IF EXISTS before CREATE guards mean it can be re-run without
-- error. auth.users is managed by Supabase Auth and is not created here.
--
-- ORDERING NOTE: tables are created in dependency order (a table's foreign
-- keys always point at a table already created above it), which is NOT the
-- same order database/schema.sql or the migrations used historically —
-- `communities` in particular is created early here (right after `users`)
-- because `projects`, `collab_posts`, `lab_resources`, and `promote_showcase`
-- all carry a nullable `community_id` FK into it.
--
-- Run supabase/dev-setup/02_storage.sql SEPARATELY, AFTER this file — see
-- that file's own header for why storage.objects DDL must never share a
-- transaction with the tables below.
--
-- ONE DELIBERATE JUDGMENT CALL, flagged here and in the final report: the
-- ORIGINAL database/schema.sql defines `public.projects` as the old Navigator
-- "saved proposal" table (id, user_id, title, input_data, output_data). Every
-- migration from 2026-08-04 onward instead builds a completely different
-- "team project workspace" `public.projects` (name, lead_id, challenge_key,
-- target/indication/modality/stage, ...). Dozens of later migrations
-- (checklist_items, project_members, wiki_notes, project_evidence_items,
-- communities' derived ColaboFest membership, etc.) are unusable unless
-- `projects` actually has the NEW shape — and 2026-08-20_communities.sql's own
-- header explicitly notes this, correcting CLAUDE.md's "projects is a dead
-- table" claim as stale for `challenge_key` specifically. This file therefore
-- defines `projects` with the NEW (team workspace) shape only, treating the
-- old input_data/output_data Navigator-proposal shape as retired/superseded.
-- =============================================================================


-- =============================================================================
-- EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid() on older PG versions


-- =============================================================================
-- TABLE: users
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.users (
    id             UUID        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    name           TEXT,
    email          TEXT        NOT NULL DEFAULT '',
    title          TEXT,
    affiliation    TEXT,
    institution    TEXT,
    country        TEXT,
    bio            TEXT,
    research_focus TEXT,
    linkedin_url   TEXT,
    website_url    TEXT,
    scholar_url    TEXT,
    orcid_url      TEXT,
    github_url     TEXT,
    interests      TEXT[]      DEFAULT '{}',
    expertise      TEXT[]      DEFAULT '{}',
    is_public      BOOLEAN     NOT NULL DEFAULT false,
    profile_slug   TEXT        UNIQUE,
    notify_weekly  BOOLEAN     NOT NULL DEFAULT false,
    notify_daily   BOOLEAN     NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users: own row" ON public.users;
CREATE POLICY "Users: own row"
    ON public.users FOR ALL
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users: insert own row" ON public.users;
CREATE POLICY "Users: insert own row"
    ON public.users FOR INSERT
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users: public read for public profiles" ON public.users;
CREATE POLICY "Users: public read for public profiles"
    ON public.users FOR SELECT
    USING (is_public = true);


-- =============================================================================
-- TABLE: communities  (created early: projects/collab_posts/lab_resources/
-- promote_showcase all carry a nullable community_id FK into this table)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.communities (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    slug        TEXT        NOT NULL,
    name        TEXT        NOT NULL,
    description TEXT,
    is_open     BOOLEAN     NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Section ordering (2026-08-31) — NULL = show everything, default order.
    sections    JSONB,
    -- Explore feed config (2026-09-06 / 2026-09-17)
    explore_sources TEXT[]  NOT NULL DEFAULT '{}',
    explore_topics  TEXT[]  NOT NULL DEFAULT '{}',
    explore_refreshed_at TIMESTAMPTZ,
    explore_paper_scope TEXT NOT NULL DEFAULT 'all',
    explore_grant_activity_codes TEXT[] NOT NULL DEFAULT '{}',
    -- Signed-out / non-member preview level (2026-09-18 / 2026-09-20)
    public_preview TEXT     NOT NULL DEFAULT 'standard',
    CONSTRAINT communities_pkey PRIMARY KEY (id)
);

DROP INDEX IF EXISTS communities_slug_key;
CREATE UNIQUE INDEX communities_slug_key ON public.communities (slug);

ALTER TABLE public.communities DROP CONSTRAINT IF EXISTS communities_explore_paper_scope_check;
ALTER TABLE public.communities
    ADD CONSTRAINT communities_explore_paper_scope_check
        CHECK (explore_paper_scope IN ('all', 'clinical'));

ALTER TABLE public.communities DROP CONSTRAINT IF EXISTS communities_public_preview_check;
ALTER TABLE public.communities
    ADD CONSTRAINT communities_public_preview_check
        CHECK (public_preview IN ('standard', 'minimal', 'open'));

ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Communities: public select" ON public.communities;
CREATE POLICY "Communities: public select"
    ON public.communities FOR SELECT
    USING (true);
-- UPDATE / DELETE policies are created further below, after
-- is_community_admin() exists.


-- =============================================================================
-- TABLE: community_members
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.community_members (
    community_id UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    user_id      UUID        REFERENCES public.users (id) ON DELETE CASCADE,
    role         TEXT        NOT NULL DEFAULT 'member',
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    email        TEXT,
    status       TEXT        NOT NULL DEFAULT 'active',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at  TIMESTAMPTZ,
    approved_by  UUID        REFERENCES public.users (id),
    -- Per-membership research focus (2026-09-13), self- or admin-settable.
    focus        TEXT,
    -- Keep a member out of a public/member-facing roster without touching
    -- their membership itself (2026-09-14).
    hidden       BOOLEAN     NOT NULL DEFAULT false,
    -- Admin-set display name for a not-yet-signed-in member (2026-09-15).
    display_name TEXT,
    CONSTRAINT community_members_pkey PRIMARY KEY (id)
);

ALTER TABLE public.community_members DROP CONSTRAINT IF EXISTS community_members_role_check;
ALTER TABLE public.community_members
    ADD CONSTRAINT community_members_role_check CHECK (role IN ('admin', 'lead', 'member'));

ALTER TABLE public.community_members DROP CONSTRAINT IF EXISTS community_members_status_check;
ALTER TABLE public.community_members
    ADD CONSTRAINT community_members_status_check CHECK (status IN ('active', 'pending'));

DROP INDEX IF EXISTS community_members_user_key;
CREATE UNIQUE INDEX community_members_user_key
    ON public.community_members (community_id, user_id) WHERE user_id IS NOT NULL;

DROP INDEX IF EXISTS community_members_email_key;
CREATE UNIQUE INDEX community_members_email_key
    ON public.community_members (community_id, lower(email)) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_community_members_user ON public.community_members (user_id);

ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
-- All community_members policies are created further below, after
-- is_community_admin() exists (every one of them calls it).


-- =============================================================================
-- TABLE: researcher_works
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.researcher_works (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    user_id     UUID        REFERENCES public.users (id),
    type        TEXT,
    title       TEXT,
    description TEXT,
    url         TEXT,
    year        INTEGER,
    created_at  TIMESTAMPTZ DEFAULT now(),
    journal     TEXT,
    CONSTRAINT researcher_works_pkey PRIMARY KEY (id)
);

ALTER TABLE public.researcher_works ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Works: public read" ON public.researcher_works;
CREATE POLICY "Works: public read"
    ON public.researcher_works FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Works: own insert" ON public.researcher_works;
CREATE POLICY "Works: own insert"
    ON public.researcher_works FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Works: own delete" ON public.researcher_works;
CREATE POLICY "Works: own delete"
    ON public.researcher_works FOR DELETE
    USING (auth.uid() = user_id);


-- =============================================================================
-- TABLE: wiki_pages
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.wiki_pages (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug           TEXT        NOT NULL UNIQUE,
    title          TEXT        NOT NULL,
    episode_number INTEGER     UNIQUE,
    transcript     TEXT,
    episode_url    TEXT,
    image_url      TEXT,
    description    TEXT,
    summary        TEXT[]      DEFAULT '{}',
    concepts       JSONB       DEFAULT '[]',
    tags           TEXT[]      DEFAULT '{}',
    entities       JSONB       DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wiki_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Wiki pages: public read" ON public.wiki_pages;
CREATE POLICY "Wiki pages: public read"
    ON public.wiki_pages FOR SELECT
    USING (true);

-- Only the service-role key (backend pipeline) writes rows; no INSERT/UPDATE/
-- DELETE policy exists, so RLS denies those by default for anon/authenticated.


-- =============================================================================
-- TABLE: nodes / edges (knowledge graph — see CLAUDE.md: no current frontend
-- consumer, kept because backend/podcast-agent still writes them)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.nodes (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    label       TEXT        NOT NULL,
    type        TEXT        NOT NULL CHECK (type IN ('episode', 'concept', 'resource')),
    description TEXT
);

ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Nodes: public read" ON public.nodes;
CREATE POLICY "Nodes: public read"
    ON public.nodes FOR SELECT
    USING (true);

CREATE TABLE IF NOT EXISTS public.edges (
    source_id    UUID        NOT NULL REFERENCES public.nodes (id) ON DELETE CASCADE,
    target_id    UUID        NOT NULL REFERENCES public.nodes (id) ON DELETE CASCADE,
    relationship TEXT        NOT NULL,
    CONSTRAINT edges_pkey PRIMARY KEY (source_id, target_id, relationship)
);

ALTER TABLE public.edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Edges: public read" ON public.edges;
CREATE POLICY "Edges: public read"
    ON public.edges FOR SELECT
    USING (true);


-- =============================================================================
-- TABLE: providers (CLAUDE.md: effectively dead — no reader/writer left in
-- frontend/. Table kept for schema parity; NO seed data inserted here, see
-- final report — the seed in database/schema.sql is optional demo data, not
-- something the app requires to boot.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.providers (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name               TEXT        NOT NULL,
    country            TEXT,
    type               TEXT        NOT NULL DEFAULT 'external' CHECK (type IN ('internal', 'external')),
    speciality         TEXT,
    capabilities       TEXT[]      NOT NULL DEFAULT '{}',
    tools              TEXT[]      NOT NULL DEFAULT '{}',
    estimated_cost     TEXT,
    estimated_timeline TEXT,
    is_free            BOOLEAN     NOT NULL DEFAULT false,
    verified           BOOLEAN     NOT NULL DEFAULT false,
    stage_tags         TEXT[],
    contact            TEXT,
    contact_email      TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Providers: public read" ON public.providers;
CREATE POLICY "Providers: public read"
    ON public.providers FOR SELECT
    USING (true);


-- =============================================================================
-- TABLE: comments
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.comments (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    wiki_id    UUID        NOT NULL REFERENCES public.wiki_pages (id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES public.users (id)      ON DELETE CASCADE,
    content    TEXT        NOT NULL CHECK (char_length(content) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comments: public read" ON public.comments;
CREATE POLICY "Comments: public read"
    ON public.comments FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Comments: own insert" ON public.comments;
CREATE POLICY "Comments: own insert"
    ON public.comments FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Comments: own delete" ON public.comments;
CREATE POLICY "Comments: own delete"
    ON public.comments FOR DELETE
    USING (auth.uid() = user_id);


-- =============================================================================
-- TABLE: projects — team project workspace (see file header for the
-- old-vs-new-shape judgment call)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.projects (
    id                     UUID        NOT NULL DEFAULT gen_random_uuid(),
    name                   TEXT        NOT NULL,
    description            TEXT,
    lead_id                UUID        REFERENCES public.users (id),
    deadline               TIMESTAMPTZ,
    challenge_key          TEXT,
    shared_folder_url      TEXT,
    shared_folder_set_by   UUID        REFERENCES public.users (id),
    shared_folder_set_at   TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Programme details (2026-08-05) — all optional, free text except the two CHECKs below.
    target                 TEXT,
    indication             TEXT,
    modality               TEXT,
    stage                  TEXT,
    -- Description capability classification (2026-08-24) — NULL = "not assessed yet".
    description_capabilities TEXT[],
    description_capabilities_gate_version INTEGER,
    -- Community link (2026-08-30) — nullable, ON DELETE SET NULL.
    community_id           UUID        REFERENCES public.communities (id) ON DELETE SET NULL,
    CONSTRAINT projects_pkey PRIMARY KEY (id)
);

ALTER TABLE public.projects
    DROP CONSTRAINT IF EXISTS projects_modality_check;
ALTER TABLE public.projects
    ADD CONSTRAINT projects_modality_check
        CHECK (modality IS NULL OR modality IN
               ('small_molecule', 'biologic', 'protac', 'aso_rna', 'cell_therapy', 'other'));

ALTER TABLE public.projects
    DROP CONSTRAINT IF EXISTS projects_stage_check;
ALTER TABLE public.projects
    ADD CONSTRAINT projects_stage_check
        CHECK (stage IS NULL OR stage IN
               ('target_id', 'hit_finding', 'lead_opt', 'preclinical', 'ind_enabling'));

CREATE INDEX IF NOT EXISTS idx_projects_community ON public.projects (community_id);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
-- SELECT/INSERT/UPDATE/DELETE policies are created further below, after
-- is_project_member()/is_project_creator()/is_community_member() exist.


-- =============================================================================
-- TABLE: project_members
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.project_members (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id  UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    email       TEXT        NOT NULL,
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

DROP INDEX IF EXISTS project_members_pending_email_idx;
CREATE INDEX project_members_pending_email_idx
    ON public.project_members (lower(email))
    WHERE user_id IS NULL;

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- TABLE: checklist_items
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.checklist_items (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id  UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    label       TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'not_yet',
    position    INTEGER     NOT NULL DEFAULT 0,
    updated_by  UUID        REFERENCES public.users (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Stored provider-capability classification (2026-08-19) — '{}' = "no
    -- capabilities matched", the safe default for both new and never-classified rows.
    matched_capabilities TEXT[] NOT NULL DEFAULT '{}',
    CONSTRAINT checklist_items_pkey PRIMARY KEY (id),
    CONSTRAINT checklist_items_status_check
        CHECK (status IN ('not_yet', 'in_progress', 'ready'))
);

ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- TABLE: project_proposals
-- =============================================================================
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

ALTER TABLE public.project_proposals ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- TABLE: project_digests
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.project_digests (
    project_id    UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    markdown      TEXT        NOT NULL,
    generated_at  TIMESTAMPTZ NOT NULL,
    counts        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    goal_text     TEXT        NOT NULL,
    saved_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_digests_pkey PRIMARY KEY (project_id)
);

ALTER TABLE public.project_digests ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- TABLE: wiki_notes
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.wiki_notes (
    id               UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id       UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    slug             TEXT        NOT NULL,
    title            TEXT        NOT NULL,
    body             TEXT        NOT NULL DEFAULT '',
    note_type        TEXT        NOT NULL,
    is_human_edited  BOOLEAN     NOT NULL DEFAULT false,
    updated_by       UUID        REFERENCES public.users (id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_notes_pkey PRIMARY KEY (id),
    CONSTRAINT wiki_notes_project_slug_unique UNIQUE (project_id, slug),
    CONSTRAINT wiki_notes_note_type_check
        CHECK (note_type IN ('concept', 'entity', 'question'))
);

CREATE INDEX IF NOT EXISTS wiki_notes_project_id_idx ON public.wiki_notes (project_id);

ALTER TABLE public.wiki_notes ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- TABLE: project_evidence_items / wiki_note_evidence
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.project_evidence_items (
    id             UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id     UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    item_id        TEXT        NOT NULL,
    kind           TEXT        NOT NULL,
    title          TEXT        NOT NULL,
    summary        TEXT,
    url            TEXT,
    source         TEXT        NOT NULL,
    date_iso       TEXT,
    signal_metric  TEXT,
    signal_value   DOUBLE PRECISION,
    signal_as_of   TEXT,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_evidence_items_pkey PRIMARY KEY (id),
    CONSTRAINT project_evidence_items_project_item_unique UNIQUE (project_id, item_id)
);

CREATE INDEX IF NOT EXISTS project_evidence_items_project_id_idx
    ON public.project_evidence_items (project_id);

ALTER TABLE public.project_evidence_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.wiki_note_evidence (
    note_id            UUID        NOT NULL REFERENCES public.wiki_notes (id) ON DELETE CASCADE,
    evidence_item_id   UUID        NOT NULL REFERENCES public.project_evidence_items (id) ON DELETE CASCADE,
    project_id         UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    rationale          TEXT,
    filed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_note_evidence_pkey PRIMARY KEY (note_id, evidence_item_id)
);

CREATE INDEX IF NOT EXISTS wiki_note_evidence_evidence_item_id_idx
    ON public.wiki_note_evidence (evidence_item_id);

ALTER TABLE public.wiki_note_evidence ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- TABLE: saved_items
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.saved_items (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    item_id    TEXT        NOT NULL,
    item_data  JSONB       NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- project_id (2026-08-09) — nullable; NULL = personal save.
    project_id UUID        REFERENCES public.projects (id) ON DELETE CASCADE
);

-- The original inline UNIQUE (user_id, item_id) from database/schema.sql was
-- replaced (2026-08-11) by the two partial unique indexes below — never
-- created here at all, so there is nothing to DROP CONSTRAINT for in a fresh
-- project.
CREATE UNIQUE INDEX IF NOT EXISTS saved_items_personal_unique
    ON public.saved_items (user_id, item_id)
    WHERE project_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS saved_items_project_unique
    ON public.saved_items (user_id, item_id, project_id)
    WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_items_user       ON public.saved_items (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_items_project_id ON public.saved_items (project_id) WHERE project_id IS NOT NULL;

ALTER TABLE public.saved_items ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- TABLE: collab_posts
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.collab_posts (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    title          TEXT        NOT NULL,
    description    TEXT        NOT NULL DEFAULT '',
    research_areas TEXT[]      NOT NULL DEFAULT '{}',
    haves          TEXT[]      NOT NULL DEFAULT '{}',
    needs          TEXT[]      NOT NULL DEFAULT '{}',
    stage          TEXT        NOT NULL DEFAULT 'concept'
                        CHECK (stage IN ('concept', 'early_data', 'validation',
                                         'preclinical', 'seeking_team')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- funding_status (2026-07-28) — optional, nullable, no default.
    funding_status TEXT,
    -- checklist_item_id (2026-08-04) — one-click bridge from a checklist item.
    checklist_item_id UUID     REFERENCES public.checklist_items (id) ON DELETE SET NULL,
    -- community_id (2026-08-20) — nullable, ON DELETE SET NULL.
    community_id   UUID        REFERENCES public.communities (id) ON DELETE SET NULL
);

ALTER TABLE public.collab_posts
    DROP CONSTRAINT IF EXISTS collab_posts_funding_status_check;
ALTER TABLE public.collab_posts
    ADD CONSTRAINT collab_posts_funding_status_check
        CHECK (funding_status IS NULL OR funding_status IN
               ('funded', 'applying', 'unfunded'));

ALTER TABLE public.collab_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "collab_posts_public_select" ON public.collab_posts;
CREATE POLICY "collab_posts_public_select"
    ON public.collab_posts FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "collab_posts_update_own" ON public.collab_posts;
CREATE POLICY "collab_posts_update_own"
    ON public.collab_posts FOR UPDATE
    TO authenticated
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "collab_posts_delete_own" ON public.collab_posts;
CREATE POLICY "collab_posts_delete_own"
    ON public.collab_posts FOR DELETE
    TO authenticated
    USING (auth.uid() = owner_id);
-- collab_posts_insert_own is created further below, after
-- can_post_to_community() exists.

CREATE INDEX IF NOT EXISTS idx_collab_posts_created ON public.collab_posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_posts_owner   ON public.collab_posts (owner_id);
CREATE INDEX IF NOT EXISTS idx_collab_posts_stage   ON public.collab_posts (stage);
CREATE INDEX IF NOT EXISTS idx_collab_posts_areas   ON public.collab_posts USING GIN (research_areas);
CREATE INDEX IF NOT EXISTS idx_collab_posts_haves   ON public.collab_posts USING GIN (haves);
CREATE INDEX IF NOT EXISTS idx_collab_posts_needs   ON public.collab_posts USING GIN (needs);
CREATE INDEX IF NOT EXISTS idx_collab_posts_community ON public.collab_posts (community_id);
CREATE INDEX IF NOT EXISTS idx_collab_posts_funding_status
    ON public.collab_posts (funding_status)
    WHERE funding_status IS NOT NULL;


-- =============================================================================
-- TABLE: connection_requests
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.connection_requests (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES auth.users (id)  ON DELETE CASCADE,
    provider_name TEXT,
    capability    TEXT,
    project_id    UUID        REFERENCES public.projects (id)      ON DELETE SET NULL,
    message       TEXT        NOT NULL DEFAULT '',
    status        TEXT        NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'seen', 'responded', 'closed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Collaborate board response columns (2026-07-26 / 2026-07-27)
    post_id       UUID        REFERENCES public.collab_posts (id) ON DELETE CASCADE,
    interest_type TEXT,
    contact       TEXT        NOT NULL DEFAULT ''
);

ALTER TABLE public.connection_requests
    DROP CONSTRAINT IF EXISTS connection_requests_interest_type_check;
ALTER TABLE public.connection_requests
    ADD CONSTRAINT connection_requests_interest_type_check
        CHECK (interest_type IS NULL OR interest_type IN
               ('can_provide', 'want_to_join', 'want_to_use', 'general'));

ALTER TABLE public.connection_requests
    ALTER COLUMN provider_name DROP NOT NULL;

ALTER TABLE public.connection_requests
    DROP CONSTRAINT IF EXISTS connection_requests_target_check;
ALTER TABLE public.connection_requests
    ADD CONSTRAINT connection_requests_target_check
        CHECK (provider_name IS NOT NULL OR post_id IS NOT NULL);

ALTER TABLE public.connection_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "connection_requests_select_own" ON public.connection_requests;
CREATE POLICY "connection_requests_select_own"
    ON public.connection_requests FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "connection_requests_insert_own" ON public.connection_requests;
CREATE POLICY "connection_requests_insert_own"
    ON public.connection_requests FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_connection_requests_user   ON public.connection_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connection_requests_status ON public.connection_requests (status);
CREATE INDEX IF NOT EXISTS idx_connection_requests_post   ON public.connection_requests (post_id);
CREATE INDEX IF NOT EXISTS idx_connection_requests_unseen
    ON public.connection_requests (post_id)
    WHERE status = 'new' AND post_id IS NOT NULL;


-- =============================================================================
-- TABLE: promote_captures
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.promote_captures (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    doi          TEXT,
    pmid         TEXT,
    paper_title  TEXT,
    author_name  TEXT,
    orcid        TEXT,
    linkedin_url TEXT,
    created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.promote_captures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can insert promote captures" ON public.promote_captures;
CREATE POLICY "anyone can insert promote captures"
    ON public.promote_captures FOR INSERT
    WITH CHECK (true);


-- =============================================================================
-- TABLE: lab_resources
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.lab_resources (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID        NOT NULL REFERENCES public.users (id),
    category     TEXT        NOT NULL,
    fields       JSONB       NOT NULL DEFAULT '{}',
    contact_info TEXT,
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now(),
    -- community_id (2026-08-20) — nullable, ON DELETE SET NULL.
    community_id UUID        REFERENCES public.communities (id) ON DELETE SET NULL
);

ALTER TABLE public.lab_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can read lab resources" ON public.lab_resources;
CREATE POLICY "anyone can read lab resources"
    ON public.lab_resources FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "owner can update own resource" ON public.lab_resources;
CREATE POLICY "owner can update own resource"
    ON public.lab_resources FOR UPDATE
    USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "owner can delete own resource" ON public.lab_resources;
CREATE POLICY "owner can delete own resource"
    ON public.lab_resources FOR DELETE
    USING (auth.uid() = owner_id);
-- "authenticated users can insert own resource" is created further below,
-- after can_post_to_community() exists.

CREATE INDEX IF NOT EXISTS idx_lab_resources_category  ON public.lab_resources (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_resources_owner      ON public.lab_resources (owner_id);
CREATE INDEX IF NOT EXISTS idx_lab_resources_community  ON public.lab_resources (community_id);


-- =============================================================================
-- TABLE: promote_showcase
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.promote_showcase (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    type         TEXT        NOT NULL,
    title        TEXT        NOT NULL,
    description  TEXT        NOT NULL DEFAULT '',
    authors      TEXT        NOT NULL DEFAULT '',
    link         TEXT,
    image_url    TEXT,
    tags         TEXT[]      NOT NULL DEFAULT '{}',
    slug         TEXT,
    headline     TEXT        NOT NULL DEFAULT '',
    standfirst   TEXT        NOT NULL DEFAULT '',
    article_body TEXT        NOT NULL DEFAULT '',
    journal      TEXT,
    doi          TEXT,
    linkedin_post TEXT       NOT NULL DEFAULT '',
    published    BOOLEAN     NOT NULL DEFAULT false,
    published_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- project_id (2026-08-04) — ties a showcase entry back to its project.
    project_id   UUID        REFERENCES public.projects (id) ON DELETE SET NULL,
    -- community_id (2026-09-13) — nullable, ON DELETE SET NULL.
    community_id UUID        REFERENCES public.communities (id) ON DELETE SET NULL
);

ALTER TABLE public.promote_showcase
    DROP CONSTRAINT IF EXISTS promote_showcase_type_check;
ALTER TABLE public.promote_showcase
    ADD CONSTRAINT promote_showcase_type_check
    CHECK (type IN (
        'paper', 'talk', 'poster', 'award', 'tool', 'event', 'other',
        'case_study', 'white_paper', 'achievement'
    ));

ALTER TABLE public.promote_showcase ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_promote_showcase_slug
    ON public.promote_showcase (slug)
    WHERE slug IS NOT NULL;

DROP POLICY IF EXISTS "promote_showcase_select_published" ON public.promote_showcase;
CREATE POLICY "promote_showcase_select_published"
    ON public.promote_showcase FOR SELECT
    USING (published = true);

DROP POLICY IF EXISTS "promote_showcase_select_own" ON public.promote_showcase;
CREATE POLICY "promote_showcase_select_own"
    ON public.promote_showcase FOR SELECT
    TO authenticated
    USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "promote_showcase_delete_own" ON public.promote_showcase;
CREATE POLICY "promote_showcase_delete_own"
    ON public.promote_showcase FOR DELETE
    TO authenticated
    USING (auth.uid() = owner_id);
-- promote_showcase_insert_own / _update_own are created further below, after
-- can_post_to_community() exists.

CREATE INDEX IF NOT EXISTS idx_promote_showcase_created ON public.promote_showcase (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promote_showcase_owner   ON public.promote_showcase (owner_id);
CREATE INDEX IF NOT EXISTS idx_promote_showcase_type    ON public.promote_showcase (type);
CREATE INDEX IF NOT EXISTS idx_promote_showcase_tags    ON public.promote_showcase USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_promote_showcase_community ON public.promote_showcase (community_id);


-- =============================================================================
-- TABLE: promote_showcase_media
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.promote_showcase_media (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    showcase_id UUID        NOT NULL REFERENCES public.promote_showcase (id) ON DELETE CASCADE,
    owner_id    UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    kind        TEXT        NOT NULL CHECK (kind IN ('image', 'slides')),
    url         TEXT        NOT NULL,   -- storage OBJECT PATH, not a public URL
    filename    TEXT        NOT NULL,
    size_bytes  BIGINT      NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.promote_showcase_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promote_showcase_media_select_published" ON public.promote_showcase_media;
CREATE POLICY "promote_showcase_media_select_published"
    ON public.promote_showcase_media FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.promote_showcase s
            WHERE s.id = showcase_id AND s.published = true
        )
    );

DROP POLICY IF EXISTS "promote_showcase_media_select_own" ON public.promote_showcase_media;
CREATE POLICY "promote_showcase_media_select_own"
    ON public.promote_showcase_media FOR SELECT
    TO authenticated
    USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "promote_showcase_media_insert_own" ON public.promote_showcase_media;
CREATE POLICY "promote_showcase_media_insert_own"
    ON public.promote_showcase_media FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = owner_id
        AND EXISTS (
            SELECT 1 FROM public.promote_showcase s
            WHERE s.id = showcase_id AND s.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "promote_showcase_media_delete_own" ON public.promote_showcase_media;
CREATE POLICY "promote_showcase_media_delete_own"
    ON public.promote_showcase_media FOR DELETE
    TO authenticated
    USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_promote_showcase_media_showcase ON public.promote_showcase_media (showcase_id);


-- =============================================================================
-- TABLE: feedback
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.feedback (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    page_path   TEXT        NOT NULL,
    message     TEXT,
    context     JSONB       NOT NULL DEFAULT '{}',
    email       TEXT,
    user_id     UUID        REFERENCES public.users (id) ON DELETE SET NULL
);

ALTER TABLE public.feedback
    DROP CONSTRAINT IF EXISTS feedback_message_length_check;
ALTER TABLE public.feedback
    ADD CONSTRAINT feedback_message_length_check
        CHECK (message IS NULL OR char_length(message) <= 2000);

ALTER TABLE public.feedback
    DROP CONSTRAINT IF EXISTS feedback_email_length_check;
ALTER TABLE public.feedback
    ADD CONSTRAINT feedback_email_length_check
        CHECK (email IS NULL OR char_length(email) <= 320);

ALTER TABLE public.feedback
    DROP CONSTRAINT IF EXISTS feedback_page_path_length_check;
ALTER TABLE public.feedback
    ADD CONSTRAINT feedback_page_path_length_check
        CHECK (char_length(page_path) <= 500);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- IMPORTANT (see CLAUDE.md's own gotcha): never chain .select() onto a
-- feedback insert from the client — there is deliberately no SELECT policy
-- at all, so INSERT ... RETURNING fails 42501 for anon/authenticated.
DROP POLICY IF EXISTS "feedback_insert_anyone" ON public.feedback;
CREATE POLICY "feedback_insert_anyone"
    ON public.feedback FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON public.feedback (created_at DESC);


-- =============================================================================
-- TABLE: community_announcements
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.community_announcements (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    author_id    UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    title        TEXT        NOT NULL,
    body         TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.community_announcements ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_community_announcements_community_created
    ON public.community_announcements (community_id, created_at DESC);


-- =============================================================================
-- TABLE: community_resources (resource_type CHECK final, 2026-09-22)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.community_resources (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id  UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    added_by      UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    title         TEXT        NOT NULL,
    resource_type TEXT        NOT NULL DEFAULT 'other',
    url           TEXT,
    description   TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.community_resources
    DROP CONSTRAINT IF EXISTS community_resources_type_check;
ALTER TABLE public.community_resources
    ADD CONSTRAINT community_resources_type_check
        CHECK (resource_type IN (
            'tool', 'paper', 'dataset', 'link', 'podcast', 'other',
            'slides', 'notes', 'folder', 'template'
        ));

ALTER TABLE public.community_resources ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_community_resources_community_type
    ON public.community_resources (community_id, resource_type);


-- =============================================================================
-- TABLE: community_resource_files
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.community_resource_files (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id  UUID        NOT NULL REFERENCES public.community_resources (id) ON DELETE CASCADE,
    community_id UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    added_by     UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    url          TEXT        NOT NULL,   -- storage OBJECT PATH, not a public URL
    filename     TEXT        NOT NULL,
    size_bytes   BIGINT      NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.community_resource_files ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_community_resource_files_resource
    ON public.community_resource_files (resource_id);


-- =============================================================================
-- TABLE: community_feed_items
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.community_feed_items (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    kind         TEXT        NOT NULL,
    external_id  TEXT        NOT NULL,
    title        TEXT        NOT NULL,
    url          TEXT,
    summary      TEXT,
    source       TEXT,
    published_at TIMESTAMPTZ,
    raw          JSONB,
    signal       JSONB,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.community_feed_items
    DROP CONSTRAINT IF EXISTS community_feed_items_kind_check;
ALTER TABLE public.community_feed_items
    ADD CONSTRAINT community_feed_items_kind_check
        CHECK (kind IN (
            'paper', 'news', 'trial', 'grant', 'tool',
            'dataset', 'geneset', 'compound', 'target', 'episode'
        ));

ALTER TABLE public.community_feed_items
    DROP CONSTRAINT IF EXISTS community_feed_items_dedupe_key;
ALTER TABLE public.community_feed_items
    ADD CONSTRAINT community_feed_items_dedupe_key
        UNIQUE (community_id, kind, external_id);

CREATE INDEX IF NOT EXISTS community_feed_items_community_kind_idx
    ON public.community_feed_items (community_id, kind);

CREATE INDEX IF NOT EXISTS community_feed_items_community_published_idx
    ON public.community_feed_items (community_id, published_at DESC);

ALTER TABLE public.community_feed_items ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- FUNCTIONS: users / signup
-- =============================================================================
-- Final replacement — claims pending project_members AND community_members
-- rows by email, in addition to creating the profile row.
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

    UPDATE public.project_members
    SET user_id = NEW.id
    WHERE user_id IS NULL
      AND lower(email) = lower(NEW.email);

    UPDATE public.community_members
    SET user_id = NEW.id
    WHERE user_id IS NULL
      AND lower(email) = lower(NEW.email);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collab_posts_touch_updated_at ON public.collab_posts;
CREATE TRIGGER collab_posts_touch_updated_at
    BEFORE UPDATE ON public.collab_posts
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS community_announcements_touch_updated_at ON public.community_announcements;
CREATE TRIGGER community_announcements_touch_updated_at
    BEFORE UPDATE ON public.community_announcements
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS community_resources_touch_updated_at ON public.community_resources;
CREATE TRIGGER community_resources_touch_updated_at
    BEFORE UPDATE ON public.community_resources
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- =============================================================================
-- FUNCTIONS: Collaborate board
-- =============================================================================
CREATE OR REPLACE FUNCTION public.collab_post_interest_counts()
RETURNS TABLE (post_id UUID, interested BIGINT)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT cr.post_id, COUNT(DISTINCT cr.user_id)
    FROM public.connection_requests cr
    WHERE cr.post_id IS NOT NULL
    GROUP BY cr.post_id;
$$;

REVOKE ALL ON FUNCTION public.collab_post_interest_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collab_post_interest_counts() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.collab_post_owners()
RETURNS TABLE (
    id           UUID,
    name         TEXT,
    affiliation  TEXT,
    institution  TEXT,
    profile_slug TEXT
)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT
        u.id, u.name, u.affiliation, u.institution,
        CASE WHEN u.is_public THEN u.profile_slug ELSE NULL END AS profile_slug
    FROM public.users u
    WHERE EXISTS (SELECT 1 FROM public.collab_posts p WHERE p.owner_id = u.id);
$$;

REVOKE ALL ON FUNCTION public.collab_post_owners() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collab_post_owners() TO anon, authenticated;


-- =============================================================================
-- FUNCTION: showcase_owners
-- =============================================================================
CREATE OR REPLACE FUNCTION public.showcase_owners()
RETURNS TABLE (
    id          UUID,
    name        TEXT,
    affiliation TEXT
)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT u.id, u.name, u.affiliation
    FROM public.users u
    WHERE EXISTS (SELECT 1 FROM public.promote_showcase s WHERE s.owner_id = u.id);
$$;

REVOKE ALL ON FUNCTION public.showcase_owners() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.showcase_owners() TO anon, authenticated;


-- =============================================================================
-- FUNCTIONS: Collaborate inbox
-- =============================================================================
CREATE OR REPLACE FUNCTION public.inbox_requests()
RETURNS TABLE (
    request_id             UUID,
    post_id                UUID,
    post_title             TEXT,
    interest_type          TEXT,
    message                TEXT,
    contact                TEXT,
    status                 TEXT,
    created_at             TIMESTAMPTZ,
    responder_id           UUID,
    responder_name         TEXT,
    responder_affiliation  TEXT,
    responder_institution  TEXT,
    responder_profile_slug TEXT
)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT
        cr.id, cr.post_id, p.title, cr.interest_type, cr.message,
        cr.contact, cr.status, cr.created_at, cr.user_id,
        u.name, u.affiliation, u.institution,
        CASE WHEN u.is_public THEN u.profile_slug ELSE NULL END
    FROM public.connection_requests cr
    JOIN public.collab_posts p ON p.id = cr.post_id
    LEFT JOIN public.users u   ON u.id = cr.user_id
    WHERE cr.post_id IS NOT NULL
      AND p.owner_id = auth.uid()
    ORDER BY cr.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.inbox_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inbox_requests() TO authenticated;

CREATE OR REPLACE FUNCTION public.inbox_unseen_count()
RETURNS BIGINT
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT COUNT(*)
    FROM public.connection_requests cr
    JOIN public.collab_posts p ON p.id = cr.post_id
    WHERE cr.post_id IS NOT NULL
      AND p.owner_id = auth.uid()
      AND cr.status = 'new';
$$;

REVOKE ALL ON FUNCTION public.inbox_unseen_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inbox_unseen_count() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_inbox_seen(request_ids UUID[] DEFAULT NULL)
RETURNS BIGINT
    LANGUAGE plpgsql
    VOLATILE
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    updated BIGINT;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN 0;
    END IF;

    UPDATE public.connection_requests cr
       SET status = 'seen'
     WHERE cr.status = 'new'
       AND cr.post_id IS NOT NULL
       AND (request_ids IS NULL OR cr.id = ANY (request_ids))
       AND EXISTS (
           SELECT 1 FROM public.collab_posts p
           WHERE p.id = cr.post_id AND p.owner_id = auth.uid()
       );

    GET DIAGNOSTICS updated = ROW_COUNT;
    RETURN updated;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_inbox_seen(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_inbox_seen(UUID[]) TO authenticated;


-- =============================================================================
-- FUNCTIONS: project membership / leadership checks
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = p_project_id AND pm.user_id = p_uid
    );
$$;
-- NOTE (documented, not fixed, per 2026-08-22_wiki_notes.sql's own flagged
-- gap): this function has never had its default PUBLIC/anon EXECUTE grant
-- explicitly revoked anywhere in the migration history. A fresh project run
-- through this file carries the same Postgres/Supabase default grant
-- (EXECUTE to PUBLIC at CREATE time) — that is the accurate reproduction of
-- production's current state, not an oversight in this file.

-- Final body (2026-08-08): checks project_members.role = 'lead', i.e. ANY lead.
CREATE OR REPLACE FUNCTION public.is_project_lead(p_project_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = p_project_id AND pm.user_id = p_uid AND pm.role = 'lead'
    );
$$;

REVOKE ALL ON FUNCTION public.is_project_lead(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_lead(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_project_lead(UUID, UUID) TO authenticated;

-- The project's ORIGINAL creator (projects.lead_id) — used for project
-- DELETE only, so promoting a co-lead never hands them delete power.
CREATE OR REPLACE FUNCTION public.is_project_creator(p_project_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = p_project_id AND p.lead_id = p_uid
    );
$$;

REVOKE ALL ON FUNCTION public.is_project_creator(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_creator(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_project_creator(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_min_one_lead()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    IF OLD.role = 'lead' AND NEW.role = 'member' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.project_members
            WHERE project_id = OLD.project_id AND role = 'lead' AND id <> OLD.id
        ) THEN
            RAISE EXCEPTION 'A project must always have at least one lead.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_min_one_lead() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_min_one_lead() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_min_one_lead() FROM authenticated;

DROP TRIGGER IF EXISTS trg_enforce_min_one_lead ON public.project_members;
CREATE TRIGGER trg_enforce_min_one_lead
    BEFORE UPDATE ON public.project_members
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_min_one_lead();


-- =============================================================================
-- FUNCTIONS: communities — membership / posting / admin checks
-- =============================================================================
-- Final body (2026-08-21): only status = 'active' rows count, plus the
-- derived ColaboFest membership path.
CREATE OR REPLACE FUNCTION public.is_community_member(p_community_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT
        EXISTS (
            SELECT 1 FROM public.community_members cm
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

-- Final grants (2026-09-19 re-granted anon: a sibling RLS policy on
-- community_feed_items calls this function even for anon callers).
REVOKE ALL ON FUNCTION public.is_community_member(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_community_member(UUID, UUID) TO anon, authenticated;

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

REVOKE ALL ON FUNCTION public.can_post_to_community(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_post_to_community(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_post_to_community(UUID, UUID) TO authenticated;

-- Superseded by is_community_admin() for every current policy, but kept
-- defined (unreferenced) exactly as production leaves it.
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

REVOKE ALL ON FUNCTION public.is_community_lead(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_community_lead(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_community_lead(UUID, UUID) TO authenticated;

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

REVOKE ALL ON FUNCTION public.is_community_admin(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_community_admin(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_community_admin(UUID, UUID) TO authenticated;

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

REVOKE ALL ON FUNCTION public.community_member_stats(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_member_stats(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.community_member_stats(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.community_member_counts()
    RETURNS TABLE (community_id UUID, member_count BIGINT)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT cm.community_id, COUNT(*) FILTER (WHERE cm.status = 'active')
    FROM public.community_members cm
    GROUP BY cm.community_id;
$$;

REVOKE ALL ON FUNCTION public.community_member_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_member_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.community_member_counts() TO anon, authenticated;

-- Fixed body (2026-08-30_community_admin_membership_fix.sql).
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

REVOKE ALL ON FUNCTION public.create_community_with_admin(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_community_with_admin(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_community_with_admin(TEXT, TEXT) TO authenticated;

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

REVOKE ALL ON FUNCTION public.find_account_id_by_email_for_community(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_account_id_by_email_for_community(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_account_id_by_email_for_community(UUID, TEXT) TO authenticated;

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
    WHERE id = v_uid AND email_confirmed_at IS NOT NULL;

    IF v_email IS NULL THEN RETURN; END IF;

    UPDATE public.community_members
    SET user_id = v_uid
    WHERE user_id IS NULL AND lower(email) = lower(v_email);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_community_memberships() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_pending_community_memberships() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_pending_community_memberships() TO authenticated;


-- =============================================================================
-- FUNCTION: create_project_with_lead (final, 11-argument signature)
-- =============================================================================
DROP FUNCTION IF EXISTS public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT
);
DROP FUNCTION IF EXISTS public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]
);
DROP FUNCTION IF EXISTS public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER
);
DROP FUNCTION IF EXISTS public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER, UUID
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

    -- ColaboFest Section A — the nine-item readiness checklist, ordinary
    -- fully-editable rows, seeded only for this one challenge_key.
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

REVOKE ALL ON FUNCTION public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER, UUID
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER, UUID
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_project_with_lead(
    TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER, UUID
) TO authenticated;


-- =============================================================================
-- FUNCTIONS: project member identity / account linking
-- =============================================================================
CREATE OR REPLACE FUNCTION public.project_member_names(project_ids UUID[])
RETURNS TABLE (
    user_id      UUID,
    name         TEXT,
    profile_slug TEXT
)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT DISTINCT
        u.id AS user_id,
        u.name,
        CASE WHEN u.is_public THEN u.profile_slug ELSE NULL END AS profile_slug
    FROM public.users u
    JOIN public.project_members pm ON pm.user_id = u.id
    WHERE pm.project_id = ANY(project_ids)
      AND public.is_project_member(pm.project_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.project_member_names(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_member_names(UUID[]) TO authenticated;

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

    SELECT email INTO v_email
    FROM auth.users
    WHERE id = v_uid AND email_confirmed_at IS NOT NULL;

    IF v_email IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.project_members
    SET user_id = v_uid
    WHERE user_id IS NULL AND lower(email) = lower(v_email);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_project_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_project_memberships() TO authenticated;


-- =============================================================================
-- RLS: projects / project_members / checklist_items / project_proposals
-- (created here, now that is_project_member/is_project_lead/is_project_creator/
-- is_community_member all exist)
-- =============================================================================
DROP POLICY IF EXISTS "Projects: member select" ON public.projects;
DROP POLICY IF EXISTS "Projects: member or community select" ON public.projects;
CREATE POLICY "Projects: member or community select"
    ON public.projects FOR SELECT
    USING (
        public.is_project_member(id, auth.uid())
        OR (community_id IS NOT NULL AND public.is_community_member(community_id, auth.uid()))
    );

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
    USING (public.is_project_creator(id, auth.uid()));

DROP POLICY IF EXISTS "Project members: member select" ON public.project_members;
CREATE POLICY "Project members: member select"
    ON public.project_members FOR SELECT
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project members: lead insert" ON public.project_members;
CREATE POLICY "Project members: lead insert"
    ON public.project_members FOR INSERT
    WITH CHECK (public.is_project_lead(project_id, auth.uid()));

-- Final (2026-08-08): a lead may remove a MEMBER, never a lead (lead rows can
-- only leave via the self-demote UPDATE path below).
DROP POLICY IF EXISTS "Project members: lead delete" ON public.project_members;
CREATE POLICY "Project members: lead delete"
    ON public.project_members FOR DELETE
    USING (
        public.is_project_lead(project_id, auth.uid())
        AND role = 'member'
    );

DROP POLICY IF EXISTS "Project members: promote or self-demote" ON public.project_members;
CREATE POLICY "Project members: promote or self-demote"
    ON public.project_members FOR UPDATE
    USING (public.is_project_lead(project_id, auth.uid()))
    WITH CHECK (
        role = 'lead'
        OR (role = 'member' AND user_id = auth.uid())
    );

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


-- =============================================================================
-- RLS: project_digests / wiki_notes / project_evidence_items / wiki_note_evidence
-- =============================================================================
DROP POLICY IF EXISTS "Project digests: member select" ON public.project_digests;
CREATE POLICY "Project digests: member select"
    ON public.project_digests FOR SELECT
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project digests: member insert" ON public.project_digests;
CREATE POLICY "Project digests: member insert"
    ON public.project_digests FOR INSERT
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project digests: member update" ON public.project_digests;
CREATE POLICY "Project digests: member update"
    ON public.project_digests FOR UPDATE
    USING (public.is_project_member(project_id, auth.uid()))
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Wiki notes: member select" ON public.wiki_notes;
CREATE POLICY "Wiki notes: member select"
    ON public.wiki_notes FOR SELECT
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Wiki notes: member insert" ON public.wiki_notes;
CREATE POLICY "Wiki notes: member insert"
    ON public.wiki_notes FOR INSERT
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Wiki notes: member update" ON public.wiki_notes;
CREATE POLICY "Wiki notes: member update"
    ON public.wiki_notes FOR UPDATE
    USING (public.is_project_member(project_id, auth.uid()))
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Wiki notes: member delete" ON public.wiki_notes;
CREATE POLICY "Wiki notes: member delete"
    ON public.wiki_notes FOR DELETE
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project evidence items: member select" ON public.project_evidence_items;
CREATE POLICY "Project evidence items: member select"
    ON public.project_evidence_items FOR SELECT
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project evidence items: member insert" ON public.project_evidence_items;
CREATE POLICY "Project evidence items: member insert"
    ON public.project_evidence_items FOR INSERT
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project evidence items: member update" ON public.project_evidence_items;
CREATE POLICY "Project evidence items: member update"
    ON public.project_evidence_items FOR UPDATE
    USING (public.is_project_member(project_id, auth.uid()))
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.set_wiki_note_evidence_project_id()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    note_project_id UUID;
    item_project_id UUID;
BEGIN
    SELECT project_id INTO note_project_id FROM public.wiki_notes WHERE id = NEW.note_id;
    SELECT project_id INTO item_project_id FROM public.project_evidence_items WHERE id = NEW.evidence_item_id;
    IF note_project_id IS NULL OR item_project_id IS NULL THEN
        RAISE EXCEPTION 'wiki_note_evidence: note or evidence item not found';
    END IF;
    IF note_project_id <> item_project_id THEN
        RAISE EXCEPTION 'wiki_note_evidence: note and evidence item belong to different projects';
    END IF;
    NEW.project_id := note_project_id;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_wiki_note_evidence_project_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_wiki_note_evidence_project_id() FROM anon;

DROP TRIGGER IF EXISTS trg_set_wiki_note_evidence_project_id ON public.wiki_note_evidence;
CREATE TRIGGER trg_set_wiki_note_evidence_project_id
    BEFORE INSERT OR UPDATE ON public.wiki_note_evidence
    FOR EACH ROW
    EXECUTE FUNCTION public.set_wiki_note_evidence_project_id();

DROP POLICY IF EXISTS "Wiki note evidence: member select" ON public.wiki_note_evidence;
CREATE POLICY "Wiki note evidence: member select"
    ON public.wiki_note_evidence FOR SELECT
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Wiki note evidence: member insert" ON public.wiki_note_evidence;
CREATE POLICY "Wiki note evidence: member insert"
    ON public.wiki_note_evidence FOR INSERT
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Wiki note evidence: member delete" ON public.wiki_note_evidence;
CREATE POLICY "Wiki note evidence: member delete"
    ON public.wiki_note_evidence FOR DELETE
    USING (public.is_project_member(project_id, auth.uid()));


-- =============================================================================
-- RLS: saved_items (final, 2026-08-09)
-- =============================================================================
DROP POLICY IF EXISTS "saved_items_select_own" ON public.saved_items;
CREATE POLICY "saved_items_select_own"
    ON public.saved_items FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        OR (project_id IS NOT NULL AND public.is_project_member(project_id, auth.uid()))
    );

DROP POLICY IF EXISTS "saved_items_insert_own" ON public.saved_items;
CREATE POLICY "saved_items_insert_own"
    ON public.saved_items FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        AND (project_id IS NULL OR public.is_project_member(project_id, auth.uid()))
    );

DROP POLICY IF EXISTS "saved_items_delete_own" ON public.saved_items;
CREATE POLICY "saved_items_delete_own"
    ON public.saved_items FOR DELETE
    TO authenticated
    USING (
        auth.uid() = user_id
        OR (project_id IS NOT NULL AND public.is_project_member(project_id, auth.uid()))
    );


-- =============================================================================
-- RLS: collab_posts / lab_resources / promote_showcase — final community-aware
-- INSERT (and, for promote_showcase, UPDATE) policies
-- =============================================================================
DROP POLICY IF EXISTS "collab_posts_insert_own" ON public.collab_posts;
CREATE POLICY "collab_posts_insert_own"
    ON public.collab_posts FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = owner_id
        AND (community_id IS NULL OR public.can_post_to_community(community_id, auth.uid()))
    );

DROP POLICY IF EXISTS "authenticated users can insert own resource" ON public.lab_resources;
CREATE POLICY "authenticated users can insert own resource"
    ON public.lab_resources FOR INSERT
    WITH CHECK (
        auth.uid() = owner_id
        AND (community_id IS NULL OR public.can_post_to_community(community_id, auth.uid()))
    );

DROP POLICY IF EXISTS "promote_showcase_insert_own" ON public.promote_showcase;
CREATE POLICY "promote_showcase_insert_own"
    ON public.promote_showcase FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = owner_id
        AND (community_id IS NULL OR public.can_post_to_community(community_id, auth.uid()))
    );

DROP POLICY IF EXISTS "promote_showcase_update_own" ON public.promote_showcase;
CREATE POLICY "promote_showcase_update_own"
    ON public.promote_showcase FOR UPDATE
    TO authenticated
    USING (auth.uid() = owner_id)
    WITH CHECK (
        auth.uid() = owner_id
        AND (community_id IS NULL OR public.can_post_to_community(community_id, auth.uid()))
    );


-- =============================================================================
-- TRIGGERS: community_members admin guard + self-update guard
-- =============================================================================
-- Final body (2026-08-31_community_delete_admin_guard_fix.sql): skips both
-- rules when the row's own community no longer exists (a cascade from
-- DELETE FROM communities, not a live membership change).
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
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (SELECT 1 FROM public.communities c WHERE c.id = OLD.community_id)
    THEN
        RETURN OLD;
    END IF;

    IF OLD.role = 'admin' AND OLD.status = 'active'
       AND (TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NEW.status <> 'active')
    THEN
        IF v_acting_uid IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION 'An admin cannot remove or demote another admin.';
        END IF;

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

-- Final body (2026-09-14): `focus` and `hidden` are self-editable; every
-- other column requires admin rights.
CREATE OR REPLACE FUNCTION public.enforce_community_member_self_update_guard()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    IF public.is_community_admin(NEW.community_id, auth.uid()) THEN
        RETURN NEW;
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role
        OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.email IS DISTINCT FROM OLD.email
        OR NEW.community_id IS DISTINCT FROM OLD.community_id
        OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
        OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
        OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
        OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
    THEN
        RAISE EXCEPTION 'You can only edit your own research focus or hide yourself from the roster.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_community_member_self_update_guard ON public.community_members;
CREATE TRIGGER trg_enforce_community_member_self_update_guard
    BEFORE UPDATE ON public.community_members
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_community_member_self_update_guard();


-- =============================================================================
-- FUNCTION: community_member_roster (final, 2026-09-20)
-- =============================================================================
DROP FUNCTION IF EXISTS public.community_member_roster(UUID[]);

CREATE FUNCTION public.community_member_roster(community_ids UUID[])
RETURNS TABLE (
    member_id   UUID,
    user_id     UUID,
    role        TEXT,
    name        TEXT,
    email       TEXT,
    institution TEXT,
    focus       TEXT,
    signed_up   BOOLEAN,
    hidden      BOOLEAN
)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT
        cm.id AS member_id,
        cm.user_id,
        cm.role,
        COALESCE(u.name, cm.display_name) AS name,
        COALESCE(u.email, cm.email) AS email,
        u.institution,
        cm.focus,
        (cm.user_id IS NOT NULL) AS signed_up,
        cm.hidden
    FROM public.community_members cm
    LEFT JOIN public.users u ON u.id = cm.user_id
    WHERE cm.community_id = ANY(community_ids)
      AND cm.status = 'active'
      AND (NOT cm.hidden OR cm.user_id = auth.uid())
      AND (
          public.is_community_member(cm.community_id, auth.uid())
          OR EXISTS (
              SELECT 1 FROM public.communities c
              WHERE c.id = cm.community_id AND c.public_preview = 'open'
          )
      );
$$;

REVOKE ALL ON FUNCTION public.community_member_roster(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_member_roster(UUID[]) TO anon, authenticated;


-- =============================================================================
-- RLS: communities / community_members (final policies)
-- =============================================================================
DROP POLICY IF EXISTS "Communities: admin update" ON public.communities;
CREATE POLICY "Communities: admin update"
    ON public.communities FOR UPDATE
    TO authenticated
    USING (public.is_community_admin(id, auth.uid()))
    WITH CHECK (public.is_community_admin(id, auth.uid()));

DROP POLICY IF EXISTS "Communities: admin delete" ON public.communities;
CREATE POLICY "Communities: admin delete"
    ON public.communities FOR DELETE
    TO authenticated
    USING (public.is_community_admin(id, auth.uid()));

DROP POLICY IF EXISTS "Community members: self or admin select" ON public.community_members;
CREATE POLICY "Community members: self or admin select"
    ON public.community_members FOR SELECT
    TO authenticated
    USING (user_id = auth.uid() OR public.is_community_admin(community_id, auth.uid()));

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

DROP POLICY IF EXISTS "Community members: admin manages" ON public.community_members;
CREATE POLICY "Community members: admin manages"
    ON public.community_members FOR UPDATE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()))
    WITH CHECK (public.is_community_admin(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community members: self update own row" ON public.community_members;
CREATE POLICY "Community members: self update own row"
    ON public.community_members FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Community members: self or admin delete" ON public.community_members;
CREATE POLICY "Community members: self or admin delete"
    ON public.community_members FOR DELETE
    TO authenticated
    USING (user_id = auth.uid() OR public.is_community_admin(community_id, auth.uid()));


-- =============================================================================
-- RLS: community_announcements / community_resources / community_resource_files
-- / community_feed_items (all depend on is_community_member/is_community_admin)
-- =============================================================================
DROP POLICY IF EXISTS "Community announcements: member select" ON public.community_announcements;
CREATE POLICY "Community announcements: member select"
    ON public.community_announcements FOR SELECT
    TO authenticated
    USING (public.is_community_member(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community announcements: admin insert" ON public.community_announcements;
CREATE POLICY "Community announcements: admin insert"
    ON public.community_announcements FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = author_id
        AND public.is_community_admin(community_id, auth.uid())
    );

DROP POLICY IF EXISTS "Community announcements: admin update" ON public.community_announcements;
CREATE POLICY "Community announcements: admin update"
    ON public.community_announcements FOR UPDATE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()))
    WITH CHECK (public.is_community_admin(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community announcements: admin delete" ON public.community_announcements;
CREATE POLICY "Community announcements: admin delete"
    ON public.community_announcements FOR DELETE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community resources: member select" ON public.community_resources;
CREATE POLICY "Community resources: member select"
    ON public.community_resources FOR SELECT
    TO authenticated
    USING (public.is_community_member(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community resources: admin insert" ON public.community_resources;
CREATE POLICY "Community resources: admin insert"
    ON public.community_resources FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = added_by
        AND public.is_community_admin(community_id, auth.uid())
    );

DROP POLICY IF EXISTS "Community resources: admin update" ON public.community_resources;
CREATE POLICY "Community resources: admin update"
    ON public.community_resources FOR UPDATE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()))
    WITH CHECK (public.is_community_admin(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community resources: admin delete" ON public.community_resources;
CREATE POLICY "Community resources: admin delete"
    ON public.community_resources FOR DELETE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community resource files: member select" ON public.community_resource_files;
CREATE POLICY "Community resource files: member select"
    ON public.community_resource_files FOR SELECT
    TO authenticated
    USING (public.is_community_member(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community resource files: admin insert" ON public.community_resource_files;
CREATE POLICY "Community resource files: admin insert"
    ON public.community_resource_files FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = added_by
        AND public.is_community_admin(community_id, auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.community_resources r
            WHERE r.id = resource_id AND r.community_id = community_id
        )
    );

DROP POLICY IF EXISTS "Community resource files: admin delete" ON public.community_resource_files;
CREATE POLICY "Community resource files: admin delete"
    ON public.community_resource_files FOR DELETE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()));

GRANT EXECUTE ON FUNCTION public.is_community_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_community_admin(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "Community feed items: member select" ON public.community_feed_items;
CREATE POLICY "Community feed items: member select"
    ON public.community_feed_items FOR SELECT
    USING (public.is_community_member(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community feed items: admin insert" ON public.community_feed_items;
CREATE POLICY "Community feed items: admin insert"
    ON public.community_feed_items FOR INSERT
    WITH CHECK (public.is_community_admin(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community feed items: admin update" ON public.community_feed_items;
CREATE POLICY "Community feed items: admin update"
    ON public.community_feed_items FOR UPDATE
    USING (public.is_community_admin(community_id, auth.uid()))
    WITH CHECK (public.is_community_admin(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community feed items: admin delete" ON public.community_feed_items;
CREATE POLICY "Community feed items: admin delete"
    ON public.community_feed_items FOR DELETE
    USING (public.is_community_admin(community_id, auth.uid()));

-- Final (2026-09-20): non-member preview, for a community set to 'standard'
-- OR 'open' public_preview.
DROP POLICY IF EXISTS "Community feed items: public preview select" ON public.community_feed_items;
CREATE POLICY "Community feed items: public preview select"
    ON public.community_feed_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.communities c
            WHERE c.id = community_id AND c.public_preview IN ('standard', 'open')
        )
    );


-- =============================================================================
-- SEED DATA
-- =============================================================================
-- The three built-in communities from 2026-08-20_communities.sql. These are
-- the ONE case in this schema that qualifies as "required at boot", not
-- cosmetic demo data: public.is_community_member()'s derived-ColaboFest
-- branch (defined above) hardcodes `c.slug = 'colabofest-2026'` — without a
-- communities row at that slug, the ColaboFest-via-project-membership path is
-- simply always false (harmless, but the feature it backs has nothing to
-- match against). biokdd / neuro-oncology are included for parity with the
-- original seed and because they cost nothing empty, not because anything
-- reads them by name in SQL.
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

-- No other seed data is included. In particular:
--   * public.providers' "UAB SPARC" seed (database/schema.sql) is NOT
--     inserted — CLAUDE.md documents providers as having no reader/writer
--     left anywhere in frontend/, so it is optional demo data, not something
--     the app requires to boot.
--   * The ~133-row neuro-oncology roster seed
--     (2026-08-21_neuro_oncology_seed.sql) is real (placeholder) member data,
--     not schema — excluded as a one-off data fix, see the final report.
