-- =============================================================================
-- Migration: feedback  (2026-07-29)
-- =============================================================================
-- Captures what a researcher actually wanted, in their own words, with no
-- modal, no rating, and no login. One-time visitors (Thursday's info-session
-- traffic) need to be able to leave a trace on their very first — and maybe
-- only — visit.
--
-- message is nullable ON PURPOSE. A failed /explore/[topic] search with
-- nothing typed still writes a row: page_path + the query in context, no
-- message. That row, not a filled-in comment box, is the most valuable thing
-- this table captures — do not make message required later without
-- re-reading this comment.
--
-- user_id is nullable and ON DELETE SET NULL, not CASCADE. Account deletion
-- removes the account; it must not also erase what that person told us.
--
-- RLS: INSERT open to anon AND authenticated — the whole point is it works
-- logged out. SELECT is granted to NOBODY; this is read from the Supabase
-- dashboard with the service role only. Do not add a public/select policy
-- here — a publicly-writable table with a public-read policy would let
-- anyone read every email address ever left in this table.
--
-- Spam: this table is writable by anyone with no auth. The only defense
-- here is CHECK constraints capping message/email length — nothing more
-- elaborate (no CAPTCHA, no rate limiting) per the brief.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.feedback (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    page_path   TEXT        NOT NULL,
    message     TEXT,                                   -- nullable ON PURPOSE, see above
    context     JSONB       NOT NULL DEFAULT '{}',       -- search query, filters, etc.
    email       TEXT,                                    -- optional, "only if you want a reply"
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
        CHECK (email IS NULL OR char_length(email) <= 320); -- RFC 5321 max mailbox length

ALTER TABLE public.feedback
    DROP CONSTRAINT IF EXISTS feedback_page_path_length_check;
ALTER TABLE public.feedback
    ADD CONSTRAINT feedback_page_path_length_check
        CHECK (char_length(page_path) <= 500);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Anyone can submit feedback — signed in or not. This is the entire feature:
-- a Thursday info-session visitor who never creates an account must still be
-- able to leave a row.
DROP POLICY IF EXISTS "feedback_insert_anyone" ON public.feedback;
CREATE POLICY "feedback_insert_anyone"
    ON public.feedback FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Deliberately NO select policy. RLS with zero SELECT policies denies every
-- role by default — read access is the service-role key in the Supabase
-- dashboard only. Do not add "feedback_select_own" or similar: a submitter
-- reading their own row back is not a requirement here, and the anon INSERT
-- policy above means "own" can't even be established for a logged-out
-- submitter.

CREATE INDEX IF NOT EXISTS idx_feedback_created ON public.feedback (created_at DESC);
