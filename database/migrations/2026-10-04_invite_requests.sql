-- =============================================================================
-- Migration: invite_requests  (2026-10-04)
-- =============================================================================
-- Where the /invite form writes. Invites are handled by hand for now (no code
-- redemption logic exists), so this table is just an inbox: read it from the
-- Supabase dashboard with the service role.
--
-- RLS: INSERT open to anon AND authenticated, because the visitor is logged
-- out by definition. SELECT is granted to NOBODY: no select policy at all. The
-- table holds names and email addresses, so a public-read policy would leak
-- every one of them.
--
-- Because there is no SELECT policy, the app's insert must NOT chain
-- .select() (INSERT ... RETURNING needs a passing SELECT policy and fails
-- with a 42501 RLS error). Same gotcha as public.feedback. See
-- frontend/lib/server/invite.ts.
--
-- Spam: writable by anyone with no auth; the only defense is the length
-- CHECKs below. No CAPTCHA, no rate limiting.
--
-- Run on the DEV Supabase project first, in the SQL editor. Idempotent: safe
-- to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.invite_requests (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    name         TEXT        NOT NULL,
    email        TEXT        NOT NULL,
    organization TEXT        NOT NULL,
    role         TEXT        NOT NULL,
    interests    TEXT[]      NOT NULL DEFAULT '{}',
    message      TEXT,
    source_page  TEXT
);

ALTER TABLE public.invite_requests DROP CONSTRAINT IF EXISTS invite_requests_name_check;
ALTER TABLE public.invite_requests ADD CONSTRAINT invite_requests_name_check
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);

ALTER TABLE public.invite_requests DROP CONSTRAINT IF EXISTS invite_requests_email_check;
ALTER TABLE public.invite_requests ADD CONSTRAINT invite_requests_email_check
    CHECK (char_length(email) <= 320 AND email LIKE '%_@_%.__%');

ALTER TABLE public.invite_requests DROP CONSTRAINT IF EXISTS invite_requests_organization_check;
ALTER TABLE public.invite_requests ADD CONSTRAINT invite_requests_organization_check
    CHECK (char_length(btrim(organization)) BETWEEN 1 AND 200);

ALTER TABLE public.invite_requests DROP CONSTRAINT IF EXISTS invite_requests_role_check;
ALTER TABLE public.invite_requests ADD CONSTRAINT invite_requests_role_check
    CHECK (role IN ('Researcher', 'Industry', 'Vendor or CRO', 'Other'));

ALTER TABLE public.invite_requests DROP CONSTRAINT IF EXISTS invite_requests_interests_check;
ALTER TABLE public.invite_requests ADD CONSTRAINT invite_requests_interests_check
    CHECK (cardinality(interests) <= 10);

ALTER TABLE public.invite_requests DROP CONSTRAINT IF EXISTS invite_requests_message_check;
ALTER TABLE public.invite_requests ADD CONSTRAINT invite_requests_message_check
    CHECK (message IS NULL OR char_length(message) <= 2000);

ALTER TABLE public.invite_requests DROP CONSTRAINT IF EXISTS invite_requests_source_page_check;
ALTER TABLE public.invite_requests ADD CONSTRAINT invite_requests_source_page_check
    CHECK (source_page IS NULL OR char_length(source_page) <= 500);

ALTER TABLE public.invite_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invite_requests_insert_anyone" ON public.invite_requests;
CREATE POLICY "invite_requests_insert_anyone"
    ON public.invite_requests FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Deliberately NO select policy: every role is denied reads by default.
-- Only the service role (Supabase dashboard) can read this table.

-- INSERT only, no table-level SELECT/UPDATE/DELETE for the public roles.
REVOKE ALL ON public.invite_requests FROM anon, authenticated;
GRANT INSERT ON public.invite_requests TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_invite_requests_created
    ON public.invite_requests (created_at DESC);
