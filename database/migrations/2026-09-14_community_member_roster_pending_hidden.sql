-- =============================================================================
-- Migration: community_member_roster_pending_hidden  (2026-09-14)
-- =============================================================================
-- TWO CHANGES, same file because the second one's filter (hidden) has to
-- land in the same DROP+CREATE of community_member_roster() as the first.
--
-- ── 1. THE BUG: community_member_roster() INNER JOINs public.users ─────────
-- An admin-added-by-email row (addCommunityMemberByEmail,
-- 2026-08-30_community_admin_membership.sql) is status = 'active' from the
-- moment it's created — but user_id stays NULL until that person actually
-- signs in (handle_new_user() / claim_pending_community_memberships() link
-- it then). The roster function's `JOIN public.users u ON u.id = cm.user_id`
-- is an INNER join: a NULL user_id matches nothing, so the row vanishes
-- from the result entirely, not just its name/institution. For an imported
-- cohort where nobody has signed in yet, that's every row but the admin's
-- own — a "12 members" community renders one card.
--
-- FIX: LEFT JOIN instead of INNER JOIN, so a not-yet-signed-in row survives
-- with u.* as NULL, and the SELECT falls back to what the membership row
-- itself already has — cm.email (stored on community_members since
-- 2026-08-21_community_join.sql specifically so a not-yet-account-holder
-- can be represented at all) for a display identity, and a new `signed_up`
-- boolean (cm.user_id IS NOT NULL) so the UI can mark that row clearly
-- rather than rendering it as if it were an ordinary member. This is the
-- SAME "not yet signed up" condition MemberRoster.tsx (the admin panel)
-- already marks today with "(invited — not signed up yet)" — the
-- member-facing card should read the same way, not as a blank or an error.
--
-- `status = 'active'` stays in the WHERE clause, unchanged — this does NOT
-- start showing status = 'pending' rows (an unapproved request to join a
-- closed community). Those aren't members yet at all
-- (is_community_member() already excludes them), and showing an unapproved
-- request in "who's in this community" would be a real correctness bug,
-- not the one being fixed here. "Pending" in the product sense this
-- migration addresses means "hasn't signed in yet," not the `status` enum
-- value.
--
-- PRIVACY, SAID EXPLICITLY, NOT LET HAPPEN SILENTLY: this roster is already
-- member-gated (is_community_member() in the WHERE clause, unchanged), so
-- before this migration it exposed a signed-in member's NAME to every other
-- member. After this migration, a not-yet-signed-in member's EMAIL (the
-- only identity available for that row) is exposed the same way, to every
-- other active member of the same community. For a cohort that is meant to
-- know each other and reach each other (the whole reason a "who's in this"
-- roster exists), that's the right trade — but it is a new category of PII
-- reaching a wider audience than before, so it's written down here rather
-- than discovered later. Nothing changes about who CAN see it (still
-- member-only, still not anon/public) — only what a member sees once
-- they're already allowed to be looking.
--
-- ── 2. hidden: keep a member out of the roster without touching membership ──
-- Some members are staff running a community, not part of the cohort it's
-- for (a HEREP admin, e.g.) — they should keep their role and access but
-- not show up in a roster whose whole point is eleven scholars seeing each
-- other. `hidden` is a plain boolean on community_members, default false,
-- read nowhere except this function's WHERE clause: role, status, and
-- every access check (is_community_member, is_community_admin,
-- can_post_to_community) are completely unaware of it, on purpose — hidden
-- only ever changes whether a row is INCLUDED IN THIS ROSTER, never whether
-- it's a member.
--
-- WHO CAN SET IT: an admin, on any row in their own community — already
-- covered by "Community members: admin manages" (2026-08-30), which is
-- unrestricted by column, so no RLS change is needed for that path. A
-- member can also hide THEMSELVES — the same self-update path `focus`
-- already uses ("Community members: self update focus",
-- 2026-09-13_community_member_focus.sql, renamed below now that it covers
-- more than focus). That policy's USING/WITH CHECK only ever re-checks
-- ownership (user_id = auth.uid()), never which column changed — the
-- BEFORE UPDATE trigger from that migration is what actually restricts a
-- non-admin's update to specific columns, and it works by EXCLUSION (it
-- lists the columns that must NOT change: role, status, user_id, email,
-- community_id, approved_by, approved_at, requested_at, joined_at). `focus`
-- was never on that list, and neither is `hidden` now — so a self-update
-- touching `hidden` already passes today's trigger unmodified. It's
-- CREATE OR REPLACE'd below anyway, body identical, purely so the comment
-- says outright that `hidden` is deliberately, not accidentally, excluded
-- — the next person reading that function should not have to re-derive
-- that from silence.
--
-- Run once, top to bottom, in the Supabase SQL editor. Idempotent (ADD
-- COLUMN IF NOT EXISTS, DROP FUNCTION/POLICY IF EXISTS before CREATE,
-- REVOKE/GRANT are all safe to re-run). NOT run against any database as
-- part of writing this file.
-- =============================================================================

