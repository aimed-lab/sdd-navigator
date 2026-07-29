-- =============================================================================
-- Migration: collab_posts_funding_status  (2026-07-28)
-- =============================================================================
-- Adds `funding_status` to collab_posts: whether money already exists for the
-- work behind a post. "Seeking co-investigator" means opposite things
-- depending on that — a funded project looking for a partner, vs. an unfunded
-- idea looking for someone to co-write the grant. Same words, opposite ask.
--
-- OPTIONAL AND NULLABLE, DELIBERATELY. The board has exactly one real post
-- today; making this required would cost posts at signup for a signal that's
-- genuinely optional to have an opinion about. NULL means "the poster didn't
-- say" and must be treated as exactly that everywhere it's read — rendered as
-- nothing, not as an "Unknown" pill. A missing value is not the fourth
-- funding state; it's the absence of one.
--
-- Same shape as `stage`: TEXT + CHECK, not an enum type — matches the existing
-- column exactly rather than introducing a second way of doing the same thing
-- in this table. The difference from `stage` is that `stage` is
-- NOT NULL DEFAULT 'concept' (every post has SOME stage) while
-- funding_status has no DEFAULT and stays NULL until a poster picks one.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================


-- ── 1. collab_posts.funding_status ───────────────────────────────────────────

ALTER TABLE public.collab_posts
    ADD COLUMN IF NOT EXISTS funding_status TEXT;

ALTER TABLE public.collab_posts
    DROP CONSTRAINT IF EXISTS collab_posts_funding_status_check;
ALTER TABLE public.collab_posts
    ADD CONSTRAINT collab_posts_funding_status_check
        CHECK (funding_status IS NULL OR funding_status IN
               ('funded', 'applying', 'unfunded'));

-- funded    — money is in place
-- applying  — a grant is going in; looking for a co-applicant
-- unfunded  — no funding yet
-- NULL      — unspecified (the existing post, and every post until this ships
--             in the create-post form, lands here — the ALTER above leaves
--             every current row's funding_status NULL, which the CHECK
--             explicitly allows)


-- ── 2. Index ──────────────────────────────────────────────────────────────────
-- Partial: only rows that actually SET a funding_status are worth indexing —
-- filtering the board by funding status is a query over the minority who
-- specified one, not over the NULLs. Matches idx_connection_requests_unseen's
-- partial-index style in database/schema.sql.

CREATE INDEX IF NOT EXISTS idx_collab_posts_funding_status
    ON public.collab_posts (funding_status)
    WHERE funding_status IS NOT NULL;
