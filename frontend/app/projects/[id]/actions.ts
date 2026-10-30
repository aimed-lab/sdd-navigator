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
  setChecklistAssignee,
  setChecklistDueDate,
  setGithubUrl,
  setMemberRole,
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
import { createProjectPage } from "@/lib/server/pages/projectPages";
import {
  deleteProjectUpdate,
  editAnnouncement,
  postProjectUpdate,
  setAnnouncementPinned,
  setHelpResolved,
} from "@/lib/server/projectWorkspace/updates";
import { addReply, createThread, deleteReply, deleteThread } from "@/lib/server/projectWorkspace/discussions";
import { dismissWelcome } from "@/lib/server/projectWorkspace/welcome";
import { setFinalist, setMemberAffiliation } from "@/lib/server/projectWorkspace/colabofestOps";
import { requireCurrentUser } from "@/lib/auth";
import { setFinalistTask } from "@/lib/server/projectWorkspace/finalistTasksDb";
import { cfAddItem, cfDeleteItem, cfEditItem, cfSetItemDone } from "@/lib/server/projectWorkspace/cfChecklist";
import type { ListKey } from "@/lib/server/projectWorkspace/status";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Add a member by email. lib/server/projects.ts is the real gate (RLS +
 *  an explicit lead check) — this action just translates its result. */
