"use server";

// Server Actions for saving/removing an Explore item INTO a project's
// shared Resources. Imported both from ItemCard.tsx (used on /explore,
// /explore/[topic], AND the project page's own Resources section) — one
// pair of actions, not duplicated per call site.
//
// The client never supplies user_id — lib/server/projectResources.ts
// re-derives the caller from the session every time, same pattern as
// every other Server Action in this codebase.

import { revalidatePath } from "next/cache";
import { UnauthorizedError } from "@/lib/auth";
import { removeFromProject, saveToProject } from "@/lib/server/projectResources";
import type { ExploreItem } from "@/types/explore";

export type SaveActionResult = { ok: true } | { ok: false; error: string };

export async function saveToProjectAction(
  projectId: string,
  item: ExploreItem
): Promise<SaveActionResult> {
  if (!projectId) return { ok: false, error: "Missing project." };
  if (!item?.id) return { ok: false, error: "Missing item." };

  try {
    const result = await saveToProject(projectId, item);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to save items." };
    console.error("saveToProjectAction failed", e);
    return { ok: false, error: "Couldn't save that item. Please try again." };
  }
}

export async function removeFromProjectAction(
  projectId: string,
  itemId: string
): Promise<SaveActionResult> {
  if (!projectId || !itemId) return { ok: false, error: "Missing item." };

  try {
    const result = await removeFromProject(projectId, itemId);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to remove items." };
    console.error("removeFromProjectAction failed", e);
    return { ok: false, error: "Couldn't remove that item. Please try again." };
  }
}
