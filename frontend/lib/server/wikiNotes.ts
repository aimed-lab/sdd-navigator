// lib/server/wikiNotes.ts — the project wiki (stage 1: schema + the agent
// writing to it; see database/migrations/2026-08-22_wiki_notes.sql for the
// full design rationale). No reading UI yet, so this file has exactly two
// callers, both server-side, both wired from app/api/project-agent/*:
//
//   listWikiNoteSummaries(projectId) — called from
//     app/api/project-agent/start/route.ts, BEFORE a run starts, same "read
//     the caller's own data server-side, never trust the request body"
//     stance as listProjectResources() there. This is the agent's memory:
//     titles + bodies for every note the project already has, forwarded to
//     the Python backend as `existing_wiki_notes` so tools/wiki_agent.py can
//     decide update-vs-create and its own MAX_NOTE_CONTEXT-capped "memory"
//     can be built from titles + teasers (see that module's
//     context_for_prompt()) rather than a second network round-trip.
//
//   saveWikiNotes(projectId, notes) — called from
//     app/api/project-agent/status/route.ts, the moment a run comes back
//     done, exactly parallel to saveProjectDigest() just above it in
//     projects.ts. WRITES DIRECTLY, NO APPROVAL STEP — this is Chen's own
//     distinction: resources and checklist items change what the project
//     IS, so a human reviews them before they land; a wiki note is the
//     agent's own notebook, same as the digest, which already writes
//     unasked. There is no client-reachable action for this for the same
//     reason saveProjectDigest has none — the browser only ever RECEIVES a
//     wiki write via this same status poll, never POSTs one directly.
//
// THE ONE RULE RLS CANNOT ENFORCE, CHECKED IN CODE HERE: never overwrite a
// note a human has hand-edited. "Any project member can UPDATE" (the RLS
// policy) can't distinguish an agent-triggered save from a human's own
// edit — both ride the same signed-in member's session (see the migration's
// own header comment for why this genuinely can't be a DB trigger). This
// file is where that distinction actually gets enforced: saveWikiNotes()
// reads is_human_edited on the target row immediately before writing, and
// for an "update" action whose target is already human-edited, it REFUSES
// the body/title change and skips that note outright, exactly as if the
// agent had proposed nothing for it that run — it never silently downgrades
// the update to a create instead, since that would leave a near-duplicate
// note next to the human's, which is its own kind of overwrite-by-clutter.

import { requireCurrentUser } from "@/lib/auth";

export type WikiNoteType = "concept" | "entity" | "question";

export type WikiNoteSummary = {
  id: string;
  slug: string;
  title: string;
  note_type: WikiNoteType;
  body: string;
  is_human_edited: boolean;
};

export type WikiNoteProposal = {
  action: "update" | "create";
  note_id: string | null;
  slug: string;
  title: string;
  note_type: WikiNoteType;
  body: string;
};

export type ListWikiNotesResult =
  | { status: "ok"; notes: WikiNoteSummary[] }
  | { status: "error"; error: string };

/** Every note this project has, full body included — see this file's own
 *  header comment for why the caller (not this function) is what trims that
 *  down to titles + teasers before it ever reaches an LLM prompt. Best-
 *  effort by the same "degrade, don't block a run" stance as
 *  listProjectResources(): the caller treats a non-"ok" result as "the
 *  agent runs with no memory this time", never as a reason to fail the
 *  whole start request. */
export async function listWikiNoteSummaries(projectId: string): Promise<ListWikiNotesResult> {
  const { db } = await requireCurrentUser();

  const { data, error } = await db
    .from("wiki_notes")
    .select("id, slug, title, note_type, body, is_human_edited")
    .eq("project_id", projectId);

  if (error) {
    console.error("listWikiNoteSummaries: select failed", error);
    return { status: "error", error: "Couldn't load the project wiki." };
  }
  return { status: "ok", notes: (data ?? []) as WikiNoteSummary[] };
}

export type GetWikiNoteResult =
  | { status: "ok"; note: WikiNoteSummary }
  | { status: "not_found" }
  | { status: "error"; error: string };

/** ONE note, by id — for the "Go deeper" action (app/api/go-deeper/route.ts),
 *  which operates on exactly the note the researcher picked, never a list.
 *  RLS-scoped by project_id same as everything else here: a note id from a
 *  DIFFERENT project a caller isn't on returns not_found, not the row. */
export async function getWikiNote(projectId: string, noteId: string): Promise<GetWikiNoteResult> {
  const { db } = await requireCurrentUser();

  const { data, error } = await db
    .from("wiki_notes")
    .select("id, slug, title, note_type, body, is_human_edited")
    .eq("project_id", projectId)
    .eq("id", noteId)
    .maybeSingle();

  if (error) {
    console.error("getWikiNote: select failed", error);
    return { status: "error", error: "Couldn't load that note." };
  }
  if (!data) return { status: "not_found" };
  return { status: "ok", note: data as WikiNoteSummary };
}

