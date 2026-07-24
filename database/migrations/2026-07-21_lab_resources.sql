-- =============================================================================
-- Migration: lab_resources  (2026-07-21)
-- =============================================================================
-- V1 of the "Collaboration" feature — a lab resource registry that replaces the
-- manually-shared spreadsheet UAB's Neuro-oncology group uses to offer lab
-- resources for collaboration. Run once in the Supabase SQL editor (the repo's
-- migration convention; see CLAUDE.md). Also folded into database/schema.sql so
-- a from-scratch rebuild includes it. Idempotent.
--
-- ONE generic table across all 8 spreadsheet categories (technique, equipment,
-- vector, animal_model, cell_line, protein_antibody, software, drug). Only the
-- 'technique' UI/flow is built in v1; the other 7 are schema-ready (add them
-- later by writing new forms — NO schema change needed). Category-specific data
-- lives in `fields` (jsonb), e.g. {"name","pi_lab","protocol_link"} for a
-- technique.
--
-- `contact_info` is what the owner EXPLICITLY chooses to show when someone clicks
-- Connect — it is NOT their account email and is never joined from public.users.
-- It is returned by exactly one auth-gated route (/contact); the public browse
-- read never selects it.
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

-- Public read — the registry is openly browsable (incl. anonymous visitors).
-- NOTE: this exposes every column, including contact_info, at the DB level. The
-- public browse API deliberately does NOT select contact_info; only the
-- auth-gated /contact route returns it. (RLS is the trust boundary for WRITES;
-- column exposure on READ is enforced in the API layer, matching how the rest of
-- this repo handles public reads.)
DROP POLICY IF EXISTS "anyone can read lab resources" ON public.lab_resources;
CREATE POLICY "anyone can read lab resources"
    ON public.lab_resources FOR SELECT
    USING (true);

-- Authenticated users may insert resources they own only.
DROP POLICY IF EXISTS "authenticated users can insert own resource" ON public.lab_resources;
CREATE POLICY "authenticated users can insert own resource"
    ON public.lab_resources FOR INSERT
    WITH CHECK (auth.uid() = owner_id);

-- Owners may update only their own resources.
DROP POLICY IF EXISTS "owner can update own resource" ON public.lab_resources;
CREATE POLICY "owner can update own resource"
    ON public.lab_resources FOR UPDATE
    USING (auth.uid() = owner_id);

-- Owners may delete only their own resources.
DROP POLICY IF EXISTS "owner can delete own resource" ON public.lab_resources;
CREATE POLICY "owner can delete own resource"
    ON public.lab_resources FOR DELETE
    USING (auth.uid() = owner_id);

-- Indexes for the browse filters (category + newest-first) and owner lookups.
CREATE INDEX IF NOT EXISTS idx_lab_resources_category ON public.lab_resources (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_resources_owner    ON public.lab_resources (owner_id);
