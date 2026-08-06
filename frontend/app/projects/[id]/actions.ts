"use server";

// Server Actions for the project detail page's Team and Proposal sections.
// Same pattern as app/projects/actions.ts and app/collaborate/actions.ts:
// the client never supplies an id it's compared against for permission —
// lib/server/projects.ts re-derives the caller from the session every time.

import { revalidatePath } from "next/cache";
import { UnauthorizedError } from "@/lib/auth";
import {
  addChecklistItem,
  addProjectMember,
  deleteChecklistItem,
  deleteProject,
  moveChecklistItem,
  promoteProjectMember,
  removeProjectMember,
  setSharedFolder,
  stepDownFromLead,
  submitProposal,
  updateChecklistItemLabel,
  updateChecklistItemStatus,
  upsertProposal,
  type ChecklistItem,
  type ChecklistStatus,
  type SharedFolder,
} from "@/lib/server/projects";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Add a member by email. lib/server/projects.ts is the real gate (RLS +
 *  an explicit lead check) — this action just translates its result. */
export async function addMemberAction(projectId: string, email: string): Promise<ActionResult> {
  if (!projectId) return { ok: false, error: "Missing project." };
  if (!email?.trim()) return { ok: false, error: "An email address is required." };

  try {
    const result = await addProjectMember(projectId, email);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to add members." };
    console.error("addMemberAction failed", e);
    return { ok: false, error: "Couldn't add that member. Please try again." };
  }
}

/** Remove a member. Confirmation ("are you sure?") lives in the UI —
 *  lib/server/projects.ts (backed by RLS) is what actually blocks removing
 *  a lead at all, not this action. */
export async function removeMemberAction(
  projectId: string,
  memberId: string
): Promise<ActionResult> {
  if (!projectId || !memberId) return { ok: false, error: "Missing member." };

  try {
    const result = await removeProjectMember(projectId, memberId);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to remove members." };
    console.error("removeMemberAction failed", e);
    return { ok: false, error: "Couldn't remove that member. Please try again." };
  }
}

/** Promote a member to lead. Any lead may call this, on any (linked)
 *  member — lib/server/projects.ts is the real gate. */
export async function promoteMemberAction(
  projectId: string,
  memberId: string
): Promise<ActionResult> {
  if (!projectId || !memberId) return { ok: false, error: "Missing member." };

  try {
    const result = await promoteProjectMember(projectId, memberId);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to promote members." };
    console.error("promoteMemberAction failed", e);
    return { ok: false, error: "Couldn't promote that member. Please try again." };
  }
}

/** Step down from lead to member — always targets the CALLER'S OWN row.
 *  lib/server/projects.ts is what actually blocks the last lead stepping
 *  down (via a database trigger, not this action). */
export async function stepDownAction(projectId: string): Promise<ActionResult> {
  if (!projectId) return { ok: false, error: "Missing project." };

  try {
    const result = await stepDownFromLead(projectId);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to step down." };
    console.error("stepDownAction failed", e);
    return { ok: false, error: "Couldn't step down. Please try again." };
  }
}

/** Save the proposal draft (title/category/summary + an optional file).
 *  FormData, not a plain object — this is the one write here that carries a
 *  File, and Server Actions accept FormData natively for that. */
export async function saveProposalAction(projectId: string, formData: FormData): Promise<ActionResult> {
  if (!projectId) return { ok: false, error: "Missing project." };

  const title = String(formData.get("title") ?? "");
  const category = String(formData.get("category") ?? "");
  const summary = String(formData.get("summary") ?? "");
  const fileEntry = formData.get("file");
  const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;

  try {
    const result = await upsertProposal(projectId, { title, category, summary }, file);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to edit the proposal." };
    console.error("saveProposalAction failed", e);
    return { ok: false, error: "Couldn't save the proposal. Please try again." };
  }
}

/** Submit the proposal. lib/server/projects.ts enforces BOTH real rules
 *  (lead-only, before the deadline) — this action only translates the
 *  result, it does not re-check either itself. */
export async function submitProposalAction(projectId: string): Promise<ActionResult> {
  if (!projectId) return { ok: false, error: "Missing project." };

  try {
    const result = await submitProposal(projectId);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to submit the proposal." };
    console.error("submitProposalAction failed", e);
    return { ok: false, error: "Couldn't submit the proposal. Please try again." };
  }
}

