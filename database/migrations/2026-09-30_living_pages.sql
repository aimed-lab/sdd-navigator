-- =============================================================================
-- Migration: living pages (pages, page_notes, page_evidence,
--            page_note_evidence, page_updates)  (2026-09-30)
-- =============================================================================
-- ADDITIVE ONLY. Does not alter or drop any existing table, function, or
-- policy. Written but NOT run against any database as part of this task.
--
-- Five new tables for the "living wiki" concept: a user types a seed (a
-- topic, a researcher, or a community), an agent researches it and writes a
-- page — no `projects`/`project_members` team model involved. Deliberately
-- named `pages`/`page_notes`/`page_evidence`/`page_note_evidence`/
-- `page_updates`, NOT `wiki_*` — `public.wiki_pages` already exists (the
-- podcast-episode table, 2026-07-xx schema.sql) and means something
-- unrelated; reusing the `wiki_` prefix here would collide in meaning even
-- though not in name.
--
-- `page_notes`/`page_evidence`/`page_note_evidence` intentionally MIRROR
-- `wiki_notes`/`project_evidence_items`/`wiki_note_evidence`
-- (2026-08-22_wiki_notes.sql, 2026-08-24_wiki_evidence.sql) column-for-column
-- — same note_type values, same dedup key shape, same "denormalized owning
-- key kept honest by a trigger, not trusted from the caller" pattern for the
-- junction table. See those two migrations for the full design rationale
-- (grounding, dedup on a stable item_id, links parsed from body text rather
-- than a maintained edge table, etc.) — not re-derived here, only the
-- OWNERSHIP MODEL differs, described below.
--
-- OWNERSHIP MODEL — single owner, not a team:
--   `pages.owner_id` is NULLABLE and references `public.users(id)`, the same
--   way `wiki_notes.updated_by` and every other user-FK in this codebase
--   does (never `auth.users` directly). NULL means an anonymous page — no
--   signed-in user created it. Anonymous pages are written ONLY by the
--   server using the service-role key (which bypasses RLS entirely), so
--   there are deliberately no INSERT/UPDATE/DELETE policies for anon here,
--   matching the instruction that gave rise to this migration.
--
-- VISIBILITY, NOT MEMBERSHIP — RLS here is `owner_id = auth.uid() OR
-- visibility = 'public'`, not `is_project_member()`. There is no team, so
-- there is no membership function to reuse; this follows the
-- `promote_showcase`/`published` precedent (schema.sql) — a single boolean-
-- shaped gate plus an owner escape hatch — rather than inventing a new
-- SECURITY DEFINER function for a check this simple.
--
-- `page_updates` is the one genuinely new shape: an APPEND-ONLY dated
-- timeline (no `updated_at`, no update policy) — "new items found since
-- last refresh," distinct from `page_notes` (the durable, upsert-by-slug
-- write-up) and `page_evidence` (the deduped raw-candidate pool). Modeled
-- as its own row per (page, date, item) rather than reusing
-- `page_evidence.first_seen_at` for this, because a timeline entry needs to
-- survive independently of whether the evidence item it came from is later
-- pruned — see `evidence_id`'s ON DELETE SET NULL below.
--
-- `touch_updated_at()` (public.touch_updated_at, first defined in
-- 2026-07-26_collab_posts.sql) is REUSED, not redefined, for `pages` and
-- `page_notes`' `updated_at` columns — this migration does not touch that
-- function's own definition, only attaches new triggers to it, so it is
-- additive with respect to that existing object too.
--
-- Run once in the Supabase SQL editor, after 2026-08-24_wiki_evidence.sql
-- (referenced here only in comments, not by FK — these tables have no FK
-- relationship to the project-wiki tables). Idempotent — safe to re-run.
-- NOT RUN as part of writing this migration.
-- =============================================================================

