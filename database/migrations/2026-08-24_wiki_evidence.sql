-- =============================================================================
-- Migration: project_evidence_items, wiki_note_evidence  (2026-08-24)
-- =============================================================================
-- STAGE 2 of the project wiki. Stage 1 (2026-08-22_wiki_notes.sql) gave the
-- agent memory — notes it writes and reads back. This migration gives it a
-- SECOND kind of memory: the ~56 candidates a run actually retrieves, of
-- which only 5-8 ever get selected/proposed today. The other ~48 cost a
-- real API call each and are discarded the moment the run ends. This is
-- what makes that retrieval visible, organised by the notes it's evidence
-- for — the graph view (stage 2's frontend half) reads straight off this.
--
-- TWO TABLES, NOT ONE — WHY A JUNCTION, NOT ITEMS-ON-THE-NOTE
--   project_evidence_items  — one row per DISTINCT item ever retrieved for
--     a project (deduped on the item's own stable id, see DEDUP below),
--     curated fields only, never a raw payload (see CURATION below).
--   wiki_note_evidence      — many-to-many: (note_id, evidence_item_id).
--
-- Storing items as a JSON array column on wiki_notes was the other option
-- and was rejected for two concrete reasons the spec calls out directly:
--   1. "AN ITEM CAN BE EVIDENCE FOR MORE THAN ONE NOTE" — a real case, not
--      hypothetical: run against the NLRP3 project, the tubular-epithelial-
--      cell/PANX1 dataset was cited by BOTH the GSDMD-pyroptosis concept
--      note and the IL-1beta note (see the stage-1 report's actual output).
--      A JSON array on the note would need the SAME item's curated fields
--      copied into two notes' arrays — exactly the "could disagree with
--      the content" duplication problem 2026-08-22's own migration ruled
--      out for links, for the identical reason.
--   2. "ITEMS THAT MATCH NO NOTE... STORE THEM AGAINST THE PROJECT WITH NO
--      NOTE" — an unfiled item has no note to be a JSON column on. It needs
--      a home of its own regardless of what's filed where, which is
--      exactly what project_evidence_items is: every retrieved item lives
--      there whether zero, one, or several wiki_note_evidence rows point
--      at it.
--
-- DEDUP / GROWTH — WHY THIS DOESN'T GROW 56 ROWS PER RUN. Reruns on an
-- unchanged project description search largely the same terms and get back
-- largely the same candidates (same external ids). project_evidence_items
-- is UNIQUE on (project_id, item_id) — item_id being the Item.id the
-- backend already mints as f"{source}:{external_id}" (models.py), stable
-- across runs by construction, NOT a fresh UUID per sighting. A rerun
-- upserts: an already-seen item gets last_seen_at bumped, a genuinely new
-- one gets a new row. Real growth per project is bounded by the DISTINCT
-- candidate universe for that project's goal text, not by run count — in
-- practice, low hundreds of rows even after many runs, not "56 x runs."
-- wiki_note_evidence grows similarly slowly: filing the same item under the
-- same note twice is a no-op (PRIMARY KEY (note_id, evidence_item_id)), so
-- only a genuinely new (note, item) pairing adds a row.
--
-- PRUNING: not built here, and not needed at today's scale — a project at
-- even 20 runs against a stable goal is realistically a few hundred
-- project_evidence_items rows, not a Postgres-scale problem, and there is
-- no reading UI yet that would suffer from that many. If a project's goal
-- text changes enough that old candidates go stale (a real scenario:
-- target/indication edited after 6 months), the honest fix is a
-- last_seen_at-based archival pass in a follow-up migration, NOT introduced
-- speculatively now — same "don't half-build a table nobody reads yet"
-- stance as 2026-08-19_project_digests.sql's own history-vs-upsert note.
--
-- CURATION AT WRITE TIME, SAME DISCIPLINE AS CHEMBL (sources/chembl.py):
-- ChEMBL's own docstring states the rule this table follows — "`raw` is a
-- curated, first-party dict of NAMED fields only... The full ChEMBL record
-- ...is never stored." Every fetcher hand-picks named fields off the
-- upstream response into a small dict; nothing like a full JSON blob is
-- ever kept. project_evidence_items applies the identical discipline one
-- level up: NO raw/jsonb catch-all column at all, only the named fields
-- models.Item already promises for every kind regardless of source (id,
-- kind, title, summary, url, source, date_iso, and the two signal fields
-- ONLY when the source actually reported one — see Item's own "signal
-- integrity" docstring on never fabricating one). Item.raw itself (already
-- curated per-source, per ChEMBL's own precedent) is still never persisted
-- here — its shape varies by source and was never meant for cross-source
-- storage or display, only for that source's own ItemCard rendering.
--
-- FILED VS UNFILED: an item with zero wiki_note_evidence rows pointing at
-- it is "unfiled" — a plain LEFT JOIN / NOT EXISTS query from the frontend,
-- not a boolean flag that could drift out of sync with the junction table
-- (same "derive, don't duplicate" reasoning as wiki_notes' own [[links]]
-- being parsed from body text rather than mirrored into a flag).
--
-- RLS: project_id lives on BOTH tables (wiki_note_evidence denormalizes it
-- from its note, rather than requiring a join through wiki_notes inside
-- the policy) so both policies are a plain is_project_member(project_id,
-- auth.uid()) check, same pattern as checklist_items/project_digests/
-- wiki_notes — no new SECURITY DEFINER function needed. A CHECK constraint
-- (not a trigger) enforces that a wiki_note_evidence row's project_id
-- actually matches its note's project_id, so the denormalization can't
-- silently drift — see the trigger below, since Postgres CHECK constraints
-- cannot reference another table; a BEFORE INSERT OR UPDATE trigger is the
-- correct tool here, not a second bespoke SECURITY DEFINER function.
--
-- Run once in the Supabase SQL editor, after 2026-08-22_wiki_notes.sql.
-- Idempotent — safe to re-run. NOT RUN as part of writing this migration.
-- =============================================================================

-- ── TABLE: project_evidence_items ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.project_evidence_items (
    id             UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id     UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    -- The backend's own Item.id ("source:external_id", models.py) — stable
    -- across runs by construction. This, not a fresh UUID, is what the
    -- (project_id, item_id) uniqueness below dedupes on.
    item_id        TEXT        NOT NULL,
    kind           TEXT        NOT NULL,
    title          TEXT        NOT NULL,
    summary        TEXT,
    url            TEXT,
    source         TEXT        NOT NULL,
    date_iso       TEXT,
    -- Signal fields mirror models.Signal exactly (metric/value/as_of) —
    -- BOTH null together whenever the source reported none, never
    -- fabricated; see Item's own docstring. Never a generic jsonb blob.
    signal_metric  TEXT,
    signal_value   DOUBLE PRECISION,
    signal_as_of   TEXT,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_evidence_items_pkey PRIMARY KEY (id),
    CONSTRAINT project_evidence_items_project_item_unique UNIQUE (project_id, item_id)
);

CREATE INDEX IF NOT EXISTS project_evidence_items_project_id_idx
    ON public.project_evidence_items (project_id);

ALTER TABLE public.project_evidence_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project evidence items: member select" ON public.project_evidence_items;
CREATE POLICY "Project evidence items: member select"
    ON public.project_evidence_items FOR SELECT
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project evidence items: member insert" ON public.project_evidence_items;
CREATE POLICY "Project evidence items: member insert"
    ON public.project_evidence_items FOR INSERT
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

-- UPDATE needed for the upsert-on-(project_id, item_id) branch that bumps
-- last_seen_at (and refreshes title/summary/etc., in case the source's own
-- text changed between runs) on a re-sighting.
DROP POLICY IF EXISTS "Project evidence items: member update" ON public.project_evidence_items;
CREATE POLICY "Project evidence items: member update"
    ON public.project_evidence_items FOR UPDATE
    USING (public.is_project_member(project_id, auth.uid()))
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

-- No DELETE policy: nothing in this feature deletes an evidence item row
-- directly; it ages out with the project (ON DELETE CASCADE) or, later, a
-- real pruning pass (see this file's own header note on pruning).

-- ── TABLE: wiki_note_evidence (the many-to-many junction) ───────────────────

CREATE TABLE IF NOT EXISTS public.wiki_note_evidence (
    note_id            UUID        NOT NULL REFERENCES public.wiki_notes (id) ON DELETE CASCADE,
    evidence_item_id   UUID        NOT NULL REFERENCES public.project_evidence_items (id) ON DELETE CASCADE,
    -- Denormalized from the note for RLS + query convenience (see header
    -- note); kept honest by the trigger below, not trusted from the caller.
    project_id         UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    -- Why the agent filed this item under this note — the same short
    -- justification the checklist/relevance passes already produce, kept
    -- here so the side panel can show it instead of just a bare list.
    rationale          TEXT,
    filed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_note_evidence_pkey PRIMARY KEY (note_id, evidence_item_id)
);

CREATE INDEX IF NOT EXISTS wiki_note_evidence_evidence_item_id_idx
    ON public.wiki_note_evidence (evidence_item_id);

-- Keeps the denormalized project_id honest: derives it from the note being
-- linked rather than trusting whatever the caller sent, and rejects the
-- insert/update outright if the referenced evidence item belongs to a
-- DIFFERENT project than the note (a cross-project link would otherwise be
-- silently accepted since both FKs are individually valid).
CREATE OR REPLACE FUNCTION public.set_wiki_note_evidence_project_id()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
DECLARE
    note_project_id UUID;
    item_project_id UUID;
BEGIN
    SELECT project_id INTO note_project_id FROM public.wiki_notes WHERE id = NEW.note_id;
    SELECT project_id INTO item_project_id FROM public.project_evidence_items WHERE id = NEW.evidence_item_id;
    IF note_project_id IS NULL OR item_project_id IS NULL THEN
        RAISE EXCEPTION 'wiki_note_evidence: note or evidence item not found';
    END IF;
    IF note_project_id <> item_project_id THEN
        RAISE EXCEPTION 'wiki_note_evidence: note and evidence item belong to different projects';
    END IF;
    NEW.project_id := note_project_id;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_wiki_note_evidence_project_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_wiki_note_evidence_project_id() FROM anon;

DROP TRIGGER IF EXISTS trg_set_wiki_note_evidence_project_id ON public.wiki_note_evidence;
CREATE TRIGGER trg_set_wiki_note_evidence_project_id
    BEFORE INSERT OR UPDATE ON public.wiki_note_evidence
    FOR EACH ROW
    EXECUTE FUNCTION public.set_wiki_note_evidence_project_id();

ALTER TABLE public.wiki_note_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Wiki note evidence: member select" ON public.wiki_note_evidence;
CREATE POLICY "Wiki note evidence: member select"
    ON public.wiki_note_evidence FOR SELECT
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Wiki note evidence: member insert" ON public.wiki_note_evidence;
CREATE POLICY "Wiki note evidence: member insert"
    ON public.wiki_note_evidence FOR INSERT
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

-- A human may un-file a bad assignment (the graph view's side panel lets
-- them remove one item from under a note) without needing to touch the
-- note or the item itself.
DROP POLICY IF EXISTS "Wiki note evidence: member delete" ON public.wiki_note_evidence;
CREATE POLICY "Wiki note evidence: member delete"
    ON public.wiki_note_evidence FOR DELETE
    USING (public.is_project_member(project_id, auth.uid()));

-- No UPDATE policy: a filing is either there or it isn't — re-filing the
-- same (note_id, evidence_item_id) pair is a no-op insert conflict, not an
-- update; nothing about a filing (its rationale aside) is meant to change
-- in place. A rationale correction, if ever needed, is a delete + re-insert.
