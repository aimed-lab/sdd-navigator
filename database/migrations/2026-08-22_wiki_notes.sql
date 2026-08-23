-- =============================================================================
-- Migration: wiki_notes  (2026-08-22)
-- =============================================================================
-- STAGE 1 of the project wiki (Chen's ask): the agent's memory. Today every
-- run starts blank and rediscovers the same things. This table is what a run
-- reads from at the start and writes to at the end. No reading UI yet — that
-- is stage 2, layered on top of this table without changing its shape.
--
-- A NOTE IS A CONCEPT OR ENTITY, NEVER A PAPER/DATASET/TRIAL/COMPOUND. For an
-- NLRP3 kidney project the notes are things like "NLRP3", "GSDMD-mediated
-- pyroptosis", "IL1B release", "diabetic kidney disease", "proximal tubule",
-- and open questions like "which effector dominates in kidney tissue" —
-- never "Smith et al. 2024" or a GEO dataset title. Papers/datasets/trials/
-- compounds are CITATIONS INSIDE a note's body, exactly like
-- prior_art_brief.py's digest cites them, never rows in this table
-- themselves. If this table ever fills up with paper titles, the agent's
-- writer has drifted from the spec and needs fixing, not the schema.
--
-- LINKS ARE PARSED FROM BODY TEXT, NOT A SEPARATE EDGE TABLE — PARSE ON READ,
-- NOT A MAINTAINED DERIVED TABLE. A note's body writes [[Other Note Title]]
-- inline; the graph is whatever `[[...]]` currently appears in body text,
-- full stop. Deciding against a maintained wiki_note_links table:
--   - This table is upsert-heavy, not append-only (see ONE ROW PER SLUG
--     below) — every agent run can rewrite a note's entire body. A derived
--     edges table would need to be re-diffed on every single upsert (delete
--     stale outgoing edges, insert new ones) inside the same write, which is
--     exactly the kind of "table that could disagree with the content" this
--     spec explicitly says never to build, the moment that second write ever
--     fails or is skipped.
--   - There is no reading UI yet (stage 2) to have a query-latency
--     requirement that would justify precomputing traversal. A project's
--     note count is small (this table has no page/pagination concept, by
--     design — memory is capped by MAX_NOTE_CONTEXT in the agent's own read
--     path, see tools/wiki_agent.py), so a regex over each body's text at
--     read time is cheap.
--   - If stage 2 later needs indexed graph traversal at real scale, the fix
--     is to add a maintained table THEN, driven by a trigger on this table
--     (AFTER INSERT OR UPDATE OF body), so link-derivation logic lives in
--     exactly one place and can never disagree with what a reader parsing
--     body text directly would see. Not built now because nothing reads the
--     graph yet.
--
-- ONE ROW PER (project_id, slug) — UPSERT, NOT HISTORY, same shape as
-- project_digests (2026-08-19_project_digests.sql): the agent UPDATES an
-- existing note by slug rather than creating a near-duplicate every run
-- (see tools/wiki_agent.py's own docstring for how it decides update vs.
-- create). Unlike project_digests, the key here is a separate `id` UUID
-- rather than the slug itself, because a note CAN be renamed (title edited
-- by a human) without changing its identity — a foreign key from a future
-- edge table or a "last note I looked at" pointer should survive a rename.
--
-- id | project_id | slug | title | body | note_type | created_at | updated_at
-- | who last edited it — slug is a human-and-agent-readable stable key
-- derived from title (lowercased, hyphenated) at write time; title is the
-- display name and CAN change without changing slug identity across a
-- rename, same reasoning as the id/slug split above.
--
-- HUMAN EDITS ARE NEVER OVERWRITTEN BY THE AGENT. is_human_edited flips to
-- true the moment a human (not the agent's own write path) saves a change,
-- and stays true forever after — nothing in this schema ever flips it back
-- to false, that would need a deliberate "reset to agent-owned" action this
-- spec doesn't ask for. The actual enforcement is IN CODE, not in the
-- database: frontend/lib/server/wikiNotes.ts's agent-facing save path reads
-- the row first and refuses to touch its body/title if is_human_edited is
-- true (see that file's own comment for why this can't be a DB trigger: the
-- agent's write and a human's write both go through the same RLS role —
-- "any project member" — so there is no role-based signal a trigger could
-- key off; the distinction is which CODE PATH is calling, which only the
-- application layer knows). The column exists here so that distinction can
-- be persisted and read back at all.
--
-- RLS: same pattern as checklist_items and project_digests — membership via
-- is_project_member(), not ownership. A non-member gets ZERO rows via raw
-- PostgREST, not a hidden one client-side. is_project_member() is already
-- SECURITY DEFINER (2026-08-04_projects.sql) and is reused as-is here, no
-- new SECURITY DEFINER function is introduced by this migration — nothing
-- below needs a REVOKE ALL ... FROM anon of its own for that reason. (Note,
-- NOT fixed by this migration, confirmed LIVE by direct RPC call as anon:
-- is_project_lead() was already closed off in 2026-08-08_project_co_leads.sql
-- (REVOKE ... FROM anon, then GRANT EXECUTE TO authenticated only — calling
-- it as anon now correctly 401s with "permission denied for function"). But
-- is_project_member() — the one this migration's own RLS policies actually
-- call — was NOT touched by that migration (it says so explicitly, "NOT
-- re-granted here... flagging rather than silently fixing them as a
-- drive-by") and still carries Supabase's project-wide default privilege
-- that grants EXECUTE to `anon` directly at CREATE TIME, a grant a plain
-- `REVOKE ... FROM PUBLIC` never touches. Confirmed live: POST .../rpc/
-- is_project_member as anon returns 200 false (permitted, just evaluates
-- false for a non-member), not a permission error. This does NOT itself
-- leak any row through wiki_notes' own policies above — is_project_member
-- correctly returns false for a non-member regardless of who's allowed to
-- ask — but it is the same live hole the four-times-caught pattern refers
-- to, sitting underneath EVERY is_project_member()-gated table in this
-- codebase (projects, project_members, checklist_items, project_digests,
-- wiki_notes), not introduced or fixed by this migration. The fix, to run
-- by hand in a follow-up migration, NOT included here:
--   REVOKE ALL ON FUNCTION public.is_project_member(UUID, UUID) FROM PUBLIC;
--   REVOKE ALL ON FUNCTION public.is_project_member(UUID, UUID) FROM anon;
--   GRANT EXECUTE ON FUNCTION public.is_project_member(UUID, UUID) TO authenticated;
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run. NOT RUN
-- as part of writing this migration, per the stage-1 instruction to write
-- it, not apply it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wiki_notes (
    id               UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id       UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    slug             TEXT        NOT NULL,
    title            TEXT        NOT NULL,
    body             TEXT        NOT NULL DEFAULT '',
    note_type        TEXT        NOT NULL,
    is_human_edited  BOOLEAN     NOT NULL DEFAULT false,
    updated_by       UUID        REFERENCES public.users (id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_notes_pkey PRIMARY KEY (id),
    CONSTRAINT wiki_notes_project_slug_unique UNIQUE (project_id, slug),
    CONSTRAINT wiki_notes_note_type_check
        CHECK (note_type IN ('concept', 'entity', 'question'))
);

CREATE INDEX IF NOT EXISTS wiki_notes_project_id_idx ON public.wiki_notes (project_id);

ALTER TABLE public.wiki_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Wiki notes: member select" ON public.wiki_notes;
CREATE POLICY "Wiki notes: member select"
    ON public.wiki_notes FOR SELECT
    USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Wiki notes: member insert" ON public.wiki_notes;
CREATE POLICY "Wiki notes: member insert"
    ON public.wiki_notes FOR INSERT
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

-- UPDATE, not just INSERT — the agent's "update rather than duplicate" rule
-- and a human's hand-edit both need this. Whether a given UPDATE is allowed
-- to touch body/title at all (the "never overwrite a human edit" rule) is
-- NOT expressed here — RLS has no notion of "who/what is issuing this
-- specific statement" beyond the authenticated uid, which is the same for
-- an agent-triggered save and a human hand-edit alike (both ride on the
-- signed-in member's session, see wikiNotes.ts). That rule is enforced in
-- application code, one layer up; see this file's header comment.
DROP POLICY IF EXISTS "Wiki notes: member update" ON public.wiki_notes;
CREATE POLICY "Wiki notes: member update"
    ON public.wiki_notes FOR UPDATE
    USING (public.is_project_member(project_id, auth.uid()))
    WITH CHECK (public.is_project_member(project_id, auth.uid()));

-- A human can delete their own team's stray/bad note; the agent never
-- deletes anything it or anyone else wrote.
DROP POLICY IF EXISTS "Wiki notes: member delete" ON public.wiki_notes;
CREATE POLICY "Wiki notes: member delete"
    ON public.wiki_notes FOR DELETE
    USING (public.is_project_member(project_id, auth.uid()));
