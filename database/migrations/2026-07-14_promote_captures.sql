-- =============================================================================
-- Migration: promote_captures  (2026-07-14)
-- =============================================================================
-- Step 1 of the "Promote" feature. Captures the identity of an EXTERNAL
-- researcher (a paper author) submitted through the Promote flow — NOT the
-- logged-in caller. Run once in the Supabase SQL editor (the repo's migration
-- convention; see CLAUDE.md). Also folded into database/schema.sql so a
-- from-scratch rebuild includes it. Idempotent.
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

-- Public insert only — this captures an external researcher's identity, not the
-- logged-in caller's. No select/update/delete policy for the client; reads
-- happen server-side/service-role only.
DROP POLICY IF EXISTS "anyone can insert promote captures" ON public.promote_captures;
CREATE POLICY "anyone can insert promote captures"
    ON public.promote_captures FOR INSERT
    WITH CHECK (true);
