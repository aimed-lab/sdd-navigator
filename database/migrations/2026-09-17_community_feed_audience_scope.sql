-- =============================================================================
-- Migration: community_feed_audience_scope  (2026-09-17)
-- =============================================================================
-- Two new nullable-with-default columns on `communities`, wiring the
-- backend fixes in backend/explore-mcp (sources/pubmed.py's clinical_scope,
-- sources/grants_gov.py's activity_codes — see those files' own comments
-- for what each actually does and why) into the per-community Explore feed
-- config an admin already sets via ExploreFeedEditor.tsx.
--
-- WHY THIS EXISTS: a community's feed audience isn't inferrable from its
-- topic strings — "COPD HIV comorbidity" reads identically whether the
-- community wants molecular mechanism papers or health-services research,
-- and whether its members are R01-eligible faculty or K99/K23-track early-
-- career researchers. That's a property of the COMMUNITY (who it's for),
-- not of any one topic string, so it belongs here rather than being
-- guessed at query time.
--
-- explore_paper_scope: 'all' (default, today's behavior, unchanged) or
-- 'clinical' (narrows PubMed to health-services/clinical literature —
-- MeSH Major Topic + publication-type qualifiers, see pubmed.py).
--
-- explore_grant_activity_codes: empty array (default, today's behavior,
-- unchanged) or a list of NIH activity codes (e.g. '{K99,R00,K23,K01,R03}')
-- — drops any Grants.gov opportunity whose title names an activity code
-- NONE of which are in this list (see grants_gov.py's own comment on why
-- this can only ever be a positive-signal filter, not a request parameter
-- — grants.gov's own schema has no field for this).
--
-- Run once, top to bottom, in the Supabase SQL editor. Idempotent (ADD
-- COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS before ADD CONSTRAINT) —
-- safe to re-run. NOT run against any database as part of writing this
-- file.
-- =============================================================================

ALTER TABLE public.communities
    ADD COLUMN IF NOT EXISTS explore_paper_scope TEXT NOT NULL DEFAULT 'all';

ALTER TABLE public.communities DROP CONSTRAINT IF EXISTS communities_explore_paper_scope_check;
ALTER TABLE public.communities
    ADD CONSTRAINT communities_explore_paper_scope_check
        CHECK (explore_paper_scope IN ('all', 'clinical'));

ALTER TABLE public.communities
    ADD COLUMN IF NOT EXISTS explore_grant_activity_codes TEXT[] NOT NULL DEFAULT '{}';
