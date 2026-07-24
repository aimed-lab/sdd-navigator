-- =============================================================================
-- SDD Navigator — Complete Database Schema
-- =============================================================================
-- Verified against live DB catalog 2026-07-24.
--
-- Run this in the Supabase SQL editor (or any empty Postgres) top-to-bottom to
-- reproduce the live database exactly. Idempotent: CREATE ... IF NOT EXISTS and
-- DROP POLICY IF EXISTS guards mean it can be re-run without error.
-- Order matters: tables with foreign keys come after their dependencies.
-- auth.users is managed by Supabase Auth and is not recreated here.
--
-- 12 tables: users, researcher_works, wiki_pages, nodes, edges, providers,
--            comments, saved_items, projects, connection_requests,
--            promote_captures, lab_resources.
-- (The former discovery_items table has been dropped and is intentionally absent.)
-- =============================================================================


-- =============================================================================
-- EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid() on older PG versions


-- =============================================================================
-- TABLE: users
-- =============================================================================
-- One row per registered researcher.
-- id mirrors auth.users.id (FK to auth.users) so we can JOIN on it from any table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.users (
    id             UUID        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    name           TEXT,
    email          TEXT        NOT NULL DEFAULT '',
    title          TEXT,                               -- job title / role, e.g. "Laboratory Head"
    affiliation    TEXT,                               -- "Researcher" | "Laboratory Head" | etc.
    institution    TEXT,
    country        TEXT,
    bio            TEXT,
    research_focus TEXT,
    linkedin_url   TEXT,
    website_url    TEXT,
    scholar_url    TEXT,                               -- Google Scholar profile
    orcid_url      TEXT,                               -- ORCID profile
    github_url     TEXT,                               -- GitHub profile
    interests      TEXT[]      DEFAULT '{}',
    expertise      TEXT[]      DEFAULT '{}',           -- expertise tags (live column)
    is_public      BOOLEAN     NOT NULL DEFAULT false,
    profile_slug   TEXT        UNIQUE,
    notify_weekly  BOOLEAN     NOT NULL DEFAULT false,    -- /settings → Notifications
    notify_daily   BOOLEAN     NOT NULL DEFAULT false,    -- /settings → Notifications
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- A user can read/insert/update/delete only their own profile row.
DROP POLICY IF EXISTS "Users: own row" ON public.users;
CREATE POLICY "Users: own row"
    ON public.users FOR ALL
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Public read of PUBLIC profiles only — powers the public /researchers/[slug]
-- pages, read with the anon key. (Was missing from the schema previously; without
-- it a rebuild would break public profiles even though the live DB allows them.)
DROP POLICY IF EXISTS "Users: public read for public profiles" ON public.users;
CREATE POLICY "Users: public read for public profiles"
    ON public.users FOR SELECT
    USING (is_public = true);

-- Auto-create the profile row when a new auth user is created.
-- Email confirmation is ON, so signUp() creates the auth.users row WITHOUT a
-- session — a client-side insert into public.users would fail RLS (401). This
-- SECURITY DEFINER trigger runs with the function owner's rights (bypassing
-- RLS) and reads the display name from the signup metadata. Idempotent via
-- ON CONFLICT so it can't clash with any existing login-time fallback insert.
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
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- TABLE: researcher_works
-- =============================================================================
-- Publications / patents / other outputs listed on a researcher's public profile.
-- Edited in /profile/setup (delete-and-reinsert of the caller's own rows) and
-- shown on the public /researchers/[slug] page. One row per work; owner is
-- stamped from the session (user_id), never the client payload.
-- user_id FK -> public.users(id) (nullable; no cascade).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.researcher_works (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    user_id     UUID        REFERENCES public.users (id),   -- owner (nullable); no cascade on this FK
    type        TEXT,                                 -- e.g. 'publication' | 'patent' | 'preprint'
    title       TEXT,
    description TEXT,                                 -- short summary
    url         TEXT,                                 -- link to the work
    year        INTEGER,                              -- publication year
    created_at  TIMESTAMPTZ DEFAULT now(),
    journal     TEXT,                                 -- venue / journal
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
-- One row per processed podcast episode.
-- Populated exclusively by the Python backend pipeline (service-role key).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wiki_pages (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug           TEXT        NOT NULL UNIQUE,          -- URL-safe identifier
    title          TEXT        NOT NULL,
    episode_number INTEGER     UNIQUE,
    transcript     TEXT,                                 -- full Whisper transcript
    episode_url    TEXT,                                 -- Spotify/Anchor episode link
    image_url      TEXT,                                 -- RSS feed artwork URL
    description    TEXT,                                 -- one-sentence summary from LLM
    summary        TEXT[]      DEFAULT '{}',             -- string[]
    concepts       JSONB       DEFAULT '[]',             -- {title: string, bullets: string[]}[]
    tags           TEXT[]      DEFAULT '{}',
    entities       JSONB       DEFAULT '{}',             -- {drugs, proteins, targets, tools}
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wiki_pages ENABLE ROW LEVEL SECURITY;

-- Public read access — episode wiki pages are open to everyone.
DROP POLICY IF EXISTS "Wiki pages: public read" ON public.wiki_pages;
CREATE POLICY "Wiki pages: public read"
    ON public.wiki_pages FOR SELECT
    USING (true);

-- Only the service-role key (backend pipeline) may write rows.
-- Authenticated users and anon have no INSERT/UPDATE/DELETE.
-- (No explicit policy needed to block; RLS denies by default.)


-- =============================================================================
-- TABLE: nodes
-- =============================================================================
-- Knowledge graph nodes built by graph_agent.py from wiki_pages data.
-- Three types: episode, concept, resource (drug/protein/target/tool).
-- NOTE: live table has NO created_at column.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nodes (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    label       TEXT        NOT NULL,           -- display name (not unique live)
    type        TEXT        NOT NULL            -- 'episode' | 'concept' | 'resource'
                    CHECK (type IN ('episode', 'concept', 'resource')),
    description TEXT
);

ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;

-- Public read — the knowledge graph is visible to all (incl. unauthenticated users).
DROP POLICY IF EXISTS "Nodes: public read" ON public.nodes;
CREATE POLICY "Nodes: public read"
    ON public.nodes FOR SELECT
    USING (true);


-- =============================================================================
-- TABLE: edges
-- =============================================================================
-- Directed relationships between knowledge graph nodes.
--   episode  → concept   (has_concept)
--   concept  → concept   (shared_concept — co-occur in same episode)
--   concept  → resource  (related_to)
-- NOTE: live table has a COMPOSITE primary key (source_id, target_id, relationship)
-- and NO surrogate id / created_at columns. FKs -> public.nodes(id).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.edges (
    source_id    UUID        NOT NULL REFERENCES public.nodes (id) ON DELETE CASCADE,
    target_id    UUID        NOT NULL REFERENCES public.nodes (id) ON DELETE CASCADE,
    relationship TEXT        NOT NULL,   -- 'has_concept' | 'shared_concept' | 'related_to'
    CONSTRAINT edges_pkey PRIMARY KEY (source_id, target_id, relationship)
);

ALTER TABLE public.edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Edges: public read" ON public.edges;
CREATE POLICY "Edges: public read"
    ON public.edges FOR SELECT
    USING (true);


-- =============================================================================
-- TABLE: providers
-- =============================================================================
-- Service-provider directory for the Navigator.
--   type = 'internal'  → UAB SPARC (computational / dry-lab).
--   type = 'external'  → CROs and other wet-lab services SPARC doesn't do.
-- The internal (SPARC) rows are wired into the Navigator: /api/generate-roadmap
-- reads them and the LLM selects, per roadmap step, which SPARC capabilities/
-- tools are relevant (see SparcStepCard). SPARC is modelled as ONE row PER
-- service area (speciality) — each row carries its own capability, in-house
-- tools, price and turnaround — so the roadmap can match the right service to
-- the right step. External CROs are still LLM-generated per project, not stored.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.providers (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name               TEXT        NOT NULL,
    country            TEXT,                                -- provider country (live column)
    type               TEXT        NOT NULL DEFAULT 'external'   -- 'internal' (SPARC) | 'external' (CRO)
                           CHECK (type IN ('internal', 'external')),
    speciality         TEXT,                                -- headline service area for this row
    capabilities       TEXT[]      NOT NULL DEFAULT '{}',   -- service areas / what they do
    tools              TEXT[]      NOT NULL DEFAULT '{}',   -- in-house software / methods
    estimated_cost     TEXT,                                -- typical price for this service
    estimated_timeline TEXT,                                -- typical turnaround for this service
    is_free            BOOLEAN     NOT NULL DEFAULT false,  -- free to UAB researchers?
    verified           BOOLEAN     NOT NULL DEFAULT false,  -- confirmed real internal provider
    stage_tags         TEXT[],                              -- drug-discovery stage labels (nullable)
    contact            TEXT,                                -- website URL or email (read by the app)
    contact_email      TEXT,                                -- provider contact email (live column)
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;

-- Public read — provider directory is openly browsable.
DROP POLICY IF EXISTS "Providers: public read" ON public.providers;
CREATE POLICY "Providers: public read"
    ON public.providers FOR SELECT
    USING (true);

-- Seed: UAB SPARC — the one real internal provider, modelled as six rows, one
-- per service area (speciality). Each row carries its own capability, in-house
-- tools, price and turnaround. This mirrors the live database exactly. External
-- CROs are LLM-generated per project in /api/generate-roadmap, not stored here.
INSERT INTO public.providers
    (name, type, speciality, capabilities, tools, estimated_cost, estimated_timeline, is_free, verified, contact)
SELECT v.name, v.type, v.speciality, v.capabilities, v.tools,
       v.estimated_cost, v.estimated_timeline, v.is_free, v.verified, v.contact
FROM (VALUES
    ('UAB SPARC', 'internal', 'Pathway & gene-set enrichment analysis',
        ARRAY['Pathway & gene-set enrichment analysis'], ARRAY['PAGER','PAGED','HPD'],
        '$1,200', '2–3 weeks', false, true, 'https://sites.uab.edu/sparc'),
    ('UAB SPARC', 'internal', 'Protein-interaction network analysis',
        ARRAY['Protein-interaction network analysis'], ARRAY['HAPPI','ProteoLens'],
        '$1,500', '2–4 weeks', false, true, 'https://sites.uab.edu/sparc'),
    ('UAB SPARC', 'internal', 'Network-based biomarker prioritization',
        ARRAY['Network-based biomarker prioritization'], ARRAY['WINNER','WIPER','BEERE'],
        '$1,800', '3–4 weeks', false, true, 'https://sites.uab.edu/sparc'),
    ('UAB SPARC', 'internal', 'Single-cell & spatial biomarker discovery',
        ARRAY['Single-cell & spatial biomarker discovery'], ARRAY['PGC','SpatialRSP'],
        '$2,000', '3–5 weeks', false, true, 'https://sites.uab.edu/sparc'),
    ('UAB SPARC', 'internal', 'Multi-omics visualization',
        ARRAY['Multi-omics visualization'], ARRAY['GeneTerrain','Mondrian Map'],
        '$1,000', '1–2 weeks', false, true, 'https://sites.uab.edu/sparc'),
    ('UAB SPARC', 'internal', 'Drug repositioning / network pharmacology',
        ARRAY['Drug repositioning / network pharmacology'], ARRAY['C2-Maps','HOMER'],
        '$1,600', '2–4 weeks', false, true, 'https://sites.uab.edu/sparc')
) AS v(name, type, speciality, capabilities, tools,
       estimated_cost, estimated_timeline, is_free, verified, contact)
WHERE NOT EXISTS (
    SELECT 1 FROM public.providers WHERE name = 'UAB SPARC' AND type = 'internal'
);


-- =============================================================================
-- TABLE: comments
-- =============================================================================
-- Researcher discussion threads attached to individual wiki pages.
-- name and affiliation are read at display time via JOIN to users —
-- they are not stored in the comments row itself.
-- NOTE: live user_id FK targets public.users(id) (NOT auth.users).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.comments (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    wiki_id    UUID        NOT NULL REFERENCES public.wiki_pages (id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES public.users (id)      ON DELETE CASCADE,
    content    TEXT        NOT NULL CHECK (char_length(content) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Anyone (including unauthenticated visitors) can read comments.
DROP POLICY IF EXISTS "Comments: public read" ON public.comments;
CREATE POLICY "Comments: public read"
    ON public.comments FOR SELECT
    USING (true);

-- Authenticated users may insert comments attributed to themselves only.
DROP POLICY IF EXISTS "Comments: own insert" ON public.comments;
CREATE POLICY "Comments: own insert"
    ON public.comments FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Authors can delete their own comments.
DROP POLICY IF EXISTS "Comments: own delete" ON public.comments;
CREATE POLICY "Comments: own delete"
    ON public.comments FOR DELETE
    USING (auth.uid() = user_id);


-- =============================================================================
-- TABLE: saved_items
-- =============================================================================
-- Per-user bookmarks of Discovery feed items. item_data stores the whole
-- DiscoverItem payload as JSONB so the "Saved" view can re-render cards without
-- re-fetching the live external sources. UNIQUE (user_id, item_id) prevents the
-- same item being saved twice. Fully private — users only ever see their own.
-- user_id FK -> auth.users(id).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.saved_items (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    item_id    TEXT        NOT NULL,                 -- DiscoverItem.id (e.g. "pubmed-12345")
    item_data  JSONB       NOT NULL DEFAULT '{}',    -- the full DiscoverItem, for re-render
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, item_id)                        -- can't bookmark the same item twice
);

ALTER TABLE public.saved_items ENABLE ROW LEVEL SECURITY;

-- Users can read, insert, and delete only their OWN saved items.
DROP POLICY IF EXISTS "saved_items_select_own" ON public.saved_items;
CREATE POLICY "saved_items_select_own"
    ON public.saved_items FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "saved_items_insert_own" ON public.saved_items;
CREATE POLICY "saved_items_insert_own"
    ON public.saved_items FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "saved_items_delete_own" ON public.saved_items;
CREATE POLICY "saved_items_delete_own"
    ON public.saved_items FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);


-- =============================================================================
-- TABLE: projects
-- =============================================================================
-- Saved Navigator proposals. Each row is one generated phased-document proposal
-- so it can be reopened as the exact same document later WITHOUT re-calling the
-- LLM. input_data stores the full 7-field form input (for the recap block and a
-- regenerate/edit flow); output_data stores the full generated phased-document
-- output (rendered verbatim on reopen). Fully private — users only ever see
-- their own projects. user_id FK -> auth.users(id).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.projects (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    title       TEXT,                                 -- proposal title (7-field input's title)
    input_data  JSONB       NOT NULL DEFAULT '{}',    -- full 7-field form input, for recap / regenerate
    output_data JSONB       NOT NULL DEFAULT '{}',    -- full generated phased document, for reopen
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Users can read, insert, update, and delete only their OWN projects.
DROP POLICY IF EXISTS "projects_select_own" ON public.projects;
CREATE POLICY "projects_select_own"
    ON public.projects FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "projects_insert_own" ON public.projects;
CREATE POLICY "projects_insert_own"
    ON public.projects FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "projects_update_own" ON public.projects;
CREATE POLICY "projects_update_own"
    ON public.projects FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "projects_delete_own" ON public.projects;
CREATE POLICY "projects_delete_own"
    ON public.projects FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);


-- =============================================================================
-- TABLE: connection_requests
-- =============================================================================
-- On-platform "Connect" requests from a researcher to a provider (SPARC) from
-- their Navigator proposal. This is the attribution/tracking mechanism — no
-- email/external contact is ever exchanged; SPARC responds through the platform
-- (admin/response UI is a later phase). Writes are session-scoped (user_id from
-- the validated session, never the body) and RLS-enforced. project_id is
-- ON DELETE SET NULL so the attribution record survives a proposal deletion, and
-- nullable because the proposal may be unsaved when Connect is clicked.
-- user_id FK -> auth.users(id); project_id FK -> public.projects(id).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.connection_requests (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES auth.users (id)  ON DELETE CASCADE,   -- the requester (from session)
    provider_name TEXT        NOT NULL,                             -- e.g. "UAB SPARC"
    capability    TEXT,                                             -- the specific capability/service clicked
    project_id    UUID        REFERENCES public.projects (id)      ON DELETE SET NULL,  -- proposal, if saved (nullable)
    message       TEXT        NOT NULL DEFAULT '',                  -- optional researcher note
    status        TEXT        NOT NULL DEFAULT 'new'                -- lifecycle; admin flow lands later
                      CHECK (status IN ('new', 'seen', 'responded', 'closed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.connection_requests ENABLE ROW LEVEL SECURITY;

-- A user can read only their OWN requests. (SPARC-admin read is a later phase —
-- intentionally NOT added here.)
DROP POLICY IF EXISTS "connection_requests_select_own" ON public.connection_requests;
CREATE POLICY "connection_requests_select_own"
    ON public.connection_requests FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- A user can insert requests attributed to themselves only.
DROP POLICY IF EXISTS "connection_requests_insert_own" ON public.connection_requests;
CREATE POLICY "connection_requests_insert_own"
    ON public.connection_requests FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);


-- =============================================================================
-- TABLE: promote_captures
-- =============================================================================
-- Captured identity of an EXTERNAL researcher (an author of a paper) submitted
-- through the "Promote" flow — NOT the logged-in caller's own profile. Because
-- the subject is a third party, this table intentionally does NOT follow the
-- auth.uid() = user_id ownership model used by users / researcher_works: anyone
-- (including anonymous visitors) may INSERT a capture, and there is deliberately
-- NO client-facing SELECT/UPDATE/DELETE policy — reads happen server-side with
-- the service-role key only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.promote_captures (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    doi          TEXT,                                 -- paper DOI (nullable; PMID-only captures)
    pmid         TEXT,                                 -- paper PubMed ID (nullable)
    paper_title  TEXT,                                 -- resolved title of the promoted paper
    author_name  TEXT,                                 -- captured external researcher's name
    orcid        TEXT,                                 -- their ORCID iD
    linkedin_url TEXT,                                 -- their LinkedIn profile
    created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.promote_captures ENABLE ROW LEVEL SECURITY;

-- Public insert only — this captures an external researcher's identity, not the
-- logged-in caller's. No select/update/delete policy for the client; reads
-- happen server-side/service-role only.
DROP POLICY IF EXISTS "anyone can insert promote captures" ON public.promote_captures;
CREATE POLICY "anyone can insert promote captures"
    ON public.promote_captures FOR INSERT
    WITH CHECK (true);


-- =============================================================================
-- TABLE: lab_resources
-- =============================================================================
-- "Collaboration" feature — a lab resource registry replacing the manually-
-- shared spreadsheet UAB's Neuro-oncology group uses to offer resources for
-- collaboration. ONE generic table across all 8 spreadsheet categories; only the
-- 'technique' UI/flow is built in v1, the other 7 are schema-ready (add new forms
-- later with NO schema change). Category-specific data lives in `fields` (jsonb),
-- e.g. {"name","pi_lab","protocol_link"} for a technique. `contact_info` is what
-- the owner explicitly chooses to show on Connect — NOT their account email, and
-- never joined from public.users. It is returned by exactly one auth-gated route
-- (/contact); the public browse read never selects it.
-- owner_id FK -> public.users(id).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.lab_resources (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID        NOT NULL REFERENCES public.users (id),  -- owner (from session, never client body)
    category     TEXT        NOT NULL,   -- 'technique' | 'equipment' | 'vector' | 'animal_model'
                                         -- | 'cell_line' | 'protein_antibody' | 'software' | 'drug'
    fields       JSONB       NOT NULL DEFAULT '{}',   -- category-specific data (e.g. name, pi_lab, protocol_link)
    contact_info TEXT,                                -- owner-chosen contact text; NOT their account email
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.lab_resources ENABLE ROW LEVEL SECURITY;

-- Public read — the registry is openly browsable. Exposes every column at the DB
-- level; the public browse API deliberately does NOT select contact_info (only
-- the auth-gated /contact route returns it).
DROP POLICY IF EXISTS "anyone can read lab resources" ON public.lab_resources;
CREATE POLICY "anyone can read lab resources"
    ON public.lab_resources FOR SELECT
    USING (true);

-- Authenticated users may insert resources they own only.
DROP POLICY IF EXISTS "authenticated users can insert own resource" ON public.lab_resources;
CREATE POLICY "authenticated users can insert own resource"
    ON public.lab_resources FOR INSERT
    WITH CHECK (auth.uid() = owner_id);

-- Owners may update / delete only their own resources.
DROP POLICY IF EXISTS "owner can update own resource" ON public.lab_resources;
CREATE POLICY "owner can update own resource"
    ON public.lab_resources FOR UPDATE
    USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "owner can delete own resource" ON public.lab_resources;
CREATE POLICY "owner can delete own resource"
    ON public.lab_resources FOR DELETE
    USING (auth.uid() = owner_id);


-- =============================================================================
-- INDEXES
-- =============================================================================
-- Additional indexes on columns used in frequent queries / filters.

CREATE INDEX IF NOT EXISTS idx_wiki_pages_episode_number ON public.wiki_pages (episode_number);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_slug           ON public.wiki_pages (slug);
CREATE INDEX IF NOT EXISTS idx_nodes_type                ON public.nodes (type);
CREATE INDEX IF NOT EXISTS idx_edges_source              ON public.edges (source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target              ON public.edges (target_id);
CREATE INDEX IF NOT EXISTS idx_comments_wiki_id          ON public.comments (wiki_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id          ON public.comments (user_id);
CREATE INDEX IF NOT EXISTS idx_researcher_works_user     ON public.researcher_works (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_providers_type            ON public.providers (type);
CREATE INDEX IF NOT EXISTS idx_saved_items_user           ON public.saved_items (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_user              ON public.projects (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connection_requests_user   ON public.connection_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connection_requests_status ON public.connection_requests (status);
CREATE INDEX IF NOT EXISTS idx_lab_resources_category      ON public.lab_resources (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_resources_owner         ON public.lab_resources (owner_id);
