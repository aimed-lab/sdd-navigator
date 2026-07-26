-- =============================================================================
-- Migration: collab_posts  (2026-07-26)
-- =============================================================================
-- The unified haves/needs Collaborate board. One post carries BOTH what a lab
-- can offer (`haves`) and what it is looking for (`needs`) — that pairing is the
-- feature; a post may have either, or both.
--
-- Run once in the Supabase SQL editor (the repo's migration convention; see
-- CLAUDE.md). Also folded into database/schema.sql so a from-scratch rebuild
-- includes it. Idempotent — safe to re-run.
--
-- Part 2 extends `connection_requests` so the SAME table records a response to a
-- board post. Existing provider-card usage is unaffected: every new column is
-- nullable, and the one added CHECK is satisfied by every existing row.
-- =============================================================================


-- ── 1. collab_posts ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.collab_posts (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    title          TEXT        NOT NULL,
    description    TEXT        NOT NULL DEFAULT '',
    research_areas TEXT[]      NOT NULL DEFAULT '{}',
    haves          TEXT[]      NOT NULL DEFAULT '{}',   -- what this lab can offer
    needs          TEXT[]      NOT NULL DEFAULT '{}',   -- what this lab is looking for
    stage          TEXT        NOT NULL DEFAULT 'concept'
                        CHECK (stage IN ('concept', 'early_data', 'validation',
                                         'preclinical', 'seeking_team')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.collab_posts ENABLE ROW LEVEL SECURITY;

-- Anyone (signed in or not) can BROWSE the board. This is the point of the
-- feature — discovery must not require an account.
DROP POLICY IF EXISTS "collab_posts_public_select" ON public.collab_posts;
CREATE POLICY "collab_posts_public_select"
    ON public.collab_posts FOR SELECT
    USING (true);

-- Write is owner-only, in all three directions. owner_id is derived from the
-- session in lib/server/collab.ts; these policies enforce it at the DB level so
-- a forged owner_id in a request body is rejected by Postgres, not by app code.
DROP POLICY IF EXISTS "collab_posts_insert_own" ON public.collab_posts;
CREATE POLICY "collab_posts_insert_own"
    ON public.collab_posts FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = owner_id);

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

-- Keep updated_at honest on edit.
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


-- ── 2. connection_requests: post responses ───────────────────────────────────
-- Additive only. Both columns are nullable, so every existing insert path
-- (provider cards) keeps working untouched.

ALTER TABLE public.connection_requests
    ADD COLUMN IF NOT EXISTS post_id UUID
        REFERENCES public.collab_posts (id) ON DELETE CASCADE;

ALTER TABLE public.connection_requests
    ADD COLUMN IF NOT EXISTS interest_type TEXT;

-- interest_type is constrained but NULLABLE — provider-card requests leave it
-- unset, and the CHECK passes for NULL.
ALTER TABLE public.connection_requests
    DROP CONSTRAINT IF EXISTS connection_requests_interest_type_check;
ALTER TABLE public.connection_requests
    ADD CONSTRAINT connection_requests_interest_type_check
        CHECK (interest_type IS NULL OR interest_type IN
               ('can_provide', 'want_to_join', 'want_to_use', 'general'));

-- A post response has no provider, so provider_name must be allowed to be NULL
-- for that flow. Relax the NOT NULL and replace it with a rule that says a row
-- must be ONE of the two kinds. Every existing row has provider_name set, so
-- this validates cleanly.
ALTER TABLE public.connection_requests
    ALTER COLUMN provider_name DROP NOT NULL;

ALTER TABLE public.connection_requests
    DROP CONSTRAINT IF EXISTS connection_requests_target_check;
ALTER TABLE public.connection_requests
    ADD CONSTRAINT connection_requests_target_check
        CHECK (provider_name IS NOT NULL OR post_id IS NOT NULL);


-- ── 3. Public interest counts ────────────────────────────────────────────────
-- The board shows "N interested" per post, but connection_requests SELECT is
-- restricted to the requester's OWN rows — so nobody can count them directly,
-- and that restriction should stay (the rows carry messages and identities).
--
-- This SECURITY DEFINER function exposes ONLY an aggregate count per post: no
-- user ids, no messages, no interest types. Distinct user_id so one person
-- responding twice counts once.

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


-- ── 4. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_collab_posts_created ON public.collab_posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_posts_owner   ON public.collab_posts (owner_id);
CREATE INDEX IF NOT EXISTS idx_collab_posts_stage   ON public.collab_posts (stage);
-- GIN indexes make the array filters (areas / haves / needs) cheap.
CREATE INDEX IF NOT EXISTS idx_collab_posts_areas   ON public.collab_posts USING GIN (research_areas);
CREATE INDEX IF NOT EXISTS idx_collab_posts_haves   ON public.collab_posts USING GIN (haves);
CREATE INDEX IF NOT EXISTS idx_collab_posts_needs   ON public.collab_posts USING GIN (needs);
CREATE INDEX IF NOT EXISTS idx_connection_requests_post ON public.connection_requests (post_id);
