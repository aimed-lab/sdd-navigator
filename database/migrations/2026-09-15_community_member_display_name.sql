-- =============================================================================
-- Migration: community_member_display_name  (2026-09-15)
-- =============================================================================
-- THE BUG: a not-yet-signed-in member has no public.users row, so
-- community_member_roster() has never had a real name to show for them —
-- listMemberRoster()'s own fallback is `r.name || r.email || "Unnamed
-- member"`, and for a pending row `r.name` is always null. A HEREP scholar
-- sees "anne5573@uabmc.edu" on a card instead of "Anne Kane".
--
-- FIX: a plain nullable TEXT column on the MEMBERSHIP, `display_name` — same
-- placement reasoning as `focus` (2026-09-13_community_member_focus.sql):
-- it's what to call this person IN THIS COMMUNITY before they have an
-- account, not a property of an account, since there may never be a linked
-- account for that community_members row to begin with by the time it's
-- read (a viewer, or the admin filling in a roster before a live session).
-- Settable by an admin only, from the Manage panel alongside `focus` — NOT
-- self-service; unlike `focus`/`hidden`, a not-yet-signed-in member cannot
-- self-update anything (there's no session to do it from), and once they
-- HAVE signed in, their real account name already wins over this column
-- (see the COALESCE below), so there is no case where a member would ever
-- need to set their own display_name. No RLS or trigger change follows
-- from that: "Community members: admin manages" (2026-08-30) already
-- covers any column on any row in an admin's own community, unrestricted,
-- so it already covers this one. And because `display_name` is
-- deliberately NOT added to enforce_community_member_self_update_guard's
-- allow-list (2026-09-14, which currently allows only `focus` and
-- `hidden`), a self-update touching this column is already rejected by
-- that trigger exactly as every other non-admin-only column is — this
-- migration adds no new code to make that true, it falls out of the
-- existing exclusion-list design.
--
-- community_member_roster() changes what `name` resolves to:
-- COALESCE(u.name, cm.display_name) instead of bare u.name. Priority is
-- linked account name, then admin-set display_name, then (unchanged,
-- downstream in listMemberRoster()'s own fallback) email, then "Unnamed
-- member". Once someone signs in, their real name wins automatically — no
-- migration/cleanup step needed, the COALESCE just stops reaching
-- display_name for that row from then on.
--
-- Return shape is UNCHANGED (still `name TEXT`, same column) — CREATE OR
-- REPLACE FUNCTION is sufficient here, no DROP needed. (Contrast with
-- 2026-09-14_community_member_roster_pending_hidden.sql, which added
-- columns and did need one — same function, different situation.)
--
-- ORDERING, deliberately checked because the last migration to this exact
-- function got this wrong (2026-09-14's ALTER TABLE was correctly ahead of
-- its CREATE FUNCTION in the file, but only part of that paste appears to
-- have been executed, per that migration's own follow-up conversation):
-- the ADD COLUMN below is the ONLY thing this file adds that
-- community_member_roster() reads, and it is the very first statement in
-- this file, before the function is touched at all. Nothing else in this
-- file depends on anything created later in the file.
--
-- Run once, top to bottom, IN ONE PASTE (not a partial selection — see
-- this migration's own ordering note above and 2026-09-14's follow-up), in
-- the Supabase SQL editor. Idempotent (ADD COLUMN IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, REVOKE/GRANT are all safe to re-run). NOT
-- run against any database as part of writing this file.
-- =============================================================================

-- ── community_members: the new column ───────────────────────────────────────
ALTER TABLE public.community_members ADD COLUMN IF NOT EXISTS display_name TEXT;

-- =============================================================================
-- community_member_roster(): name falls back to display_name before email
-- =============================================================================
-- Same signature, same return shape as 2026-09-14 left it — CREATE OR
-- REPLACE is enough, no DROP/re-grant needed.
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
      AND public.is_community_member(cm.community_id, auth.uid());
$$;

-- CREATE OR REPLACE keeps existing grants — no REVOKE/GRANT needed this
-- time (only true because the signature and return type are both
-- unchanged; see 2026-09-14's own header for when that stops being true).
