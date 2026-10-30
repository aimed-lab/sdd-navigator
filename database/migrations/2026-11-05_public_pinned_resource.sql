-- 2026-11-05  Let a community show its pinned link to non-members
--
-- communities.show_pinned_to_public: when true and the community's pinned resource
-- (communities.pinned_resource_id, 2026-10-22_community_pinned_resource.sql) is a
-- LINK (a URL, no uploaded file), the community page shows that link to visitors
-- who are not members, signed in or not, as an "Apply to join" card. First use:
-- the SPARC Investigators application form.
--
-- Only an admin changes it, through the existing "Communities: admin update" policy
-- (it is a column of public.communities). No RLS on community_resources changes:
-- the page reads the one pinned link on the server (title, description, url) and
-- never exposes files, other resources or the member list.
--
-- Default false: every community looks exactly as it did. Idempotent. NOT RUN as
-- part of writing it.

ALTER TABLE public.communities
    ADD COLUMN IF NOT EXISTS show_pinned_to_public BOOLEAN NOT NULL DEFAULT false;