-- ── TABLE: pages ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pages (
    id                 UUID        NOT NULL DEFAULT gen_random_uuid(),
    slug               TEXT        NOT NULL,
    title              TEXT        NOT NULL,
    seed_type          TEXT        NOT NULL,
    seed_input         TEXT        NOT NULL,
    -- NULL = anonymous page (no signed-in creator). Never public.auth.users
    -- directly — same indirection every other owner_id in this codebase
    -- uses, so a user's own display fields (name/affiliation/etc.) are one
    -- join away without touching auth schema.
    owner_id           UUID        REFERENCES public.users (id) ON DELETE CASCADE,
    visibility         TEXT        NOT NULL DEFAULT 'public',
    refresh_enabled    BOOLEAN     NOT NULL DEFAULT true,
    last_refreshed_at  TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pages_pkey PRIMARY KEY (id),
    CONSTRAINT pages_slug_unique UNIQUE (slug),
    CONSTRAINT pages_seed_type_check
        CHECK (seed_type IN ('topic', 'researcher', 'community')),
    CONSTRAINT pages_visibility_check
        CHECK (visibility IN ('public', 'private'))
);

-- pages_slug_unique above already creates a unique index usable for slug
-- lookups; owner_id gets its own index since ownership checks (RLS and "my
-- pages" listings) filter on it directly, same as every other owner_id
-- column in this codebase (e.g. idx_lab_resources_owner, idx_collab_posts_owner).
CREATE INDEX IF NOT EXISTS pages_owner_id_idx ON public.pages (owner_id);

ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pages: read public or own" ON public.pages;
CREATE POLICY "Pages: read public or own"
    ON public.pages FOR SELECT
    USING (visibility = 'public' OR owner_id = auth.uid());

-- Browser-side creation always attaches the signed-in user as owner; an
-- anonymous page (owner_id NULL) is created only by the server via the
-- service-role key, which bypasses RLS entirely — no INSERT policy is
-- offered for a NULL owner_id here.
DROP POLICY IF EXISTS "Pages: insert own" ON public.pages;
CREATE POLICY "Pages: insert own"
    ON public.pages FOR INSERT
    TO authenticated
    WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Pages: update own" ON public.pages;
CREATE POLICY "Pages: update own"
    ON public.pages FOR UPDATE
    TO authenticated
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Pages: delete own" ON public.pages;
CREATE POLICY "Pages: delete own"
    ON public.pages FOR DELETE
    TO authenticated
    USING (owner_id = auth.uid());

DROP TRIGGER IF EXISTS pages_touch_updated_at ON public.pages;
CREATE TRIGGER pages_touch_updated_at
    BEFORE UPDATE ON public.pages
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── TABLE: page_notes (mirrors wiki_notes, page_id instead of project_id) ───

CREATE TABLE IF NOT EXISTS public.page_notes (
    id               UUID        NOT NULL DEFAULT gen_random_uuid(),
    page_id          UUID        NOT NULL REFERENCES public.pages (id) ON DELETE CASCADE,
    slug             TEXT        NOT NULL,
    title            TEXT        NOT NULL,
    body             TEXT        NOT NULL DEFAULT '',
    note_type        TEXT        NOT NULL,
    is_human_edited  BOOLEAN     NOT NULL DEFAULT false,
    updated_by       UUID        REFERENCES public.users (id),
    -- Ordering within a page's note list. Not present on wiki_notes (that
    -- feature has no reading UI ordering need yet); a living page's notes
    -- are meant to be read top-to-bottom, so this is the one deliberate
    -- addition beyond a straight mirror.
    position         INT         NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT page_notes_pkey PRIMARY KEY (id),
    CONSTRAINT page_notes_page_slug_unique UNIQUE (page_id, slug),
    CONSTRAINT page_notes_note_type_check
        CHECK (note_type IN ('concept', 'entity', 'question'))
);

CREATE INDEX IF NOT EXISTS page_notes_page_id_idx ON public.page_notes (page_id);

ALTER TABLE public.page_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Page notes: read public or own" ON public.page_notes;
CREATE POLICY "Page notes: read public or own"
    ON public.page_notes FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.pages p
            WHERE p.id = page_id
              AND (p.visibility = 'public' OR p.owner_id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "Page notes: owner insert" ON public.page_notes;
CREATE POLICY "Page notes: owner insert"
    ON public.page_notes FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
    );

