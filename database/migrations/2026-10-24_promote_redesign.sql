-- =============================================================================
-- Migration: promote_redesign  (2026-10-24)
-- =============================================================================
-- What the redesigned Promote needs on top of promote_showcase:
--
--   1. More item types. The CHECK on `type` is widened to the thirteen types
--      (paper, preprint, talk, poster, event, achievement, breakthrough,
--      partnership, funding, tool, service, dataset, other). The old values
--      ('award', 'case_study', 'white_paper') stay VALID and no row is
--      rewritten: the app maps them when it reads (award -> achievement,
--      case_study -> achievement, white_paper -> paper), so every existing
--      item keeps working and keeps its URL.
--
--   2. Per-item content, all with defaults so existing rows need no backfill:
--        key_facts    jsonb  [{label, value} x 3]. '[]' = none stored; the app
--                            then derives three facts from the text the author
--                            already wrote.
--        cta_label    text   the main button's label (NULL = the type's default)
--        cta_url      text   the main button's link (NULL = DOI / link / slides)
--        event_starts_at timestamptz, event_location text   for type 'event'
--        featured     bool   shown large at the top of /promote (admin-set)
--        quote        text   a quote the AUTHOR entered. The app never writes it.
--        quote_by     text   who the quote is from
--        share_text   jsonb  {linkedin, x, bluesky} ready-to-post drafts
--
--   3. Who may set `featured`. promote_showcase_update_own lets an owner update
--      any column of their own row, so `featured` is guarded by a trigger: only
--      a site admin (a row in public.site_admins) or a session-less caller (the
--      SQL editor / service role) can change it. An owner's insert or update
--      that tries to set it is quietly reset to its old value (false on insert).
--      There is no existing site-wide admin concept (community admins are per
--      community), so site_admins is new: RLS lets a user read ONLY their own
--      row and there are no write policies, so admins are added from the SQL
--      editor, for example:
--          INSERT INTO public.site_admins (user_id)
--          SELECT id FROM auth.users WHERE email = 'someone@example.org';
--
-- RLS on promote_showcase itself is unchanged: published rows stay publicly
-- readable, drafts stay owner-only, writes stay owner-only. The new columns are
-- covered by those same policies. Nothing here exposes any new row to any new
-- reader.
--
-- Idempotent (IF NOT EXISTS, DROP ... IF EXISTS before CREATE), safe to re-run.
-- NOT run against any database as part of writing this file: paste it into the
-- Supabase SQL editor.
-- =============================================================================

-- ── 1. Types ─────────────────────────────────────────────────────────────────

ALTER TABLE public.promote_showcase DROP CONSTRAINT IF EXISTS promote_showcase_type_check;
ALTER TABLE public.promote_showcase
    ADD CONSTRAINT promote_showcase_type_check CHECK (type IN (
        'paper', 'preprint', 'talk', 'poster', 'event', 'achievement',
        'breakthrough', 'partnership', 'funding', 'tool', 'service', 'dataset',
        'other',
        -- older values, kept valid (mapped by the app when read)
        'award', 'case_study', 'white_paper'
    ));

-- ── 2. Per-item content ──────────────────────────────────────────────────────

ALTER TABLE public.promote_showcase
    ADD COLUMN IF NOT EXISTS key_facts       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS cta_label       TEXT,
    ADD COLUMN IF NOT EXISTS cta_url         TEXT,
    ADD COLUMN IF NOT EXISTS event_starts_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS event_location  TEXT,
    ADD COLUMN IF NOT EXISTS featured        BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS quote           TEXT,
    ADD COLUMN IF NOT EXISTS quote_by        TEXT,
    ADD COLUMN IF NOT EXISTS share_text      JSONB       NOT NULL DEFAULT '{}'::jsonb;

-- key_facts must be a JSON array, share_text a JSON object.
ALTER TABLE public.promote_showcase DROP CONSTRAINT IF EXISTS promote_showcase_key_facts_array;
ALTER TABLE public.promote_showcase
    ADD CONSTRAINT promote_showcase_key_facts_array CHECK (jsonb_typeof(key_facts) = 'array');

ALTER TABLE public.promote_showcase DROP CONSTRAINT IF EXISTS promote_showcase_share_text_object;
ALTER TABLE public.promote_showcase
    ADD CONSTRAINT promote_showcase_share_text_object CHECK (jsonb_typeof(share_text) = 'object');

-- Reasonable bounds, so a pasted wall of text cannot become a "quote".
ALTER TABLE public.promote_showcase DROP CONSTRAINT IF EXISTS promote_showcase_quote_length;
ALTER TABLE public.promote_showcase
    ADD CONSTRAINT promote_showcase_quote_length CHECK (
        (quote IS NULL OR char_length(quote) <= 600)
        AND (quote_by IS NULL OR char_length(quote_by) <= 120)
    );

-- The front page asks for "newest featured" among published rows.
CREATE INDEX IF NOT EXISTS idx_promote_showcase_featured
    ON public.promote_showcase (featured, published_at DESC)
    WHERE featured = true;

-- ── 3. Site admins and the featured guard ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_admins (
    user_id    UUID        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.site_admins ENABLE ROW LEVEL SECURITY;

-- A signed-in user can see only their own row (enough for the app to know
-- "am I an admin"). No INSERT / UPDATE / DELETE policy exists, so nobody can
-- make themselves an admin through the API.
DROP POLICY IF EXISTS "site_admins_select_own" ON public.site_admins;
CREATE POLICY "site_admins_select_own"
    ON public.site_admins FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.is_site_admin()
RETURNS BOOLEAN
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM public.site_admins WHERE user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_site_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_site_admin() TO anon, authenticated;

-- Only an admin (or a session-less caller such as the SQL editor) may change
-- `featured`. Anyone else's attempt is reset to the old value; on INSERT the
-- new row is simply not featured.
CREATE OR REPLACE FUNCTION public.promote_showcase_guard_featured()
RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL OR public.is_site_admin() THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.featured := false;
    ELSE
        NEW.featured := OLD.featured;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS promote_showcase_guard_featured ON public.promote_showcase;
CREATE TRIGGER promote_showcase_guard_featured
    BEFORE INSERT OR UPDATE ON public.promote_showcase
    FOR EACH ROW EXECUTE FUNCTION public.promote_showcase_guard_featured();
