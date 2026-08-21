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
  deleteCollabPost,
  parseCollabPostInput,
  respondToCollabPost,
  type InterestType,
} from "@/lib/server/collab";
import { createResource, parseResourceInput } from "@/lib/server/collaborate";
import {
  approveMembership,
  joinCommunity,
  leaveCommunity,
} from "@/lib/server/communities";

export type ActionResult = { ok: true; id: string } | { ok: false; error: string };
export type SimpleActionResult = { ok: true } | { ok: false; error: string };

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

/** Record interest in a post. `contact` is the responder's own free-text answer
 *  to "How can they reach you?" — the only contact route the owner's inbox will
 *  show, and never their account email. */
export async function respondAction(input: {
  post_id: string;
  interest_type: InterestType;
  message?: string;
  contact?: string;
}): Promise<ActionResult> {
  if (!input?.post_id) return { ok: false, error: "Missing post." };

  try {
    const id = await respondToCollabPost({
      post_id: input.post_id,
      interest_type: input.interest_type,
      message: input.message ?? "",
      contact: input.contact ?? "",
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

/** Delete a post as its owner. The UI only shows this to whoever the server
 *  already told is the owner (post.is_owner) and requires a confirmation
 *  naming the response count first — but neither of those is the real gate.
 *  deleteCollabPost re-derives the caller from the session and the
 *  collab_posts_delete_own RLS policy enforces ownership again in Postgres,
 *  so a forged call for someone else's post_id deletes nothing. */
export async function deletePostAction(postId: string): Promise<SimpleActionResult> {
  if (!postId) return { ok: false, error: "Missing post." };

  try {
    await deleteCollabPost(postId);
    revalidatePath("/collaborate");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in to delete this post." };
    }
    console.error("deletePostAction failed", e);
    return { ok: false, error: "Couldn't delete the post. Please try again." };
  }
}

/** Register a lab resource ("Add what your lab can share"). Rejects when
 *  signed out, and when the input is missing name/category — the UI gate
 *  and this parse are convenience; RLS (can_post_to_community, when a
 *  community is set) and the owner-derives-from-session rule in
 *  createResource are the real enforcement. */
export async function createResourceAction(input: unknown): Promise<ActionResult> {
  const parsed = parseResourceInput(input);
  if (!parsed) return { ok: false, error: "A name and category are required." };

  try {
    const id = await createResource(parsed);
    revalidatePath("/collaborate");
    return { ok: true, id };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in to share a resource." };
    }
    console.error("createResourceAction failed", e);
    return { ok: false, error: "Couldn't save that. Please try again." };
  }
}

/** Join an open community, or request to join a closed one — which one
 *  happens is decided by community_members_self_insert (RLS), not here; see
 *  lib/server/communities.ts:joinCommunity. `isOpen` just carries the
 *  community row the caller already has on screen through to the insert. */
export async function joinCommunityAction(
  communityId: string,
  isOpen: boolean
): Promise<SimpleActionResult> {
  if (!communityId) return { ok: false, error: "Missing community." };

  try {
    await joinCommunity(communityId, isOpen);
    revalidatePath("/collaborate");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in to join." };
    }
    console.error("joinCommunityAction failed", e);
    return { ok: false, error: "Couldn't do that. Please try again." };
  }
}

/** Leave a community, or withdraw a pending request — same action either
 *  way (community_members_self_delete, RLS). */
export async function leaveCommunityAction(communityId: string): Promise<SimpleActionResult> {
  if (!communityId) return { ok: false, error: "Missing community." };

  try {
    await leaveCommunity(communityId);
    revalidatePath("/collaborate");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("leaveCommunityAction failed", e);
    return { ok: false, error: "Couldn't do that. Please try again." };
  }
}

/** Approve a pending join request. Lead-only —
 *  community_members_lead_approves (RLS) is the real gate; a non-lead's
 *  update matches zero rows and this still reports success from the DB's
 *  point of view, so the UI only ever shows this action to someone the
 *  server already told is a lead (see the pending-requests read). */
export async function approveMembershipAction(memberRowId: string): Promise<SimpleActionResult> {
  if (!memberRowId) return { ok: false, error: "Missing request." };

  try {
    await approveMembership(memberRowId);
    revalidatePath("/collaborate");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("approveMembershipAction failed", e);
    return { ok: false, error: "Couldn't approve that. Please try again." };
  }
}
