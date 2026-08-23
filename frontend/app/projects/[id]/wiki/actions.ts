"use server";

// Server Actions for /projects/[id]/wiki. Same thin-wrapper idiom as
// app/projects/[id]/actions.ts: parse input, call into lib/server/, translate
// the result — see CLAUDE.md's "actions.ts" convention.
//
// EXACTLY ONE WRITE ACTION HERE, per this stage's own constraint: a human
// may edit a note's body (which sets is_human_edited). No note-creation
// action exists — the agent creates, humans refine — and no version-history
// action either.

import { revalidatePath } from "next/cache";
import { UnauthorizedError } from "@/lib/auth";
import { humanEditNote } from "@/lib/server/wikiNotes";

export type EditNoteActionResult = { ok: true } | { ok: false; error: string };

export async function editNoteAction(
  projectId: string,
  noteId: string,
  body: string
): Promise<EditNoteActionResult> {
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, error: "A note can't be emptied out — edit it, don't blank it." };
  }
  try {
    const result = await humanEditNote(projectId, noteId, trimmed);
    if (result.status !== "ok") {
      return { ok: false, error: result.error };
    }
    revalidatePath(`/projects/${projectId}/wiki`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to edit this note." };
    return { ok: false, error: "Couldn't save your edit. Please try again." };
  }
}