-- Owner-only, per the task's explicit note that "page_notes updates only by
-- the owner" — unlike wiki_notes (any project member), a living page has no
-- team to extend update rights to.
DROP POLICY IF EXISTS "Page notes: owner update" ON public.page_notes;
CREATE POLICY "Page notes: owner update"
    ON public.page_notes FOR UPDATE
    TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
    );

DROP POLICY IF EXISTS "Page notes: owner delete" ON public.page_notes;
CREATE POLICY "Page notes: owner delete"
    ON public.page_notes FOR DELETE
    TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
    );

DROP TRIGGER IF EXISTS page_notes_touch_updated_at ON public.page_notes;
CREATE TRIGGER page_notes_touch_updated_at
    BEFORE UPDATE ON public.page_notes
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── TABLE: page_evidence (mirrors project_evidence_items) ───────────────────

CREATE TABLE IF NOT EXISTS public.page_evidence (
    id             UUID        NOT NULL DEFAULT gen_random_uuid(),
    page_id        UUID        NOT NULL REFERENCES public.pages (id) ON DELETE CASCADE,
    -- Same stable "source:external_id" id the backend already mints
    -- (models.Item.id) — this, not a fresh UUID, is what the (page_id,
    -- item_id) uniqueness below dedupes on. Same shape and reasoning as
    -- project_evidence_items.item_id.
    item_id        TEXT        NOT NULL,
    kind           TEXT        NOT NULL,
    title          TEXT        NOT NULL,
    summary        TEXT,
    url            TEXT,
    source         TEXT        NOT NULL,
    date_iso       TEXT,
    signal_metric  TEXT,
    signal_value   DOUBLE PRECISION,
    signal_as_of   TEXT,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT page_evidence_pkey PRIMARY KEY (id),
    CONSTRAINT page_evidence_page_item_unique UNIQUE (page_id, item_id)
);

CREATE INDEX IF NOT EXISTS page_evidence_page_id_idx ON public.page_evidence (page_id);

ALTER TABLE public.page_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Page evidence: read public or own" ON public.page_evidence;
CREATE POLICY "Page evidence: read public or own"
    ON public.page_evidence FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.pages p
            WHERE p.id = page_id
              AND (p.visibility = 'public' OR p.owner_id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "Page evidence: owner insert" ON public.page_evidence;
CREATE POLICY "Page evidence: owner insert"
    ON public.page_evidence FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
    );

-- UPDATE needed for the same upsert-on-(page_id, item_id) re-sighting bump
-- of last_seen_at that project_evidence_items' own UPDATE policy exists for.
DROP POLICY IF EXISTS "Page evidence: owner update" ON public.page_evidence;
CREATE POLICY "Page evidence: owner update"
    ON public.page_evidence FOR UPDATE
    TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
    );

-- No DELETE policy — same reasoning as project_evidence_items: nothing in
-- this feature deletes an evidence row directly; it ages out with the page
-- (ON DELETE CASCADE) or a future pruning pass.

-- ── TABLE: page_note_evidence (mirrors wiki_note_evidence) ──────────────────

CREATE TABLE IF NOT EXISTS public.page_note_evidence (
    note_id            UUID        NOT NULL REFERENCES public.page_notes (id) ON DELETE CASCADE,
    evidence_item_id   UUID        NOT NULL REFERENCES public.page_evidence (id) ON DELETE CASCADE,
    -- Denormalized from the note for RLS + query convenience, kept honest
    -- by the trigger below rather than trusted from the caller — identical
    -- pattern to wiki_note_evidence.project_id.
    page_id            UUID        NOT NULL REFERENCES public.pages (id) ON DELETE CASCADE,
    rationale          TEXT,
    filed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT page_note_evidence_pkey PRIMARY KEY (note_id, evidence_item_id)
);

CREATE INDEX IF NOT EXISTS page_note_evidence_page_id_idx ON public.page_note_evidence (page_id);
CREATE INDEX IF NOT EXISTS page_note_evidence_evidence_item_id_idx
    ON public.page_note_evidence (evidence_item_id);

