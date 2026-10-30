-- 2026-11-03  Community events (the Events tile and view on a community page)
--
-- One table, public.community_events: a talk, meetup or deadline a community's
-- admins list for its members.
--
-- Access (RLS)
--   * READ:   active members of the community (is_community_member). A non-member,
--             signed in or not, gets no rows.
--   * INSERT / UPDATE / DELETE: community admins (is_community_admin) only. An insert
--             must name the caller as created_by.
--   * No access at all for anon.
--
-- Needs 2026-08-20_communities.sql and 2026-08-30_community_admin_membership.sql
-- (is_community_member, is_community_admin). Idempotent: safe to re-run.
-- NOT RUN as part of writing it.

CREATE TABLE IF NOT EXISTS public.community_events (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    title        TEXT        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    starts_at    TIMESTAMPTZ NOT NULL,
    location     TEXT        CHECK (location IS NULL OR char_length(location) <= 200),
    link         TEXT        CHECK (link IS NULL OR (char_length(link) <= 500 AND link ~* '^https://')),
    description  TEXT        CHECK (description IS NULL OR char_length(description) <= 1000),
    created_by   UUID        REFERENCES public.users (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_events_community_start_idx
    ON public.community_events (community_id, starts_at);

ALTER TABLE public.community_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Community events: member select" ON public.community_events;
CREATE POLICY "Community events: member select"
    ON public.community_events FOR SELECT
    TO authenticated
    USING (public.is_community_member(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community events: admin insert" ON public.community_events;
CREATE POLICY "Community events: admin insert"
    ON public.community_events FOR INSERT
    TO authenticated
    WITH CHECK (
        created_by = auth.uid()
        AND public.is_community_admin(community_id, auth.uid())
    );

DROP POLICY IF EXISTS "Community events: admin update" ON public.community_events;
CREATE POLICY "Community events: admin update"
    ON public.community_events FOR UPDATE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()))
    WITH CHECK (public.is_community_admin(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community events: admin delete" ON public.community_events;
CREATE POLICY "Community events: admin delete"
    ON public.community_events FOR DELETE
    TO authenticated
    USING (public.is_community_admin(community_id, auth.uid()));

REVOKE ALL ON public.community_events FROM PUBLIC;
REVOKE ALL ON public.community_events FROM anon;
REVOKE ALL ON public.community_events FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_events TO authenticated;
-- Only these columns may be changed by an update (the community and the creator are fixed).
REVOKE UPDATE ON public.community_events FROM authenticated;
GRANT UPDATE (title, starts_at, location, link, description) ON public.community_events TO authenticated;
