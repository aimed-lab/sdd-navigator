-- =============================================================================
-- Migration: community_public_preview  (2026-09-18)
-- =============================================================================
-- WHAT A SIGNED-OUT VISITOR SEES ON A COMMUNITY PAGE — this is the page
-- people actually arrive at from a shared link or a talk, and today it
-- persuades nobody: name, purpose, member count, join button, and nothing
-- that shows the community is real and active.
--
-- `public_preview` is a NEW per-community setting, the same kind of choice
-- `sections` already is — sections decides what a MEMBER sees and in what
-- order; this decides what a NON-member sees before joining. Two values:
--   'standard' (DEFAULT) — name, purpose, member count, the number of
--       items in the stored feed, a preview of 3-4 feed items (title and
--       source only), and the join/request action.
--   'minimal' — name, purpose, and the join/request action only. For a
--       private working group that doesn't want its size or activity
--       visible to a stranger with the link.
-- Deliberately NOT a third "more" tier — every non-member sees the SAME
-- stored feed a member does, through the SAME RLS, just capped to 3-4
-- items at read time (getCommunityFeedPreview,
-- lib/server/communities.ts) rather than a separate, wider public feed;
-- "an open community may want more" is satisfied by 'standard' already
-- showing real, verifiable content, not by a bigger number.
--
-- WHAT THIS DOES NOT TOUCH: the roster (names, what members work on),
-- announcements, and hand-curated resources stay exactly as gated as they
-- already are — member-only, via is_community_member() in their own RLS
-- policies (2026-08-30 / 2026-09-02 / 2026-09-03). This migration adds
-- exactly one new SELECT policy, on community_feed_items, and nowhere
-- else — the "do not show" list in the spec this migration implements was
-- already enforced by existing policies before this file existed.
--
-- RLS, NOT A SERVICE ROLE. The preview read goes through the SAME
-- anon-server client every other public community read already uses
-- (getCommunityBySlug, community_member_stats) — this migration's whole
-- job is to give that anon/non-member read something to actually select
-- when public_preview = 'standard', not to open a side door around RLS
-- for it. A 'minimal' community's feed items stay invisible to anon
-- exactly as they are today, with no code path (service-role or
-- otherwise) that would see them without membership.
--
-- Run once, top to bottom, in the Supabase SQL editor. Idempotent (ADD
-- COLUMN IF NOT EXISTS, DROP CONSTRAINT/POLICY IF EXISTS before CREATE) —
-- safe to re-run. NOT run against any database as part of writing this
-- file.
-- =============================================================================

-- ── communities: the new setting ────────────────────────────────────────────
ALTER TABLE public.communities
    ADD COLUMN IF NOT EXISTS public_preview TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE public.communities DROP CONSTRAINT IF EXISTS communities_public_preview_check;
ALTER TABLE public.communities
    ADD CONSTRAINT communities_public_preview_check
        CHECK (public_preview IN ('standard', 'minimal'));

-- ── community_feed_items: the new read path ─────────────────────────────────
-- Additive — RLS SELECT policies on one table are OR'd together, so this
-- only ever WIDENS who can read a row, never narrows what
-- "Community feed items: member select" (2026-09-06) already grants a
-- member. A non-member (anon included) can now also read a community's
-- feed rows, but ONLY while that community's own public_preview is
-- 'standard' — the app caps what it actually SELECTs to 3-4 rows
-- (getCommunityFeedPreview), but the boundary that actually matters
-- (private stays private) is enforced here, in the database, not by the
-- app choosing not to ask for more.
DROP POLICY IF EXISTS "Community feed items: public preview select" ON public.community_feed_items;
CREATE POLICY "Community feed items: public preview select"
    ON public.community_feed_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.communities c
            WHERE c.id = community_id AND c.public_preview = 'standard'
        )
    );
