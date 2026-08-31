-- =============================================================================
-- Migration: community_delete_admin_guard_fix  (2026-08-31, same day)
-- =============================================================================
-- Fixes deleteCommunity, which fails every time with:
--
--   P0001: A community must always keep at least one admin.
--
-- CAUSE: DELETE FROM public.communities cascades into community_members
-- (ON DELETE CASCADE, 2026-08-20_communities.sql) — and that cascade fires
-- trg_enforce_community_admin_guard on every admin row it removes, same as
-- any other DELETE would. The guard has no way to tell "this admin is
-- being removed because the whole community is going away" from "this
-- admin is being removed while the community still exists" — so it
-- rejects the very last admin row's cascade-delete exactly the way it's
-- designed to reject a plain "remove the last admin" attempt. A community
-- with exactly one admin (every community, until a second admin is
-- promoted) could never be deleted at all.
--
-- FIX: the trigger now checks, on a DELETE, whether the row's own
-- community still exists in public.communities. If it doesn't, the parent
-- row was already removed in the SAME transaction (the cascade only fires
-- after that DELETE has applied — self-visible under MVCC within one
-- transaction) — this row's removal is a consequence of the community
-- itself being deleted, not a membership change happening while the
-- community lives on, so the guard has nothing to enforce and returns OLD
-- immediately, skipping both rules.
--
-- WHAT STAYS EXACTLY AS BEFORE: removing or demoting an admin while the
-- community still exists — the ordinary path, an admin acting through
-- removeCommunityMember/changeCommunityMemberRole — is untouched. Both
-- rules (nobody but the admin themselves may remove/demote them; a
-- community always keeps at least one admin) still fire exactly as they
-- did, because the new check only short-circuits when the community row is
-- ALREADY gone.
--
-- NO DROP NEEDED: same name, same signature (no arguments), same return
-- type (TRIGGER) as the original — CREATE OR REPLACE FUNCTION is enough.
-- The trigger itself (trg_enforce_community_admin_guard) doesn't need to
-- be touched at all; it already points at this function by name.
--
-- Run once in the Supabase SQL editor, AFTER
-- 2026-08-30_community_admin_membership.sql (this is its trigger function)
-- and 2026-08-31_community_delete.sql (this is the delete path that
-- exposed the bug). Idempotent — safe to re-run. NOT run against any
-- database as part of writing this file.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_community_admin_guard()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_acting_uid    UUID := auth.uid();
    v_other_admins  INTEGER;
BEGIN
    -- NEW: a DELETE whose parent community no longer exists is a cascade
    -- from deleting the community itself (ON DELETE CASCADE,
    -- 2026-08-20_communities.sql), not a membership change on a community
    -- that's still there — nothing for this guard to enforce. Checked
    -- FIRST, before either rule, and only for DELETE (an UPDATE can never
    -- fire mid-cascade — cascading a delete only ever deletes rows).
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (SELECT 1 FROM public.communities c WHERE c.id = OLD.community_id)
    THEN
        RETURN OLD;
    END IF;

    -- Only a row that WAS an active admin is restricted by this guard — a
    -- pending row, a lead, or a plain member can be updated/deleted freely
    -- (subject to the RLS policies that gate who may attempt it at all).
    IF OLD.role = 'admin' AND OLD.status = 'active'
       AND (TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NEW.status <> 'active')
    THEN
        -- Rule 1: nobody may remove or demote a DIFFERENT admin — only
        -- that admin may step themselves down. Independent of how many
        -- admins the community currently has.
        IF v_acting_uid IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION 'An admin cannot remove or demote another admin.';
        END IF;

        -- Rule 2: a community always keeps at least one admin — even the
        -- last admin stepping down themselves is blocked.
        SELECT COUNT(*) INTO v_other_admins
        FROM public.community_members
        WHERE community_id = OLD.community_id
          AND status = 'active'
          AND role = 'admin'
          AND id <> OLD.id;

        IF v_other_admins = 0 THEN
            RAISE EXCEPTION 'A community must always keep at least one admin.';
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;
