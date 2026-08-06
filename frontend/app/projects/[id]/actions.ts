"use server";

// Server Actions for the project detail page's Team and Proposal sections.
// Same pattern as app/projects/actions.ts and app/collaborate/actions.ts:
// the client never supplies an id it's compared against for permission —
// lib/server/projects.ts re-derives the caller from the session every time.

import { revalidatePath } from "next/cache";
import { UnauthorizedError } from "@/lib/auth";
import {
  addProjectMember,
  deleteProject,
  promoteProjectMember,
  removeProjectMember,
  stepDownFromLead,
  submitProposal,
  upsertProposal,
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
