-- 2026-10-27  A project's GitHub link (Files tab: "Code (GitHub)")
--
-- projects.github_url: nullable, https://github.com/... only, at most 300
-- characters. Set by any member of the project, the same rule as the shared
-- folder link: the existing "Projects: member update" policy already lets any
-- member update the project row, so no policy is added. The CHECK is the
-- database's own guard that nothing but a github.com link is stored (the app
-- checks it too).
--
-- Idempotent: safe to re-run. NOT RUN as part of writing it.

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS github_url TEXT;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_github_url_check;
ALTER TABLE public.projects
    ADD CONSTRAINT projects_github_url_check
        CHECK (
            github_url IS NULL
            OR (
                char_length(github_url) <= 300
                AND github_url ~ '^https://github\.com/[A-Za-z0-9._~/%-]+$'
            )
        );
