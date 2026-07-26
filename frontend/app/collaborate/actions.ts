"use server";

// Server Actions for the Collaborate board.
//
// NOTE — new pattern in this codebase. The existing write paths use /api/*
// routes; these are the first Server Actions. They're used here because the
// alternative (two API routes + client fetch + hand-rolled error mapping) is
// strictly more code for the same thing, and because the auth gate then lives
// server-side by construction: the client never sees a token and cannot supply
// an owner_id. If you'd rather stay uniform with /api/*, these two functions are
// the only things to move.
//
// Every action goes through lib/server/collab.ts, which goes through
// lib/auth.ts — never @supabase directly.

import { revalidatePath } from "next/cache";
import { UnauthorizedError } from "@/lib/auth";
import {
  createCollabPost,
  parseCollabPostInput,
  respondToCollabPost,
  type InterestType,
} from "@/lib/server/collab";

export type ActionResult = { ok: true; id: string } | { ok: false; error: string };

/** Create a post as the signed-in user. Rejects (401-equivalent) when signed
 *  out — the UI gate is a convenience, this is the actual enforcement. */
export async function createPostAction(input: unknown): Promise<ActionResult> {
  const parsed = parseCollabPostInput(input);
  if (!parsed) return { ok: false, error: "A title is required." };

  try {
    const id = await createCollabPost(parsed);
    revalidatePath("/collaborate");
    return { ok: true, id };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in to post." };
    }
    console.error("createPostAction failed", e);
    return { ok: false, error: "Couldn't create the post. Please try again." };
  }
}

/** Record interest in a post. */
export async function respondAction(input: {
  post_id: string;
  interest_type: InterestType;
  message?: string;
}): Promise<ActionResult> {
  if (!input?.post_id) return { ok: false, error: "Missing post." };

  try {
    const id = await respondToCollabPost({
      post_id: input.post_id,
      interest_type: input.interest_type,
      message: input.message ?? "",
    });
    revalidatePath("/collaborate");
    return { ok: true, id };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in to respond." };
    }
    console.error("respondAction failed", e);
    return { ok: false, error: "Couldn't send your request. Please try again." };
  }
}
