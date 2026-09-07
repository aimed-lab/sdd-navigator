-- Community-scoped Explore feed: three admin-set controls (which of the ten
-- Explore sources a community uses, the topics that drive the search, and a
-- Refresh action that stores results against the community) plus the table
-- those stored results live in.
--
-- STORED, NOT LIVE, BY DESIGN: a member sees whatever the last Refresh
-- produced, not a live search on every page load — see community_feed_items
-- below. Idempotent, same as every other file in this directory
-- (CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS before CREATE POLICY,
-- ADD CONSTRAINT after a matching DROP CONSTRAINT IF EXISTS) so it's safe to
-- re-run.
--
-- Not mirrored in database/schema.sql — communities/community_* have never
-- been mirrored there (see 2026-08-20_communities.sql onward); this file
-- keeps that same posture rather than fixing it unprompted.

-- ── communities: explore config ─────────────────────────────────────────────
--
-- explore_sources: which of the ten Explore kinds this community searches.
-- Empty array (the default) means NO feed, not "all ten" — a community that
-- has never configured this shows nothing in the generated part of
-- Resources, same "opt in, not opt out" posture as `sections` defaulting to
-- "show everything" would have been wrong here (a brand-new community with
-- no topics set yet has nothing sensible to search on).
--
-- explore_topics: free-text keywords/phrases that actually drive the
-- search — deliberately separate from `description`, which is prose for a
-- human reader and, per spec, "not specific enough to drive a search".
--
-- explore_refreshed_at: NULL until the first Refresh; stamped by
-- refreshCommunityFeed() (lib/server/communities.ts), not by a trigger —
-- same "app sets it, not the database" posture as every other timestamp in
-- this schema outside created_at/updated_at.
ALTER TABLE public.communities
    ADD COLUMN IF NOT EXISTS explore_sources TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.communities
    ADD COLUMN IF NOT EXISTS explore_topics TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.communities
    ADD COLUMN IF NOT EXISTS explore_refreshed_at TIMESTAMPTZ;

