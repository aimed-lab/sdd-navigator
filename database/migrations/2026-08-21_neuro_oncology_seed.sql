-- =============================================================================
-- Migration: neuro_oncology_seed  (2026-08-21)
-- =============================================================================
-- Seeds the UAB Neuro-oncology group's real roster (~133 people, per the
-- Box spreadsheet this feature replaces) as ALREADY-APPROVED community
-- members, keyed by email, before any of them have signed in.
--
-- "PENDING" HERE MEANS ACCOUNT-LINKAGE, NOT APPROVAL. These rows are written
-- with status = 'active' — they are the real, already-vetted group roster,
-- not strangers asking to join, so there is nothing for a lead to approve.
-- What IS pending is the user_id column: NULL until that person signs in
-- with a matching email, exactly like project_members' by-email invite rows.
-- This is the SAME reconciliation this codebase already ships for project
-- members (2026-08-04_projects.sql's handle_new_user, extended again for
-- this table in 2026-08-21_community_join.sql) — reused, not reinvented:
--   * community_members.user_id is nullable; email is the join key until
--     it's claimed.
--   * A partial unique index on (community_id, lower(email)) stops the same
--     address being seeded twice (community_members_email_key,
--     2026-08-21_community_join.sql).
--   * handle_new_user() claims a matching row (sets user_id) the moment
--     that email signs up — no separate cron/backfill needed for anyone who
--     signs up AFTER this migration runs.
--   * This migration ALSO runs the one-time backfill UPDATE for anyone who
--     already had an account BEFORE this seed landed (same move as
--     2026-08-13_colabofest_checklist_backfill.sql) — a straight
--     lower(email) match against public.users, no trigger needed for that
--     case since the trigger only fires on NEW signups.
--
-- ONE email in the list is marked the group's lead (role = 'lead') so
-- is_community_lead() has someone who can approve outside requests — see
-- 2026-08-21_community_join.sql. Change LEAD_EMAIL_PLACEHOLDER below to
-- whichever address is the group's actual lead before running this.
--
-- ⚠ PLACEHOLDER EMAILS ONLY — replace the entire VALUES list below with the
-- real 133 addresses before running this in the Supabase SQL editor. Nothing
-- in this file is a real person. Idempotent: ON CONFLICT DO NOTHING on the
-- email unique index means re-running after editing the list only adds
-- addresses not already present.
-- =============================================================================

DO $$
DECLARE
    v_community_id UUID;
    v_lead_email   TEXT := 'lead@example.edu';   -- ← set to the real lead's email
BEGIN
    SELECT id INTO v_community_id FROM public.communities WHERE slug = 'neuro-oncology';

    IF v_community_id IS NULL THEN
        RAISE EXCEPTION 'neuro-oncology community not found — run 2026-08-20_communities.sql first';
    END IF;

    INSERT INTO public.community_members (community_id, email, status, role, requested_at, approved_at)
    SELECT
        v_community_id,
        addr.email,
        'active',
        CASE WHEN lower(addr.email) = lower(v_lead_email) THEN 'lead' ELSE 'member' END,
        now(),
        now()
    FROM unnest(ARRAY[
        -- ── PLACEHOLDER LIST — replace every line below with a real address.
        -- One row per group member. Keep 'lead@example.edu' (or update
        -- v_lead_email above to match whichever line is the real lead).
        'lead@example.edu',
        'member001@example.edu',
        'member002@example.edu',
        'member003@example.edu'
        -- … paste the remaining ~130 addresses here, one per line, quoted,
        -- comma-separated, no trailing comma on the last line.
    ]) AS addr(email)
    ON CONFLICT (community_id, lower(email)) WHERE email IS NOT NULL DO NOTHING;

    -- Backfill: link any of the above who already had an account before
    -- this seed ran (mirrors 2026-08-13_colabofest_checklist_backfill.sql).
    -- Anyone who signs up AFTER this point is linked by handle_new_user()
    -- instead — this UPDATE only covers the "already existed" case.
    UPDATE public.community_members cm
    SET user_id = u.id
    FROM public.users u
    WHERE cm.community_id = v_community_id
      AND cm.user_id IS NULL
      AND lower(cm.email) = lower(u.email);
END $$;
