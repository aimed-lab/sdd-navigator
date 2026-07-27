-- =============================================================================
-- Migration: collab_inbox  (2026-07-27)
-- =============================================================================
-- Gives a Collaborate post owner a way to SEE the responses aimed at their
-- posts. Until now `connection_requests` rows were write-only from the poster's
-- point of view: RLS is `SELECT USING (auth.uid() = user_id)`, which is the
-- REQUESTER's own rows — the exact opposite of what an inbox needs.
--
-- THE ACCESS RULE THIS ENCODES
-- You may read a connection_request if you OWN the collab_post it targets.
-- Nothing else changes: the existing "select own" policy stays exactly as it is,
-- so a requester still sees their own outbox, and NO new RLS policy widens the
-- table. The inbox is reachable ONLY through the three functions below, each of
-- which derives the caller from auth.uid() and takes no identity argument — so
-- there is no parameter a caller could tamper with to read someone else's inbox.
--
-- CONTACT IS SELF-PROVIDED — read this before changing anything here.
-- The inbox shows a `contact` string the RESPONDER TYPED THEMSELVES when they
-- responded (added in part 1). No email address is ever pulled from
-- auth.users or public.users, by these functions or by the app. That is a
-- deliberate privacy boundary, not an oversight: responding to a post shares
-- exactly the contact route the responder chose to share, with exactly one
-- person (the post owner), and nothing more. If a future change needs an email
-- here, that is a new consent decision — do not quietly join public.users.email
-- into inbox_requests().
--
-- What the responder's identity DOES include is name / affiliation /
-- institution, on the same rationale as collab_post_owners() in
-- 2026-07-26_collab_post_owners.sql: responding to a public board post is an
-- implicit choice to be identified by name to that post's owner. It is NOT a
-- choice to publish a profile, so profile_slug is returned only when the
-- responder's profile is already public, and no other users column is exposed.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================


-- ── 1. connection_requests.contact ───────────────────────────────────────────
-- Free text, supplied by the responder ("How can they reach you?"). Nullable and
-- defaulted so every existing row and every existing insert path (provider
-- cards, earlier board responses) stays valid.
--
-- Deliberately NOT typed as an email: the responder may prefer a lab phone, a
-- Slack handle, an ORCID, "reach me via the platform", anything. The app caps
-- its length; no format is assumed or validated here.

ALTER TABLE public.connection_requests
    ADD COLUMN IF NOT EXISTS contact TEXT NOT NULL DEFAULT '';


-- ── 2. inbox_requests() — the owner-scoped read ───────────────────────────────
-- Every response aimed at a post the CALLER owns, newest first.
--
-- SECURITY DEFINER because the caller must read rows that the table's own
-- "select own" policy hides from them (they are not the requester). The
-- ownership test is inside the function body, so the widened read is available
-- for precisely these rows and no others.
--
-- Takes no arguments. The caller is auth.uid(), which is read from the request
-- JWT and is unaffected by SECURITY DEFINER — so a signed-out caller (NULL) or
-- a caller who owns no posts matches nothing and gets an empty set.

CREATE OR REPLACE FUNCTION public.inbox_requests()
RETURNS TABLE (
    request_id             UUID,
    post_id                UUID,
    post_title             TEXT,
    interest_type          TEXT,
    message                TEXT,
    contact                TEXT,
    status                 TEXT,
    created_at             TIMESTAMPTZ,
    responder_id           UUID,
    responder_name         TEXT,
    responder_affiliation  TEXT,
    responder_institution  TEXT,
    responder_profile_slug TEXT
)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT
        cr.id,
        cr.post_id,
        p.title,
        cr.interest_type,
        cr.message,
        -- The contact the RESPONDER typed. Never users.email — see the header.
        cr.contact,
        cr.status,
        cr.created_at,
        cr.user_id,
        u.name,
        u.affiliation,
        u.institution,
        -- A linkable slug only for an already-public profile; otherwise the
        -- responder is identified by name alone.
        CASE WHEN u.is_public THEN u.profile_slug ELSE NULL END
    FROM public.connection_requests cr
    JOIN public.collab_posts p ON p.id = cr.post_id
    LEFT JOIN public.users u   ON u.id = cr.user_id
    WHERE cr.post_id IS NOT NULL
      -- THE WHOLE PRIVACY GUARANTEE: only posts the caller owns.
      AND p.owner_id = auth.uid()
    ORDER BY cr.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.inbox_requests() FROM PUBLIC;
-- authenticated only — an anonymous caller has no inbox by definition.
GRANT EXECUTE ON FUNCTION public.inbox_requests() TO authenticated;


-- ── 3. inbox_unseen_count() — the nav badge ──────────────────────────────────
-- Just the number of still-'new' responses aimed at the caller's posts. Split
-- out from inbox_requests() because the badge renders on EVERY page: this way
-- the shared nav costs one aggregate, not a full inbox payload it discards.

CREATE OR REPLACE FUNCTION public.inbox_unseen_count()
RETURNS BIGINT
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT COUNT(*)
    FROM public.connection_requests cr
    JOIN public.collab_posts p ON p.id = cr.post_id
    WHERE cr.post_id IS NOT NULL
      AND p.owner_id = auth.uid()
      AND cr.status = 'new';
$$;

REVOKE ALL ON FUNCTION public.inbox_unseen_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inbox_unseen_count() TO authenticated;


-- ── 4. mark_inbox_seen() — the only permitted write ──────────────────────────
-- Flips 'new' -> 'seen' on responses aimed at the caller's posts, and returns
-- how many rows it changed.
--
-- Pass an array of request ids to mark just those, or NULL / omit to mark the
-- caller's whole inbox (what opening the page does).
--
-- Two guards worth keeping:
--   * `p.owner_id = auth.uid()` — ids are caller-supplied, so an id belonging
--     to someone else's post simply matches nothing. There is no way to flip a
--     row you don't own, and no error that would confirm such a row exists.
--   * `status = 'new'` — never overwrite 'responded' or 'closed'. Re-opening the
--     inbox must not walk a request backwards through its lifecycle.
--
-- SECURITY DEFINER for the same reason as the read: there is no UPDATE policy on
-- this table for a post owner, and adding a broad one is the thing being avoided.

CREATE OR REPLACE FUNCTION public.mark_inbox_seen(request_ids UUID[] DEFAULT NULL)
RETURNS BIGINT
    LANGUAGE plpgsql
    VOLATILE
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    updated BIGINT;
BEGIN
    -- A signed-out caller has no inbox; bail before touching anything.
    IF auth.uid() IS NULL THEN
        RETURN 0;
    END IF;

    UPDATE public.connection_requests cr
       SET status = 'seen'
     WHERE cr.status = 'new'
       AND cr.post_id IS NOT NULL
       AND (request_ids IS NULL OR cr.id = ANY (request_ids))
       AND EXISTS (
           SELECT 1
           FROM public.collab_posts p
           WHERE p.id = cr.post_id
             AND p.owner_id = auth.uid()
       );

    GET DIAGNOSTICS updated = ROW_COUNT;
    RETURN updated;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_inbox_seen(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_inbox_seen(UUID[]) TO authenticated;


-- ── 5. Indexes ───────────────────────────────────────────────────────────────
-- idx_connection_requests_post (post_id) already exists from the collab_posts
-- migration and carries the join. This partial index is for the nav badge, which
-- runs on every authenticated page load and only ever wants unseen board rows.

CREATE INDEX IF NOT EXISTS idx_connection_requests_unseen
    ON public.connection_requests (post_id)
    WHERE status = 'new' AND post_id IS NOT NULL;