-- ── community_feed_items ─────────────────────────────────────────────────
--
-- Machine-generated resources, kept in their own table rather than folded
-- into community_resources: these are re-fetched wholesale on every
-- Refresh (community_resources' rows are one-off, hand-entered, and never
-- bulk-replaced), and need a dedup key against the SAME external item
-- reappearing on the next Refresh, which community_resources has no column
-- for.
--
-- kind is TEXT + CHECK, not a Postgres ENUM, matching the standing
-- preference already applied to community_resources.resource_type — adding
-- an eleventh source later (or renaming one) is an ADD/DROP CONSTRAINT, not
-- an ALTER TYPE. Values match ExploreItem.kind (frontend/types/explore.ts)
-- exactly, "episode" (the podcast) included, so results from
-- /api/explore-source need no translation on the way in.
--
-- external_id is the ExploreItem's own `id` (falls back to `dedupe_key` when
-- an item has no stable id) — combined with community_id + kind into one
-- UNIQUE constraint so a refresh can upsert instead of accumulating
-- duplicates every time the same paper/trial/etc. reappears.
--
-- published_at is the ExploreItem's own `date_iso` — ALREADY fetched by
-- every Explore source (it's what the rest of Explore sorts by; see
-- search_papers.py's _order_and_cap), just never previously carried through
-- refreshCommunityFeed()'s insert. NULL when the source item's date_iso was
-- unparseable (to_iso()'s epoch fallback, 1970-01-01 — refreshCommunityFeed
-- maps that sentinel to NULL rather than storing a bogus 1970 date). This is
-- what the Resources feed now sorts and displays by, since "the publication
-- date matters most" — fetched_at (when Refresh happened to run) is not a
-- proxy for how NEW the item itself is.
--
-- raw and signal are ExploreItem's own `raw`/`signal` fields, stored
-- VERBATIM as JSONB — this is what lets a community's feed render through
-- the SAME components/ItemCard.tsx Explore uses (dataset/geneset/trial/
-- compound/target cards all read their type-specific metadata — organism,
-- trial status, ChEMBL phase, Open Targets evidence, etc. — out of `raw`;
-- `signal` drives the citation/star badge). Both are ALREADY present in
-- what /api/explore-source returns (response.py's trim_items already
-- reduces `raw` to just {prior_signal, sources} for external sources —
-- pubmed/openalex/crossref — and leaves it untouched for the
-- internal-grouped ones — geo/pager/clinicaltrials/chembl/opentargets —
-- see that module's docstring), just never previously carried through
-- refreshCommunityFeed()'s insert, same story as published_at above. NULL
-- for a kind with no such data (e.g. paper items where WINNER never ran, so
-- signal is whatever OpenAlex reported directly, or nothing).
CREATE TABLE IF NOT EXISTS public.community_feed_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    summary TEXT,
    source TEXT,
    published_at TIMESTAMPTZ,
    raw JSONB,
    signal JSONB,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Belt-and-suspenders for a re-run against a table this migration already
-- created before these columns existed — CREATE TABLE IF NOT EXISTS above
-- wouldn't add them to an already-existing table.
ALTER TABLE public.community_feed_items
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

ALTER TABLE public.community_feed_items
    ADD COLUMN IF NOT EXISTS raw JSONB;

ALTER TABLE public.community_feed_items
    ADD COLUMN IF NOT EXISTS signal JSONB;

ALTER TABLE public.community_feed_items
    DROP CONSTRAINT IF EXISTS community_feed_items_kind_check;

ALTER TABLE public.community_feed_items
    ADD CONSTRAINT community_feed_items_kind_check
        CHECK (kind IN (
            'paper', 'news', 'trial', 'grant', 'tool',
            'dataset', 'geneset', 'compound', 'target', 'episode'
        ));

ALTER TABLE public.community_feed_items
    DROP CONSTRAINT IF EXISTS community_feed_items_dedupe_key;

ALTER TABLE public.community_feed_items
    ADD CONSTRAINT community_feed_items_dedupe_key
        UNIQUE (community_id, kind, external_id);

CREATE INDEX IF NOT EXISTS community_feed_items_community_kind_idx
    ON public.community_feed_items (community_id, kind);

-- Supports listCommunityFeedItems' newest-first ORDER BY within each kind
-- group — see ResourcesSection.tsx's own comment on why publication date,
-- not fetch time, is what the feed sorts by.
CREATE INDEX IF NOT EXISTS community_feed_items_community_published_idx
    ON public.community_feed_items (community_id, published_at DESC);

ALTER TABLE public.community_feed_items ENABLE ROW LEVEL SECURITY;

-- Same admin-write/member-read tier as community_resources
-- (2026-09-03_community_resources.sql) — is_community_admin/
-- is_community_member already exist from that migration, reused verbatim.

DROP POLICY IF EXISTS "Community feed items: member select" ON public.community_feed_items;
CREATE POLICY "Community feed items: member select"
    ON public.community_feed_items FOR SELECT
    USING (public.is_community_member(community_id, auth.uid()));

-- INSERT/UPDATE/DELETE are all admin-only, and all three exist because
-- refreshCommunityFeed() deletes the community's existing rows and inserts
-- the fresh set every time (see that function's own comment for why
-- delete-then-insert rather than a merge-forever upsert) — UPDATE itself
-- isn't currently used by app code, but is included for the same
-- completeness reason community_resources' admin tier has all three.
DROP POLICY IF EXISTS "Community feed items: admin insert" ON public.community_feed_items;
CREATE POLICY "Community feed items: admin insert"
    ON public.community_feed_items FOR INSERT
    WITH CHECK (public.is_community_admin(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community feed items: admin update" ON public.community_feed_items;
CREATE POLICY "Community feed items: admin update"
    ON public.community_feed_items FOR UPDATE
    USING (public.is_community_admin(community_id, auth.uid()))
    WITH CHECK (public.is_community_admin(community_id, auth.uid()));

DROP POLICY IF EXISTS "Community feed items: admin delete" ON public.community_feed_items;
CREATE POLICY "Community feed items: admin delete"
    ON public.community_feed_items FOR DELETE
    USING (public.is_community_admin(community_id, auth.uid()));