export async function addMemberAction(
  projectId: string,
  email: string,
  role: "member" | "manager" = "member"
): Promise<ActionResult> {
  if (!projectId) return { ok: false, error: "Missing project." };
  if (!email?.trim()) return { ok: false, error: "An email address is required." };

  try {
    const result = await addProjectMember(projectId, email, role === "manager" ? "manager" : "member");
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
  | { ok: true; item: ChecklistItem; classificationFailed: boolean }
  | { ok: false; error: string };

export async function addChecklistItemAction(
  projectId: string,
  label: string,
  listKey: ListKey = "team"
): Promise<AddChecklistItemActionResult> {
  if (!projectId) return { ok: false, error: "Missing project." };

  try {
    const result = await addChecklistItem(projectId, label, listKey);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, item: result.item, classificationFailed: result.classificationFailed };
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

// A rename re-classifies the item (see updateChecklistItemLabel's own
// docstring) — matched_capabilities comes back so the client can update
// which action (Ask for help / Find a service provider) it shows without a
// full page reload.
export type UpdateChecklistLabelActionResult =
  | { ok: true; matched_capabilities: string[]; classificationFailed: boolean }
  | { ok: false; error: string };

export async function updateChecklistLabelAction(
  projectId: string,
  itemId: string,
  label: string
): Promise<UpdateChecklistLabelActionResult> {
  if (!projectId || !itemId) return { ok: false, error: "Missing item." };

  try {
    const result = await updateChecklistItemLabel(projectId, itemId, label);
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      matched_capabilities: result.matched_capabilities,
      classificationFailed: result.classificationFailed,
    };
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

// ── wiki pages in the project ────────────────────────────────────────────────

export type CreateProjectWikiPageResult = { ok: true; slug: string } | { ok: false; error: string };

/** Add a wiki page to the project (optionally under a parent page). The page is
 *  researched from its title, which takes about a minute. Membership is checked
 *  in lib/server/pages/projectPages.ts and again by the database. */
export async function createProjectWikiPageAction(
  projectId: string,
  title: string,
  parentPageId?: string | null
): Promise<CreateProjectWikiPageResult> {
  if (!projectId) return { ok: false, error: "Missing project." };
  try {
    const result = await createProjectPage({ projectId, title, parentPageId });
    if (result.status !== "ok") return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, slug: result.slug };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to add a wiki page." };
    console.error("createProjectWikiPageAction failed", e);
    return { ok: false, error: "Couldn't create the wiki page. Please try again." };
  }
}

// ── owners and due dates ─────────────────────────────────────────────────────

export async function setChecklistAssigneeAction(projectId: string, itemId: string, assigneeId: string | null): Promise<ActionResult> {
  if (!projectId || !itemId) return { ok: false, error: "Missing item." };
  try {
    const r = await setChecklistAssignee(projectId, itemId, assigneeId || null);
    if (r.status !== "ok") return { ok: false, error: r.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to change the owner." };
    console.error("setChecklistAssigneeAction failed", e);
    return { ok: false, error: "Couldn't change the owner. Please try again." };
  }
}

export async function setChecklistDueDateAction(projectId: string, itemId: string, due: string): Promise<ActionResult> {
  if (!projectId || !itemId) return { ok: false, error: "Missing item." };
  try {
    const r = await setChecklistDueDate(projectId, itemId, due || null);
    if (r.status !== "ok") return { ok: false, error: r.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to change the due date." };
    console.error("setChecklistDueDateAction failed", e);
    return { ok: false, error: "Couldn't change the due date. Please try again." };
  }
}

// ── GitHub link and roles ────────────────────────────────────────────────────

export async function setGithubUrlAction(projectId: string, url: string): Promise<{ ok: true; github_url: string | null } | { ok: false; error: string }> {
  if (!projectId) return { ok: false, error: "Missing project." };
  try {
    const r = await setGithubUrl(projectId, url);
    if (r.status !== "ok") return { ok: false, error: r.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, github_url: r.github_url };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to save the link." };
    console.error("setGithubUrlAction failed", e);
    return { ok: false, error: "Couldn't save the link. Please try again." };
  }
}

export async function setMemberRoleAction(projectId: string, memberId: string, role: "member" | "manager"): Promise<ActionResult> {
  if (!projectId || !memberId) return { ok: false, error: "Missing member." };
  try {
    const r = await setMemberRole(projectId, memberId, role);
    if (r.status !== "ok") return { ok: false, error: r.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to change roles." };
    console.error("setMemberRoleAction failed", e);
    return { ok: false, error: "Couldn't change that role. Please try again." };
  }
}

// ── updates ──────────────────────────────────────────────────────────────────

export async function postUpdateAction(projectId: string, kind: string, body: string): Promise<ActionResult> {
  if (!projectId) return { ok: false, error: "Missing project." };
  try {
    const r = await postProjectUpdate(projectId, kind, body);
    if (r.status !== "ok") return { ok: false, error: r.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to post." };
    console.error("postUpdateAction failed", e);
    return { ok: false, error: "Couldn't post that. Please try again." };
  }
}

export async function deleteUpdateAction(projectId: string, updateId: string): Promise<ActionResult> {
  if (!projectId || !updateId) return { ok: false, error: "Missing post." };
  try {
    const r = await deleteProjectUpdate(projectId, updateId);
    if (r.status !== "ok") return { ok: false, error: r.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to delete." };
    console.error("deleteUpdateAction failed", e);
    return { ok: false, error: "Couldn't delete that post. Please try again." };
  }
}

export async function resolveHelpAction(projectId: string, updateId: string, resolved: boolean): Promise<ActionResult> {
  if (!projectId || !updateId) return { ok: false, error: "Missing post." };
  try {
    const r = await setHelpResolved(projectId, updateId, resolved);
    if (r.status !== "ok") return { ok: false, error: r.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to do that." };
    console.error("resolveHelpAction failed", e);
    return { ok: false, error: "Couldn't update that post. Please try again." };
  }
}

// ── announcements (edit, pin), discussions, welcome, finalist, affiliation ───

type Written = { status: string; error?: string };

/** Run a write, turn its result into an ActionResult, refresh the project page. */
async function run(projectId: string, what: string, fn: () => Promise<Written>): Promise<ActionResult> {
  if (!projectId) return { ok: false, error: "Missing project." };
  try {
    const r = await fn();
    if (r.status !== "ok") return { ok: false, error: r.error ?? "Something went wrong." };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to do that." };
    console.error(`${what} failed`, e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function editAnnouncementAction(projectId: string, updateId: string, body: string): Promise<ActionResult> {
  if (!updateId) return { ok: false, error: "Missing post." };
  return run(projectId, "editAnnouncementAction", () => editAnnouncement(projectId, updateId, body));
}

export async function pinAnnouncementAction(projectId: string, updateId: string, pinned: boolean): Promise<ActionResult> {
  if (!updateId) return { ok: false, error: "Missing post." };
  return run(projectId, "pinAnnouncementAction", () => setAnnouncementPinned(projectId, updateId, pinned === true));
}

export async function createThreadAction(
  projectId: string,
  title: string,
  body: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!projectId) return { ok: false, error: "Missing project." };
  try {
    const r = await createThread(projectId, title, body);
    if (r.status !== "ok") return { ok: false, error: r.error };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, id: r.id ?? "" };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to start a discussion." };
    console.error("createThreadAction failed", e);
    return { ok: false, error: "Couldn't start the discussion. Please try again." };
  }
}

export async function replyAction(projectId: string, threadId: string, body: string): Promise<ActionResult> {
  if (!threadId) return { ok: false, error: "Missing discussion." };
  return run(projectId, "replyAction", () => addReply(projectId, threadId, body));
}

export async function deleteThreadAction(projectId: string, threadId: string): Promise<ActionResult> {
  if (!threadId) return { ok: false, error: "Missing discussion." };
  return run(projectId, "deleteThreadAction", () => deleteThread(projectId, threadId));
}

export async function deleteReplyAction(projectId: string, replyId: string): Promise<ActionResult> {
  if (!replyId) return { ok: false, error: "Missing reply." };
  return run(projectId, "deleteReplyAction", () => deleteReply(projectId, replyId));
}

/** Hide the Welcome card for the signed-in person on this project. */
export async function dismissWelcomeAction(projectId: string): Promise<ActionResult> {
  if (!projectId) return { ok: false, error: "Missing project." };
  try {
    const { user } = await requireCurrentUser();
    const r = await dismissWelcome(projectId, user.id);
    if (!r.ok) return r;
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to do that." };
    console.error("dismissWelcomeAction failed", e);
    return { ok: false, error: "Couldn't hide that. Please try again." };
  }
}

export async function setFinalistAction(projectId: string, finalist: boolean): Promise<ActionResult> {
  return run(projectId, "setFinalistAction", () => setFinalist(projectId, finalist === true));
}

export async function setAffiliationAction(projectId: string, memberId: string, affiliation: string | null): Promise<ActionResult> {
  if (!memberId) return { ok: false, error: "Missing member." };
  return run(projectId, "setAffiliationAction", () => setMemberAffiliation(projectId, memberId, affiliation));
}

/** Mark a ColaboFest finalist task done or not done: the project lead and the SPARC team only. */
export async function setFinalistTaskAction(projectId: string, taskKey: string, done: boolean): Promise<ActionResult> {
  return run(projectId, "setFinalistTaskAction", () => setFinalistTask(projectId, taskKey, done === true));
}

// ── the ColaboFest Tasks view (roles are checked in lib/server/projectWorkspace/cfChecklist.ts) ──

export type CfItemInput = { label: string; due: string; assigneeId: string };

export async function cfSetItemDoneAction(projectId: string, itemId: string, done: boolean): Promise<ActionResult> {
  if (!itemId) return { ok: false, error: "Missing task." };
  return run(projectId, "cfSetItemDoneAction", () => cfSetItemDone(projectId, itemId, done === true));
}

export async function cfAddItemAction(projectId: string, listKey: string, input: CfItemInput): Promise<ActionResult> {
  return run(projectId, "cfAddItemAction", () => cfAddItem(projectId, listKey, input));
}

export async function cfEditItemAction(projectId: string, itemId: string, input: CfItemInput): Promise<ActionResult> {
  if (!itemId) return { ok: false, error: "Missing task." };
  return run(projectId, "cfEditItemAction", () => cfEditItem(projectId, itemId, input));
}

export async function cfDeleteItemAction(projectId: string, itemId: string): Promise<ActionResult> {
  if (!itemId) return { ok: false, error: "Missing task." };
  return run(projectId, "cfDeleteItemAction", () => cfDeleteItem(projectId, itemId));
}