export type SaveWikiNotesResult = {
  status: "ok";
  saved: number;
  skippedHumanEdited: number;
} | { status: "error"; error: string };

/** Persist the agent's proposed wiki writes. See this file's header comment
 *  for the full "writes directly, no approval step, but never over a human
 *  edit" rationale. BEST-EFFORT BY DESIGN, same as saveProjectDigest: the
 *  caller (the status route) must treat any non-"ok" result as "log it,
 *  still return the run's result to the client" — a failed wiki save must
 *  never fail or delay the response the browser is waiting on. */
export async function saveWikiNotes(
  projectId: string,
  notes: WikiNoteProposal[]
): Promise<SaveWikiNotesResult> {
  if (!notes || notes.length === 0) {
    return { status: "ok", saved: 0, skippedHumanEdited: 0 };
  }

  const { user, db } = await requireCurrentUser();

  let saved = 0;
  let skippedHumanEdited = 0;

  for (const note of notes) {
    if (note.action === "update" && note.note_id) {
      // Re-read the CURRENT row right before writing — the note summary the
      // Python agent decided against may be stale (a human could have
      // edited it mid-run), so this is the actual gate, not the agent's own
      // proposal shape.
      const { data: current, error: readError } = await db
        .from("wiki_notes")
        .select("is_human_edited")
        .eq("id", note.note_id)
        .eq("project_id", projectId)
        .maybeSingle();

      if (readError) {
        console.error("saveWikiNotes: re-read failed for update", note.note_id, readError);
        continue;
      }
      if (!current) {
        // The target vanished (deleted by a human between the agent's read
        // and now) — fall through to inserting it fresh under its slug
        // rather than silently dropping what the agent learned.
      } else if (current.is_human_edited) {
        skippedHumanEdited += 1;
        continue;
      }

      const { error } = await db
        .from("wiki_notes")
        .update({
          title: note.title,
          note_type: note.note_type,
          body: note.body,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", note.note_id)
        .eq("project_id", projectId)
        .eq("is_human_edited", false); // belt-and-suspenders against a race with the read above

      if (error) {
        console.error("saveWikiNotes: update failed", note.note_id, error);
        continue;
      }
      saved += 1;
      continue;
    }

    // CREATE (or an "update" whose target no longer exists) — check the
    // (project_id, slug) slot first. An upsert alone would silently
    // overwrite a note that's since been hand-edited under the same slug
    // (a plain boolean column carries no RLS meaning, so the database won't
    // stop that on its own) — same enforcement shape as the update branch
    // above, just keyed on slug instead of id since a create has no id yet.
    const { data: bySlot, error: slotError } = await db
      .from("wiki_notes")
      .select("id, is_human_edited")
      .eq("project_id", projectId)
      .eq("slug", note.slug)
      .maybeSingle();

    if (slotError) {
      console.error("saveWikiNotes: slug lookup failed", note.slug, slotError);
      continue;
    }
    if (bySlot?.is_human_edited) {
      skippedHumanEdited += 1;
      continue;
    }

    const { error } = await db.from("wiki_notes").upsert(
      {
        project_id: projectId,
        slug: note.slug,
        title: note.title,
        note_type: note.note_type,
        body: note.body,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,slug" }
    );

    if (error) {
      console.error("saveWikiNotes: create/upsert failed", note.slug, error);
      continue;
    }
    saved += 1;
  }

  return { status: "ok", saved, skippedHumanEdited };
}

// ── human editing (stage 2) ──────────────────────────────────────────────────

export type HumanEditNoteResult = { status: "ok" } | { status: "error"; error: string };

/** The ONE write a human can make to a note, per this stage's own
 *  constraints: edit the body, which sets is_human_edited=true in the same
 *  statement — there is no note-creation UI (the agent creates) and no
 *  version history (this REPLACES the body, it doesn't append a revision).
 *  Once set, is_human_edited never gets cleared by this function or any
 *  other path in this codebase — see this file's own header comment for
 *  why the agent must never be able to undo it. RLS ("Wiki notes: member
 *  update") is the only membership gate; any project member may edit any
 *  note, same "any member" stance as every other write in this feature. */
export async function humanEditNote(
  projectId: string,
  noteId: string,
  body: string
): Promise<HumanEditNoteResult> {
  const { user, db } = await requireCurrentUser();

  const { error } = await db
    .from("wiki_notes")
    .update({
      body,
      is_human_edited: true,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", noteId)
    .eq("project_id", projectId);

  if (error) {
    console.error("humanEditNote: update failed", noteId, error);
    return { status: "error", error: "Couldn't save your edit." };
  }
  return { status: "ok" };
}
