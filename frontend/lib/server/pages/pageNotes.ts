// lib/server/pages/pageNotes.ts — page_notes persistence, copied and adapted
// from lib/server/wikiNotes.ts's saveWikiNotes() for the new `pages` feature
// (supabase/migrations/2026-09-30_living_pages.sql). See that file's own
// header comment for the full "writes directly, no approval step" and
// human-edit-guard rationale this mirrors.
//
// WHAT'S DIFFERENT FROM wikiNotes.ts, AND WHY:
//   * `page_id` instead of `project_id` throughout.
//   * Uses the SERVICE-ROLE client (getPagesServiceRoleClient), not
//     requireCurrentUser()'s session-scoped one — a page can be created with
//     no signed-in caller at all (owner_id NULL), and 2026-09-30_living_pages.sql
//     deliberately offers no INSERT/UPDATE policy for a NULL-owner page, so
//     writing its notes can only be done from the server, bypassing RLS.
//   * `updated_by` is omitted — there is no session user id to attribute an
//     anonymous page's notes to (page_notes.updated_by is nullable).
//   * The is_human_edited guard is KEPT: even though this feature currently
//     only ever calls saveNotesForNewPage() once, right after creating a
//     brand-new page (so no note can already be human-edited yet), keeping
//     the same check this function will need the moment a page gains a
//     "refresh" path is cheaper than writing a version now that would need
//     re-adding later, and it costs nothing on a page that has no notes yet.
//
// NOT a modification of wikiNotes.ts — that file is untouched; this is a new
// file, adapted by copying, per this task's own "copy-and-adapt rather than
// import-and-reuse" instruction.

import { getPagesServiceRoleClient } from "@/lib/server/pages/pagesDb";

export type PageNoteType = "concept" | "entity" | "question";

export type PageNoteProposal = {
  action: "update" | "create";
  note_id: string | null;
  slug: string;
  title: string;
  note_type: PageNoteType;
  body: string;
};

export type SavePageNotesResult =
  | { status: "ok"; saved: number; skippedHumanEdited: number; noteIdBySlug: Map<string, string> }
  | { status: "error"; error: string };

/** Persist the agent's proposed page-wiki writes for ONE page. Mirrors
 *  saveWikiNotes()'s per-note logic (re-read-before-update to guard against
 *  a human edit racing the write; upsert-by-slug for create, guarded by the
 *  same check) with `project_id`/`user.id` swapped for `page_id`/no
 *  attribution. Returns `noteIdBySlug` (not part of wikiNotes.ts's own
 *  result) — pageEvidence.ts's filing step needs each note's real database
 *  id, and this function already resolves one create/update at a time, so
 *  handing that map back avoids a second read-notes-back-by-project_id round
 *  trip the way frontend/app/api/project-agent/status/route.ts's separate
 *  saveEvidence() call has to do. */
export async function savePageNotes(
  pageId: string,
  notes: PageNoteProposal[]
): Promise<SavePageNotesResult> {
  const noteIdBySlug = new Map<string, string>();
  if (!notes || notes.length === 0) {
    return { status: "ok", saved: 0, skippedHumanEdited: 0, noteIdBySlug };
  }

  const db = getPagesServiceRoleClient();
  if (!db) {
    return { status: "error", error: "Server misconfigured: no service-role Supabase client." };
  }

  let saved = 0;
  let skippedHumanEdited = 0;

  for (const note of notes) {
    if (note.action === "update" && note.note_id) {
      const { data: current, error: readError } = await db
        .from("page_notes")
        .select("is_human_edited")
        .eq("id", note.note_id)
        .eq("page_id", pageId)
        .maybeSingle();

      if (readError) {
        console.error("savePageNotes: re-read failed for update", note.note_id, readError);
        continue;
      }
      if (current?.is_human_edited) {
        skippedHumanEdited += 1;
        continue;
      }
      if (current) {
        const { error } = await db
          .from("page_notes")
          .update({
            title: note.title,
            note_type: note.note_type,
            body: note.body,
            updated_at: new Date().toISOString(),
          })
          .eq("id", note.note_id)
          .eq("page_id", pageId)
          .eq("is_human_edited", false);

        if (error) {
          console.error("savePageNotes: update failed", note.note_id, error);
          continue;
        }
        saved += 1;
        noteIdBySlug.set(note.slug, note.note_id);
        continue;
      }
      // current is null (target vanished) — fall through to the create path.
    }

    const { data: bySlot, error: slotError } = await db
      .from("page_notes")
      .select("id, is_human_edited")
      .eq("page_id", pageId)
      .eq("slug", note.slug)
      .maybeSingle();

    if (slotError) {
      console.error("savePageNotes: slug lookup failed", note.slug, slotError);
      continue;
    }
    if (bySlot?.is_human_edited) {
      skippedHumanEdited += 1;
      continue;
    }

    const { data: upserted, error } = await db
      .from("page_notes")
      .upsert(
        {
          page_id: pageId,
          slug: note.slug,
          title: note.title,
          note_type: note.note_type,
          body: note.body,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "page_id,slug" }
      )
      .select("id, slug")
      .maybeSingle();

    if (error) {
      console.error("savePageNotes: create/upsert failed", note.slug, error);
      continue;
    }
    saved += 1;
    if (upserted) noteIdBySlug.set(upserted.slug as string, upserted.id as string);
  }

  return { status: "ok", saved, skippedHumanEdited, noteIdBySlug };
}
