// lib/server/pages/pageNoteEdit.ts — people editing the sections (page_notes) of
// a wiki page: change one, add one, delete one.
//
// Everything goes through the caller's OWN session (requireCurrentUser), so row
// level security is the gate: page_notes insert/update need can_edit_page()
// (the owner, a page editor on a team page, or a member of the page's
// project) and page_notes delete needs the page owner. A write that RLS
// refuses matches no row and is reported as "forbidden". A section saved here
// is marked is_human_edited with updated_by = the editor, which is what keeps
// the page-generation code from writing over it (savePageNotes skips such a
// note; the daily refresh never writes notes at all).

import { requireCurrentUser } from "@/lib/auth";
import { nextPosition, parseNoteInput, sectionSlug } from "@/lib/server/pages/pageEditCore";

export type NoteEditResult =
  | { status: "ok"; noteId?: string }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

const CANT_EDIT = "You can't edit this page.";
const NOT_OWNER = "Only the page owner can delete a section.";

export async function updatePageNote(pageId: string, noteId: string, title: unknown, body: unknown): Promise<NoteEditResult> {
  const parsed = parseNoteInput(title, body);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  const { user, db } = await requireCurrentUser();

  const { data, error } = await db
    .from("page_notes")
    .update({
      title: parsed.value.title,
      body: parsed.value.body,
      is_human_edited: true,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", noteId)
    .eq("page_id", pageId)
    .select("id");
  if (error) {
    console.error("updatePageNote failed", error);
    return { status: "error", error: "Couldn't save your changes." };
  }
  if (!data || data.length === 0) return { status: "forbidden", error: CANT_EDIT };
  return { status: "ok", noteId };
}

export async function addPageNote(pageId: string, title: unknown, body: unknown): Promise<NoteEditResult> {
  const parsed = parseNoteInput(title, body);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  const { user, db } = await requireCurrentUser();

  const { data: existing, error: readError } = await db.from("page_notes").select("slug, position").eq("page_id", pageId);
  if (readError) {
    console.error("addPageNote: read failed", readError);
    return { status: "error", error: "Couldn't add the section." };
  }
  const rows = (existing ?? []) as { slug: string; position: number }[];
  const id = globalThis.crypto.randomUUID();

  // No RETURNING (no .select()): the id is made here, so nothing needs to come
  // back, and a RETURNING insert can fail the read policy for a new row.
  const { error } = await db.from("page_notes").insert({
    id,
    page_id: pageId,
    slug: sectionSlug(parsed.value.title, rows.map((r) => r.slug)),
    title: parsed.value.title,
    body: parsed.value.body,
    note_type: "concept",
    is_human_edited: true,
    updated_by: user.id,
    position: nextPosition(rows.map((r) => r.position ?? 0)),
  });
  if (error) {
    if ((error as { code?: string }).code === "42501") return { status: "forbidden", error: CANT_EDIT };
    console.error("addPageNote failed", error);
    return { status: "error", error: "Couldn't add the section." };
  }
  return { status: "ok", noteId: id };
}

export async function deletePageNote(pageId: string, noteId: string): Promise<NoteEditResult> {
  const { db } = await requireCurrentUser();
  const { data, error } = await db.from("page_notes").delete().eq("id", noteId).eq("page_id", pageId).select("id");
  if (error) {
    console.error("deletePageNote failed", error);
    return { status: "error", error: "Couldn't delete the section." };
  }
  if (!data || data.length === 0) return { status: "forbidden", error: NOT_OWNER };
  return { status: "ok" };
}
