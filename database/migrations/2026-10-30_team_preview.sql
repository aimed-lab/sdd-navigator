-- 2026-10-30: team page preview for people who are not on the team.
--
-- A team's documents and wiki-page list are members-only (RLS). The team page
-- now shows non-members the same layout with titles only, so they can see what
-- is inside before they sign in or join. They get it through ONE function,
-- get_team_preview(slug), SECURITY DEFINER, granted to anon and authenticated.
--
-- It returns ONLY:
--   id, name, description, member_count,
--   documents: [{ id, title, kind }]   kind = pdf | slides | image | link
--   pages:     [{ id, title, kind }]   kind = page
-- Only wiki pages whose visibility is NOT 'private' are listed ('team' and
-- 'public' pages), the same line can_read_page draws for team access. A member's
-- own private page that was curated into the team is not shown to non-members.
--
-- It never returns file URLs or storage paths, link URLs, page slugs or page
-- content, document descriptions, who added what, or any member name or email.
-- It returns NULL for an unknown slug and for a community (only kind = 'team').
--
-- The document kind is worked out here from the first file's name (else the
-- link's address) with the same rules as the app's fileKind(), so the address
-- itself never leaves the database.
--
-- A page's id is returned so the page can remember what a visitor clicked
-- (?open=page:<id>); the app only acts on it after they have joined, and only
-- when the id belongs to that team.
--
-- Idempotent: CREATE OR REPLACE and repeated grants. Run in the Supabase SQL
-- editor after 2026-10-28_teams.sql. No tables or policies change.

CREATE OR REPLACE FUNCTION public.get_team_preview(p_slug TEXT)
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
DECLARE
    v_team public.communities%ROWTYPE;
BEGIN
    SELECT c.* INTO v_team
    FROM public.communities c
    WHERE c.slug = p_slug AND c.kind = 'team';

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'id', v_team.id,
        'name', v_team.name,
        'description', v_team.description,
        'member_count', (
            SELECT COUNT(*) FROM public.community_members m
            WHERE m.community_id = v_team.id AND m.status = 'active'
        ),
        'documents', COALESCE((
            SELECT jsonb_agg(
                       jsonb_build_object('id', d.id, 'title', d.title, 'kind', d.kind)
                       ORDER BY d.title
                   )
            FROM (
                SELECT r.id,
                       r.title,
                       CASE
                           WHEN f.filename ~* '\.pdf$'                                THEN 'pdf'
                           WHEN f.filename ~* '\.(pptx?|key|odp)$'                    THEN 'slides'
                           WHEN f.filename ~* '\.(png|jpe?g|gif|webp|svg|heic|bmp|tiff?)$' THEN 'image'
                           WHEN f.filename IS NOT NULL                                THEN 'link'
                           WHEN split_part(split_part(COALESCE(r.url, ''), '#', 1), '?', 1) ~* '\.pdf$' THEN 'pdf'
                           WHEN split_part(split_part(COALESCE(r.url, ''), '#', 1), '?', 1) ~* '\.(pptx?|key|odp)$' THEN 'slides'
                           WHEN split_part(split_part(COALESCE(r.url, ''), '#', 1), '?', 1) ~* '\.(png|jpe?g|gif|webp|svg|heic|bmp|tiff?)$' THEN 'image'
                           ELSE 'link'
                       END AS kind
                FROM public.community_resources r
                LEFT JOIN LATERAL (
                    SELECT cf.filename
                    FROM public.community_resource_files cf
                    WHERE cf.resource_id = r.id
                    ORDER BY cf.created_at, cf.id
                    LIMIT 1
                ) f ON TRUE
                WHERE r.community_id = v_team.id
            ) d
        ), '[]'::jsonb),
        'pages', COALESCE((
            SELECT jsonb_agg(
                       jsonb_build_object('id', p.id, 'title', p.title, 'kind', 'page')
                       ORDER BY tp.created_at DESC
                   )
            FROM public.team_pages tp
            JOIN public.pages p ON p.id = tp.page_id
            WHERE tp.team_id = v_team.id
              AND p.visibility <> 'private'
        ), '[]'::jsonb)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_preview(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_preview(TEXT) TO anon, authenticated;