-- Keeps the denormalized page_id honest: derives it from the note being
-- linked rather than trusting the caller, and rejects the insert/update if
-- the referenced evidence item belongs to a DIFFERENT page than the note.
-- Same shape as set_wiki_note_evidence_project_id(), a new function (not a
-- rename of the existing one) so that existing function is left untouched.
CREATE OR REPLACE FUNCTION public.set_page_note_evidence_page_id()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    note_page_id UUID;
    item_page_id UUID;
BEGIN
    SELECT page_id INTO note_page_id FROM public.page_notes WHERE id = NEW.note_id;
    SELECT page_id INTO item_page_id FROM public.page_evidence WHERE id = NEW.evidence_item_id;
    IF note_page_id IS NULL OR item_page_id IS NULL THEN
        RAISE EXCEPTION 'page_note_evidence: note or evidence item not found';
    END IF;
    IF note_page_id <> item_page_id THEN
        RAISE EXCEPTION 'page_note_evidence: note and evidence item belong to different pages';
    END IF;
    NEW.page_id := note_page_id;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_page_note_evidence_page_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_page_note_evidence_page_id() FROM anon;

DROP TRIGGER IF EXISTS trg_set_page_note_evidence_page_id ON public.page_note_evidence;
CREATE TRIGGER trg_set_page_note_evidence_page_id
    BEFORE INSERT OR UPDATE ON public.page_note_evidence
    FOR EACH ROW
    EXECUTE FUNCTION public.set_page_note_evidence_page_id();

ALTER TABLE public.page_note_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Page note evidence: read public or own" ON public.page_note_evidence;
CREATE POLICY "Page note evidence: read public or own"
    ON public.page_note_evidence FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.pages p
            WHERE p.id = page_id
              AND (p.visibility = 'public' OR p.owner_id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "Page note evidence: owner insert" ON public.page_note_evidence;
CREATE POLICY "Page note evidence: owner insert"
    ON public.page_note_evidence FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
    );

-- A human may un-file a bad assignment without touching the note or item
-- itself — same as wiki_note_evidence's own DELETE-only-beyond-insert shape.
DROP POLICY IF EXISTS "Page note evidence: owner delete" ON public.page_note_evidence;
CREATE POLICY "Page note evidence: owner delete"
    ON public.page_note_evidence FOR DELETE
    TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
    );

-- No UPDATE policy — a filing is either there or it isn't, same reasoning
-- as wiki_note_evidence.

-- ── TABLE: page_updates (append-only dated timeline) ────────────────────────

CREATE TABLE IF NOT EXISTS public.page_updates (
    id             UUID        NOT NULL DEFAULT gen_random_uuid(),
    page_id        UUID        NOT NULL REFERENCES public.pages (id) ON DELETE CASCADE,
    -- Nullable, and ON DELETE SET NULL rather than CASCADE: a timeline entry
    -- is a historical record of "this was new on this date" and should
    -- survive even if the evidence row it pointed at is later pruned — see
    -- this file's header note on why page_updates exists as its own table
    -- rather than reusing page_evidence.first_seen_at directly.
    evidence_id    UUID        REFERENCES public.page_evidence (id) ON DELETE SET NULL,
    kind           TEXT        NOT NULL,
    title          TEXT        NOT NULL,
    summary        TEXT,
    url            TEXT,
    occurred_on    DATE        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT page_updates_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS page_updates_page_id_idx ON public.page_updates (page_id);

ALTER TABLE public.page_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Page updates: read public or own" ON public.page_updates;
CREATE POLICY "Page updates: read public or own"
    ON public.page_updates FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.pages p
            WHERE p.id = page_id
              AND (p.visibility = 'public' OR p.owner_id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "Page updates: owner insert" ON public.page_updates;
CREATE POLICY "Page updates: owner insert"
    ON public.page_updates FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
    );

-- No UPDATE policy — append-only, "never updated in place" per the task's
-- own instruction. A human may still delete a bad entry outright.
DROP POLICY IF EXISTS "Page updates: owner delete" ON public.page_updates;
CREATE POLICY "Page updates: owner delete"
    ON public.page_updates FOR DELETE
    TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
    );
