"use server";

// Server Actions for the unified /promote/submit flow: create a private
// draft (DOI-sourced or manual), edit it, attach/remove media, publish.
// FormData is used for the media actions specifically because a File can
// only reach a Server Action that way, not as JSON.
//
// Goes through lib/server/showcase.ts -> lib/auth.ts. Never @supabase directly.

import { revalidatePath } from "next/cache";
import { UnauthorizedError } from "@/lib/auth";
import {
  addShowcaseMedia,
  createArticleEntry,
  deleteShowcaseEntry,
  EmptyArticleError,
  removeShowcaseMedia,
  setArticlePublished,
  updateArticleEntry,
} from "@/lib/server/showcase";
import type { ArticleDraftPatch, CreateArticleInput, ShowcaseMedia } from "@/lib/showcaseTypes";

export type SimpleActionResult = { ok: true } | { ok: false; error: string };
export type ArticleDraftResult =
  | { ok: true; id: string; slug: string }
  | { ok: false; error: string };
export type MediaActionResult =
  | { ok: true; media: ShowcaseMedia }
  | { ok: false; error: string };

/** Delete a showcase entry as the signed-in user. Rejects (401-equivalent)
 *  when signed out — the UI gate is a convenience, this is the actual
 *  enforcement. RLS is the real gate below that. */
export async function deleteShowcaseAction(entryId: string): Promise<SimpleActionResult> {
  if (!entryId) return { ok: false, error: "Missing entry." };

  try {
    await deleteShowcaseEntry(entryId);
    revalidatePath("/promote");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in to delete this entry." };
    }
    console.error("deleteShowcaseAction failed", e);
    return { ok: false, error: "Couldn't delete the entry. Please try again." };
  }
}

// ── article draft: create / edit / publish ──────────────────────────────────
//
// The generator itself (/api/promote/generate) is public and stateless — it
// only fetches metadata and asks Groq to draft an article; it writes
// nothing. These actions are the signed-in step that turns that (or a
// manually-written article, if the author skipped the DOI) into a real
// promote_showcase row: create a private draft, let the author edit it,
// attach media, then publish. Nothing here is reachable signed out —
// UnauthorizedError from lib/server/showcase.ts (via requireCurrentUser) maps
// to a "sign in" message; RLS is the actual enforcement underneath.

// Only `title` is required here — NOT headline/articleBody. The DOI path
// always has real content for both by the time it calls this (the
// generated article), but the manual path creates its draft row LAZILY, on
// first input, blank (see SubmitFlow.tsx's ensureDraft) specifically so the
// Media uploader has a real showcase_id to attach to before the person has
// typed a headline or a word of body text. Blocking on headline/body here
// would defeat that. setArticlePublished's own check (EmptyArticleError) is
// what actually stops an empty draft from becoming a public article — this
// only guards against a genuinely malformed call.
export async function createArticleDraftAction(
  input: CreateArticleInput
): Promise<ArticleDraftResult> {
  if (!input?.title?.trim()) {
    return { ok: false, error: "A title is required." };
  }

  try {
    const { id, slug } = await createArticleEntry(input);
    return { ok: true, id, slug };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to save a draft." };
    console.error("createArticleDraftAction failed", e);
    return { ok: false, error: "Couldn't save the draft. Please try again." };
  }
}

export async function updateArticleDraftAction(
  entryId: string,
  patch: ArticleDraftPatch
): Promise<SimpleActionResult> {
  if (!entryId) return { ok: false, error: "Missing article." };

  try {
    await updateArticleEntry(entryId, patch);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to edit this draft." };
    console.error("updateArticleDraftAction failed", e);
    return { ok: false, error: "Couldn't save your edits. Please try again." };
  }
}

/** Toggle an article's visibility. `publish: true` makes it live at
 *  /promote/[slug]; `false` takes it back down to draft-only. Revalidates
 *  the gallery and the article's own path either way so a stale cached
 *  render never outlives the flag. */
export async function setArticlePublishedAction(
  entryId: string,
  slug: string,
  publish: boolean
): Promise<SimpleActionResult> {
  if (!entryId || !slug) return { ok: false, error: "Missing article." };

  try {
    await setArticlePublished(entryId, publish);
    revalidatePath("/promote");
    revalidatePath(`/promote/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: publish ? "Sign in to publish." : "Sign in to unpublish." };
    }
    if (e instanceof EmptyArticleError) {
      return { ok: false, error: e.message };
    }
    console.error("setArticlePublishedAction failed", e);
    return { ok: false, error: "Couldn't update the article. Please try again." };
  }
}

// ── media attachments ────────────────────────────────────────────────────────

export async function addShowcaseMediaAction(form: FormData): Promise<MediaActionResult> {
  const showcaseId = form.get("showcaseId");
  const file = form.get("file");

  if (typeof showcaseId !== "string" || !showcaseId) {
    return { ok: false, error: "Missing article." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }

  try {
    const media = await addShowcaseMedia(showcaseId, file);
    return { ok: true, media };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to attach media." };
    const message = e instanceof Error ? e.message : "Couldn't attach that file. Please try again.";
    console.error("addShowcaseMediaAction failed", e);
    return { ok: false, error: message };
  }
}

export async function removeShowcaseMediaAction(
  showcaseId: string,
  mediaId: string
): Promise<SimpleActionResult> {
  if (!showcaseId || !mediaId) return { ok: false, error: "Missing attachment." };

  try {
    await removeShowcaseMedia(showcaseId, mediaId);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to remove media." };
    console.error("removeShowcaseMediaAction failed", e);
    return { ok: false, error: "Couldn't remove that file. Please try again." };
  }
}
