"use server";

// Server Action for the Promote submit form. Same pattern as
// app/collaborate/actions.ts.
//
// Takes FormData rather than a plain object because of the optional image: a
// File can be sent through a Server Action inside FormData, but not as part of a
// JSON-serialisable payload.
//
// Goes through lib/server/showcase.ts -> lib/auth.ts. Never @supabase directly.

import { revalidatePath } from "next/cache";
import { UnauthorizedError } from "@/lib/auth";
import {
  createShowcaseEntry,
  deleteShowcaseEntry,
  parseShowcaseInput,
} from "@/lib/server/showcase";

export type SubmitResult = { ok: true; id: string } | { ok: false; error: string };
export type SimpleActionResult = { ok: true } | { ok: false; error: string };

export async function submitShowcaseAction(form: FormData): Promise<SubmitResult> {
  const tagsRaw = form.get("tags");
  const parsed = parseShowcaseInput({
    type: form.get("type"),
    title: form.get("title"),
    description: form.get("description"),
    authors: form.get("authors"),
    link: form.get("link"),
    tags: typeof tagsRaw === "string" && tagsRaw ? JSON.parse(tagsRaw) : [],
  });

  if (!parsed) return { ok: false, error: "A title and a type are required." };

  const file = form.get("image");
  const image = file instanceof File && file.size > 0 ? file : null;

  try {
    const id = await createShowcaseEntry(parsed, image);
    revalidatePath("/promote");
    return { ok: true, id };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to submit." };
    console.error("submitShowcaseAction failed", e);
    return { ok: false, error: "Couldn't submit your entry. Please try again." };
  }
}

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