-- ── community_members: the new column ───────────────────────────────────────
ALTER TABLE public.community_members ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

-- =============================================================================
-- community_member_roster(): LEFT JOIN, email fallback, signed_up, hidden
-- =============================================================================
-- Return shape changes (member_id and signed_up are new columns) — DROP is
-- required first; CREATE OR REPLACE cannot change an existing function's
-- return type ("cannot change return type of existing function"), and
-- grants do not survive a DROP, so they're re-applied below. Same gotcha
-- this exact function has already hit twice
-- (2026-09-02_community_member_roster_institution.sql's own header).
--
-- `member_id` (community_members.id) is new because `user_id` can now be
-- NULL in the result (a not-yet-signed-in row) — callers need a stable,
-- always-present key for that row (a React list key, e.g.) that `user_id`
-- can no longer guarantee.
DROP FUNCTION IF EXISTS public.community_member_roster(UUID[]);

CREATE FUNCTION public.community_member_roster(community_ids UUID[])
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
        u.name,
        COALESCE(u.email, cm.email) AS email,
        u.institution,
        cm.focus,
        (cm.user_id IS NOT NULL) AS signed_up,
        cm.hidden
    FROM public.community_members cm
    LEFT JOIN public.users u ON u.id = cm.user_id
    WHERE cm.community_id = ANY(community_ids)
      AND cm.status = 'active'
      -- A hidden row is dropped for everyone EXCEPT the member it belongs
      -- to — otherwise hiding yourself removes your own way back (there's
      -- no other member-facing surface this toggle lives on; see
      -- FocusField/MembersSection). `hidden` is returned above so the UI
      -- can mark "only visible to you" rather than showing it as an
      -- ordinary card. Every OTHER caller still sees this row filtered out
      -- exactly as before — this is a self-exception, not a general
      -- loosening of the hidden filter.
      AND (NOT cm.hidden OR cm.user_id = auth.uid())
      AND public.is_community_member(cm.community_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.community_member_roster(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_member_roster(UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.community_member_roster(UUID[]) TO authenticated;

-- =============================================================================
-- The self-update trigger: same body, comment made explicit about `hidden`
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enforce_community_member_self_update_guard()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    -- An admin may change anything on any row in their own community — this
    -- guard exists only to restrict the self-update policy below; the
    -- existing "Community members: admin manages" path is untouched by it.
    IF public.is_community_admin(NEW.community_id, auth.uid()) THEN
        RETURN NEW;
    END IF;

    -- Everything a non-admin's self-update must NOT be able to change.
    -- `focus` and `hidden` are deliberately absent from this list — both
    -- are meant to be self-editable (see this migration's own header for
    -- `hidden`, 2026-09-13_community_member_focus.sql's for `focus`).
    -- Nothing else on this row is: role, status, user_id, email,
    -- community_id, and the approval/timestamp bookkeeping columns all stay
    -- exactly as they are for a non-admin's own update.
    IF NEW.role IS DISTINCT FROM OLD.role
        OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.email IS DISTINCT FROM OLD.email
        OR NEW.community_id IS DISTINCT FROM OLD.community_id
        OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
        OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
        OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
        OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
    THEN
        RAISE EXCEPTION 'You can only edit your own research focus or hide yourself from the roster.';
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger already points at this function name/signature (unchanged by the
-- CREATE OR REPLACE above) — no DROP/CREATE TRIGGER needed.

-- =============================================================================
-- Rename the self-update policy — it now covers more than `focus`
-- =============================================================================
-- Same USING/WITH CHECK as before (ownership only; the trigger above is
-- what actually restricts which columns), renamed so its name doesn't
-- undersell what it now permits (focus AND hidden, and whatever else is
-- added to the trigger's exclusion list later).
DROP POLICY IF EXISTS "Community members: self update focus" ON public.community_members;
DROP POLICY IF EXISTS "Community members: self update own row" ON public.community_members;
CREATE POLICY "Community members: self update own row"
    ON public.community_members FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