/** Delete the project. Confirmation (naming what's destroyed) lives in the
 *  UI — lib/server/projects.ts's deleteProject() is what actually gates
 *  this to the CREATOR (not any lead), via RLS ("Projects: lead delete",
 *  now backed by is_project_creator()), not this action. */
export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  if (!projectId) return { ok: false, error: "Missing project." };

  try {
    const result = await deleteProject(projectId);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath("/projects");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to delete this project." };
    console.error("deleteProjectAction failed", e);
    return { ok: false, error: "Couldn't delete the project. Please try again." };
  }
}

// ── checklist ──────────────────────────────────────────────────────────────
// ANY member may call any of these — lib/server/projects.ts's checklist
// functions have no lead check to translate; RLS ("Checklist items: member
// *") is the whole gate.

export type AddChecklistItemActionResult =
  | { ok: true; item: ChecklistItem }
  | { ok: false; error: string };

export async function addChecklistItemAction(
  projectId: string,
  label: string
): Promise<AddChecklistItemActionResult> {
  if (!projectId) return { ok: false, error: "Missing project." };

  try {
    const result = await addChecklistItem(projectId, label);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, item: result.item };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to add checklist items." };
    console.error("addChecklistItemAction failed", e);
    return { ok: false, error: "Couldn't add that item. Please try again." };
  }
}

/** Status changes are meant to feel instant — the caller (ChecklistSection)
 *  updates its own state optimistically BEFORE this resolves and only
 *  reverts if it comes back { ok: false }. That revert is what makes a
 *  failure visible rather than silently lost — see STRUCTURE.md's own
 *  requirement. */
export async function updateChecklistStatusAction(
  projectId: string,
  itemId: string,
  status: ChecklistStatus
): Promise<ActionResult> {
  if (!projectId || !itemId) return { ok: false, error: "Missing item." };

  try {
    const result = await updateChecklistItemStatus(projectId, itemId, status);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to update the checklist." };
    console.error("updateChecklistStatusAction failed", e);
    return { ok: false, error: "Couldn't update that item. Please try again." };
  }
}

export async function updateChecklistLabelAction(
  projectId: string,
  itemId: string,
  label: string
): Promise<ActionResult> {
  if (!projectId || !itemId) return { ok: false, error: "Missing item." };

  try {
    const result = await updateChecklistItemLabel(projectId, itemId, label);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to edit the checklist." };
    console.error("updateChecklistLabelAction failed", e);
    return { ok: false, error: "Couldn't rename that item. Please try again." };
  }
}

export async function moveChecklistItemAction(
  projectId: string,
  itemId: string,
  direction: "up" | "down"
): Promise<ActionResult> {
  if (!projectId || !itemId) return { ok: false, error: "Missing item." };

  try {
    const result = await moveChecklistItem(projectId, itemId, direction);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to reorder the checklist." };
    console.error("moveChecklistItemAction failed", e);
    return { ok: false, error: "Couldn't reorder the checklist. Please try again." };
  }
}

/** Delete a checklist item. Confirmation lives in the UI. */
export async function deleteChecklistItemAction(
  projectId: string,
  itemId: string
): Promise<ActionResult> {
  if (!projectId || !itemId) return { ok: false, error: "Missing item." };

  try {
    const result = await deleteChecklistItem(projectId, itemId);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to edit the checklist." };
    console.error("deleteChecklistItemAction failed", e);
    return { ok: false, error: "Couldn't delete that item. Please try again." };
  }
}

// ── shared folder ────────────────────────────────────────────────────────────

export type SetSharedFolderActionResult =
  | { ok: true; shared_folder: SharedFolder }
  | { ok: false; error: string };

/** Set or change the shared folder link. ANY member — lib/server/projects.ts
 *  validates the URL server-side (http/https only, rejecting a
 *  javascript: URL regardless of what the form's own <input type="url">
 *  would have caught); that check is the real gate, not this action. */
export async function setSharedFolderAction(
  projectId: string,
  url: string
): Promise<SetSharedFolderActionResult> {
  if (!projectId) return { ok: false, error: "Missing project." };

  try {
    const result = await setSharedFolder(projectId, url);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, shared_folder: result.shared_folder };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to set the shared folder." };
    console.error("setSharedFolderAction failed", e);
    return { ok: false, error: "Couldn't save the folder link. Please try again." };
  }
}
