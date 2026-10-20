"use server";

// Server Actions for the owner controls and team panel on /pages/[slug].
// Thin: the client never supplies who it is; lib/server/pages/* re-derives the
// caller from the session and RLS is the gate.

import { revalidatePath } from "next/cache";
import { UnauthorizedError } from "@/lib/auth";
import { deletePage, setPageRefreshEnabled, setPageVisibility } from "@/lib/server/pages/pageAdmin";
import { addPageMember, removePageMember, type PageMemberRole } from "@/lib/server/pages/pageMembers";
import type { PageVisibility } from "@/lib/server/pages/pageViewHelpers";

export type ActionResult = { ok: true; note?: string } | { ok: false; error: string };

const SIGN_IN = "Sign in to do that.";

function fail(e: unknown, what: string): ActionResult {
  if (e instanceof UnauthorizedError) return { ok: false, error: SIGN_IN };
  console.error(`${what} failed`, e);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function setVisibilityAction(pageId: string, slug: string, visibility: PageVisibility): Promise<ActionResult> {
  try {
    const r = await setPageVisibility(pageId, visibility);
    if (r.status !== "ok") return { ok: false, error: r.error };
    revalidatePath(`/pages/${slug}`);
    revalidatePath("/pages");
    return { ok: true };
  } catch (e) {
    return fail(e, "setVisibilityAction");
  }
}

export async function setRefreshEnabledAction(pageId: string, slug: string, enabled: boolean): Promise<ActionResult> {
  try {
    const r = await setPageRefreshEnabled(pageId, enabled);
    if (r.status !== "ok") return { ok: false, error: r.error };
    revalidatePath(`/pages/${slug}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "setRefreshEnabledAction");
  }
}

export async function deletePageAction(pageId: string): Promise<ActionResult> {
  try {
    const r = await deletePage(pageId);
    if (r.status !== "ok") return { ok: false, error: r.error };
    revalidatePath("/pages");
    return { ok: true };
  } catch (e) {
    return fail(e, "deletePageAction");
  }
}

export async function addMemberAction(
  pageId: string,
  slug: string,
  email: string,
  role: PageMemberRole
): Promise<ActionResult> {
  if (!email?.trim()) return { ok: false, error: "An email address is required." };
  try {
    const r = await addPageMember(pageId, email, role);
    if (r.status !== "ok") return { ok: false, error: r.error };
    revalidatePath(`/pages/${slug}`);
    return {
      ok: true,
      note: r.active
        ? undefined
        : "Added. They only get access while the page is set to Team.",
    };
  } catch (e) {
    return fail(e, "addMemberAction");
  }
}

export async function removeMemberAction(pageId: string, slug: string, userId: string): Promise<ActionResult> {
  try {
    const r = await removePageMember(pageId, userId);
    if (r.status !== "ok") return { ok: false, error: r.error };
    revalidatePath(`/pages/${slug}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "removeMemberAction");
  }
}
