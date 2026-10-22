-- 2026-10-25  Service Providers directory (/collaborate/providers)
--
-- Four tables behind the directory. The provider list itself is NOT in the
-- database: it is frontend/lib/data/providers.json, and `slug` below is a
-- provider's slug from that file (so there is no foreign key).
--
--   provider_events          website clicks and profile views (anon may insert)
--   provider_quote_requests  "Request a quote" (signed-in members)
--   provider_claims          "Claim this page" (signed-in members)
--   provider_requests        "List your services" (signed-in members)
--
-- Access, in short:
--   * No table has a public read. RLS is on and there is no SELECT policy for
--     anon.
--   * Signed-in members INSERT their own rows (user_id = auth.uid()) and READ
--     their own quote requests, claims and provider requests.
--   * Site admins (public.is_site_admin()) READ and UPDATE everything.
--   * provider_events: the only anon write in this file. Anyone, signed in or
--     not, may INSERT a row with only the safe columns (slug, event, user_id,
--     referrer): user_id must be NULL or the caller's own id, and event must be
--     one of the two known values. Nobody but admins can read events back.
--   * No DELETE policies: nothing is removed from the app.
--
-- Needs public.is_site_admin() and public.site_admins from
-- 2026-10-24_promote_redesign.sql (already applied). Re-runnable: every
-- statement is idempotent. Paste into the Supabase SQL editor.

-- ── provider_events ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provider_events (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       TEXT        NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 100),
    event      TEXT        NOT NULL CHECK (event IN ('website_click', 'profile_view')),
    user_id    UUID        REFERENCES auth.users (id) ON DELETE SET NULL,
    referrer   TEXT        NOT NULL DEFAULT '' CHECK (char_length(referrer) <= 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_events_slug_created_idx
    ON public.provider_events (slug, created_at DESC);
CREATE INDEX IF NOT EXISTS provider_events_created_idx
    ON public.provider_events (created_at DESC);

ALTER TABLE public.provider_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_events_insert ON public.provider_events;
CREATE POLICY provider_events_insert ON public.provider_events
    FOR INSERT TO anon, authenticated
    WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS provider_events_admin_select ON public.provider_events;
CREATE POLICY provider_events_admin_select ON public.provider_events
    FOR SELECT TO authenticated
    USING (public.is_site_admin());

-- Table privileges: anon gets INSERT only (and only the four safe columns).
REVOKE ALL ON public.provider_events FROM anon;
GRANT INSERT (slug, event, user_id, referrer) ON public.provider_events TO anon;
GRANT SELECT, INSERT ON public.provider_events TO authenticated;

-- ── provider_quote_requests ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provider_quote_requests (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       TEXT        NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 100),
    user_id    UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    name       TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    email      TEXT        NOT NULL CHECK (char_length(email) <= 200),
    need       TEXT        NOT NULL CHECK (char_length(need) BETWEEN 1 AND 1000),
    timeline   TEXT        NOT NULL CHECK (char_length(timeline) BETWEEN 1 AND 50),
    budget     TEXT        NOT NULL DEFAULT '' CHECK (char_length(budget) <= 100),
    message    TEXT        NOT NULL DEFAULT '' CHECK (char_length(message) <= 2000),
    status     TEXT        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_quote_requests_slug_created_idx
    ON public.provider_quote_requests (slug, created_at DESC);
CREATE INDEX IF NOT EXISTS provider_quote_requests_user_idx
    ON public.provider_quote_requests (user_id, created_at DESC);

ALTER TABLE public.provider_quote_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_quote_requests_insert ON public.provider_quote_requests;
CREATE POLICY provider_quote_requests_insert ON public.provider_quote_requests
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() AND status = 'new');

DROP POLICY IF EXISTS provider_quote_requests_select ON public.provider_quote_requests;
CREATE POLICY provider_quote_requests_select ON public.provider_quote_requests
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.is_site_admin());

DROP POLICY IF EXISTS provider_quote_requests_admin_update ON public.provider_quote_requests;
CREATE POLICY provider_quote_requests_admin_update ON public.provider_quote_requests
    FOR UPDATE TO authenticated
    USING (public.is_site_admin())
    WITH CHECK (public.is_site_admin());

-- ── provider_claims ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provider_claims (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       TEXT        NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 100),
    user_id    UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    name       TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    role       TEXT        NOT NULL CHECK (char_length(role) BETWEEN 1 AND 120),
    work_email TEXT        NOT NULL CHECK (char_length(work_email) BETWEEN 3 AND 200),
    note       TEXT        NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
    status     TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_claims_slug_created_idx
    ON public.provider_claims (slug, created_at DESC);
CREATE INDEX IF NOT EXISTS provider_claims_user_idx
    ON public.provider_claims (user_id, created_at DESC);

ALTER TABLE public.provider_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_claims_insert ON public.provider_claims;
CREATE POLICY provider_claims_insert ON public.provider_claims
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() AND status = 'pending');

DROP POLICY IF EXISTS provider_claims_select ON public.provider_claims;
CREATE POLICY provider_claims_select ON public.provider_claims
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.is_site_admin());

DROP POLICY IF EXISTS provider_claims_admin_update ON public.provider_claims;
CREATE POLICY provider_claims_admin_update ON public.provider_claims
    FOR UPDATE TO authenticated
    USING (public.is_site_admin())
    WITH CHECK (public.is_site_admin());

-- ── provider_requests ("List your services") ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provider_requests (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    company      TEXT        NOT NULL CHECK (char_length(company) BETWEEN 1 AND 120),
    website      TEXT        NOT NULL CHECK (char_length(website) BETWEEN 1 AND 300),
    contact_name TEXT        NOT NULL CHECK (char_length(contact_name) BETWEEN 1 AND 120),
    email        TEXT        NOT NULL CHECK (char_length(email) BETWEEN 3 AND 200),
    offer        TEXT        NOT NULL CHECK (char_length(offer) BETWEEN 1 AND 1500),
    status       TEXT        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'added', 'declined')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_requests_created_idx
    ON public.provider_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS provider_requests_user_idx
    ON public.provider_requests (user_id, created_at DESC);

ALTER TABLE public.provider_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_requests_insert ON public.provider_requests;
CREATE POLICY provider_requests_insert ON public.provider_requests
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() AND status = 'new');

DROP POLICY IF EXISTS provider_requests_select ON public.provider_requests;
CREATE POLICY provider_requests_select ON public.provider_requests
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.is_site_admin());

DROP POLICY IF EXISTS provider_requests_admin_update ON public.provider_requests;
CREATE POLICY provider_requests_admin_update ON public.provider_requests
    FOR UPDATE TO authenticated
    USING (public.is_site_admin())
    WITH CHECK (public.is_site_admin());
