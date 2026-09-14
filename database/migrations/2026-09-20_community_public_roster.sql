-- =============================================================================
-- Migration: community_public_roster  (2026-09-20)
-- =============================================================================
-- Extends public_preview (2026-09-18_community_public_preview.sql) with a
-- third value, 'open': the SAME roster and Explore feed a member sees,
-- visible to any non-member — signed out OR signed in — with two
-- differences from the member view, both enforced in application code
-- (components/communities/MembersSection.tsx, ExploreSection.tsx,
-- ItemCard.tsx), not here: no Connect button (an email should require
-- membership, not just roster visibility), and the feed is look-only (no
-- click-through, no bookmark, no "Show all" expander — everything is
-- already shown).
--
-- APPLIES TO ANY NON-MEMBER, NOT JUST SIGNED-OUT. 'standard'/'minimal'
-- already applied to anonymous AND signed-in-non-member alike (RLS doesn't
-- distinguish "no session" from "a session with no membership row" — both
-- are just "not covered by the member-only policy") — 'open' is no
-- different, and needed no extra code to make that true. What DID need
-- code: lib/server/communities.ts's listMemberRoster/listCommunityFeedItems
-- used to bail out to [] the instant there was no SESSION at all
-- (`if (!session) return [];`), which accidentally worked for the
-- signed-out case (empty is correct there today) but would have kept
-- returning [] for a signed-in non-member too, once this migration's RLS
-- says they're allowed to see something. Both functions now fall back to
-- the anon server client when there's no session, exactly like
-- getCommunityBySlug already does for every other public community read —
-- the RPC/RLS is what decides what comes back, not a session check in
-- application code.
--
-- THE FAILURE FROM 2026-09-18, WATCHED FOR HERE: that migration's new
-- anon-facing SELECT policy on community_feed_items was blocked outright
-- because a SIBLING policy on the same table (the pre-existing member-only
-- one) calls is_community_member(), and Postgres has to evaluate EVERY
-- applicable policy's USING expression to compute their OR — it doesn't
-- skip a sibling policy's expression just because a different one might
-- independently grant access. Confirmed live: an anon call hit
-- "permission denied for function is_community_member" before the new
-- policy's own logic ever ran. 2026-09-19 fixed it for community_feed_items
-- by granting anon EXECUTE on that function. THIS migration introduces the
-- exact same shape of risk one level over: community_member_roster() is a
-- single SECURITY DEFINER function (not two RLS policies), so there's no
-- sibling-policy problem there, but the function itself has never been
-- callable by anon at all — only `authenticated` (2026-09-02_community_
-- member_roster.sql's grant, never revisited since). Extending its WHERE
-- clause to also match a non-member on an 'open' community accomplishes
-- nothing if anon can't invoke the function in the first place — so this
-- migration grants EXECUTE to anon explicitly, not left to be discovered
-- live the way 2026-09-18's version of this mistake was.
--
-- Run once, top to bottom, in the Supabase SQL editor. Idempotent (DROP
-- CONSTRAINT/FUNCTION/POLICY IF EXISTS before CREATE, REVOKE/GRANT are
-- safe to re-run) — safe to re-run. NOT run against any database as part
-- of writing this file.
-- =============================================================================

-- ── communities: 'open' joins the allowed values ────────────────────────────
ALTER TABLE public.communities DROP CONSTRAINT IF EXISTS communities_public_preview_check;
ALTER TABLE public.communities
    ADD CONSTRAINT communities_public_preview_check
        CHECK (public_preview IN ('standard', 'minimal', 'open'));

-- ── community_feed_items: 'open' also gets the (already-existing) full-
-- table anon/non-member visibility 'standard' has ────────────────────────
-- Same policy, widened condition — 'standard' and 'open' both allow a
-- non-member to read every row via RLS; the DIFFERENCE between them is
-- entirely at the app layer (getCommunityFeedPreview caps 'standard' to
-- 3-4 items server-side; listCommunityFeedItems, generalized in this
-- migration's frontend half to also work signed-out, is what 'open' calls
-- instead — same table, same policy, different app-level read). No new
-- policy needed, no re-grant needed (this table's grants were already
-- fixed in 2026-09-19).
DROP POLICY IF EXISTS "Community feed items: public preview select" ON public.community_feed_items;
CREATE POLICY "Community feed items: public preview select"
    ON public.community_feed_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.communities c
            WHERE c.id = community_id AND c.public_preview IN ('standard', 'open')
        )
    );

-- ── community_member_roster(): return rows for a non-member too, on an
-- 'open' community ──────────────────────────────────────────────────────
-- Return shape is UNCHANGED from 2026-09-15's version — CREATE OR REPLACE
-- is sufficient, no DROP needed (only true because neither the signature
-- nor the return type changed here; see 2026-09-14's own header for when
-- that stops being true).
CREATE OR REPLACE FUNCTION public.community_member_roster(community_ids UUID[])
RETURNS TABLE (
    member_id   UUID,
    user_id     UUID,
    role        TEXT,
    name        TEXT,
    email       TEXT,
    institution TEXT,
    focus       TEXT,
    signed_up   BOOLEAN,
    hidden      BOOLEAN
)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
AS $$
    SELECT
        cm.id AS member_id,
        cm.user_id,
        cm.role,
        COALESCE(u.name, cm.display_name) AS name,
        COALESCE(u.email, cm.email) AS email,
        u.institution,
        cm.focus,
        (cm.user_id IS NOT NULL) AS signed_up,
        cm.hidden
    FROM public.community_members cm
    LEFT JOIN public.users u ON u.id = cm.user_id
    WHERE cm.community_id = ANY(community_ids)
      AND cm.status = 'active'
      AND (NOT cm.hidden OR cm.user_id = auth.uid())
      AND (
          -- Unchanged path: an active member (or a ColaboFest-derived one)
          -- always sees the roster of a community they're actually in.
          public.is_community_member(cm.community_id, auth.uid())
          -- NEW: a non-member also sees it, but ONLY for a community whose
          -- admin has explicitly opted into 'open' — the whole point of
          -- this migration. A 'standard' or 'minimal' community's roster
          -- stays exactly as member-only as it's always been; this OR
          -- branch is never reached for either.
          OR EXISTS (
              SELECT 1 FROM public.communities c
              WHERE c.id = cm.community_id AND c.public_preview = 'open'
          )
      );
$$;

-- GRANT ANON — the actual bug this migration's header warns about
-- reproducing. community_member_roster has only ever been callable by
-- `authenticated` (2026-09-02); a non-member's roster read is worthless if
-- the caller can't invoke the function at all. REVOKE-then-GRANT, same
-- idiom the rest of this file already uses, so this file is a complete,
-- standalone unit regardless of what a prior run of it already applied.
REVOKE ALL ON FUNCTION public.community_member_roster(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_member_roster(UUID[]) TO anon, authenticated;
