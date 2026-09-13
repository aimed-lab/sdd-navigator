-- =============================================================================
-- Migration: promote_showcase — linkedin_post column (2026-09-12)
-- =============================================================================
-- Promote is reworked so the deliverable a person leaves with is a LinkedIn
-- post that links to the article, not the article itself. This adds the
-- column that post is stored in — the article's own fields (headline,
-- standfirst, article_body) are unchanged and still generate/edit exactly as
-- before.
--
-- The stored text carries a literal "{{ARTICLE_LINK}}" placeholder where the
-- article URL goes, rather than baking the URL in at generation time — the
-- same stored row is read from both the owner's editor (a draft's slug/URL
-- exists as soon as the row does) and the public article page's share
-- button, and substituting at read time means editing the post text later
-- never has to touch a URL embedded mid-string.
--
-- Idempotent — safe to re-run.
-- =============================================================================

ALTER TABLE public.promote_showcase
    ADD COLUMN IF NOT EXISTS linkedin_post TEXT NOT NULL DEFAULT '';
