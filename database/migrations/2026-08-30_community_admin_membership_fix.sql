-- =============================================================================
-- Migration: community_admin_membership_fix  (2026-08-30, same day)
-- =============================================================================
-- Fixes a bug in create_community_with_admin
-- (2026-08-30_community_admin_membership.sql), caught the first time it was
-- actually run:
--
--   42702: column reference "id" is ambiguous
--
-- CAUSE: that function declares RETURNS TABLE (id UUID, slug TEXT), which
-- makes `id` an OUT-parameter variable in scope for the WHOLE function
-- body — not just the final RETURN QUERY. Its lookup
-- `SELECT email INTO v_email FROM public.users WHERE id = v_uid;` left `id`
-- unqualified, so Postgres couldn't tell that from public.users.id. Fixed
-- by aliasing the table (`u`) and qualifying the column, not by renaming
-- the OUT parameters — the RETURNS TABLE (id, slug) shape is the actual
-- result-set contract the frontend reads (data.id / data.slug in
-- lib/server/communities.ts's createCommunity()), and stays exactly as it
-- was.
--
-- CHECKED THE OTHER TWO NEW FUNCTIONS FOR THE SAME CLASS OF BUG — neither
-- has it: find_account_id_by_email_for_community RETURNS a bare UUID (no
-- named output columns to collide with), and enforce_community_admin_guard
-- RETURNS TRIGGER and declares no `id` variable at all — its own
-- `AND id <> OLD.id` resolves unambiguously to community_members.id.
--
-- NO DROP FUNCTION NEEDED: name, parameter list, and return type are all
-- unchanged from the original migration — only the body. CREATE OR REPLACE
-- is sufficient (a DROP is only required when the signature itself
-- changes, as it did for create_project_with_lead in the same migration
-- this one follows).
--
-- Safe to run even if 2026-08-30_community_admin_membership.sql's version
-- of this function never successfully created a community yet — nothing
-- here depends on prior data. Idempotent — safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_community_with_admin(
    p_name        TEXT,
    p_description TEXT DEFAULT NULL
)
    RETURNS TABLE (id UUID, slug TEXT)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    v_uid          UUID := auth.uid();
    v_email        TEXT;
    v_base_slug    TEXT;
    v_slug         TEXT;
    v_community_id UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'create_community_with_admin: no authenticated user';
    END IF;

    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'create_community_with_admin: name is required';
    END IF;

    -- FIXED: was `FROM public.users WHERE id = v_uid` — `id` alone collided
    -- with the `id` OUT parameter from RETURNS TABLE above. Aliased and
    -- qualified now.
    SELECT u.email INTO v_email FROM public.users u WHERE u.id = v_uid;

    v_base_slug := trim(both '-' from lower(regexp_replace(btrim(p_name), '[^a-zA-Z0-9]+', '-', 'g')));
    IF v_base_slug = '' THEN
        v_base_slug := 'community';
    END IF;

    v_slug := v_base_slug;
    WHILE EXISTS (SELECT 1 FROM public.communities c WHERE c.slug = v_slug) LOOP
        v_slug := v_base_slug || '-' || substr(md5(random()::text), 1, 5);
    END LOOP;

    INSERT INTO public.communities (slug, name, description, is_open)
    VALUES (v_slug, btrim(p_name), NULLIF(btrim(COALESCE(p_description, '')), ''), false)
    RETURNING communities.id INTO v_community_id;

    INSERT INTO public.community_members (
        community_id, user_id, email, role, status, approved_at, approved_by
    )
    VALUES (v_community_id, v_uid, COALESCE(v_email, ''), 'admin', 'active', now(), v_uid);

    RETURN QUERY SELECT v_community_id, v_slug;
END;
$$;

-- Grants are unaffected (same signature, same function) but repeated here
-- so this file is a complete, standalone unit — running it alone, without
-- the original migration already applied, still leaves the function
-- correctly grant-locked-down rather than relying on the grants from a
-- prior run.
REVOKE ALL ON FUNCTION public.create_community_with_admin(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_community_with_admin(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_community_with_admin(TEXT, TEXT) TO authenticated;
