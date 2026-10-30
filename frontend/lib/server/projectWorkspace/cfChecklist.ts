// lib/server/projectWorkspace/cfChecklist.ts: the Tasks view of a ColaboFest project
// writes to the existing checklist (checklist_items, lists 'team' | 'sparc' |
// 'southern_research') through the existing functions in lib/server/projects.ts, but
// only after checking the caller's role here:
//   * the project lead and the managers (the SPARC team) mark a TEAM item done or not done;
//   * managers add, edit (title, owner, due date), mark done and delete items in ALL three lists.
// Members only read. (The checklist policies themselves are member-based; this is the rule
// for this page.)

import { requireCurrentUser } from "@/lib/auth";
import {
  addChecklistItem,
  deleteChecklistItem,
  setChecklistAssignee,
  setChecklistDueDate,
  updateChecklistItemLabel,
  updateChecklistItemStatus,
} from "@/lib/server/projects";
import { isListKey, type ListKey } from "@/lib/server/projectWorkspace/status";
import { canEditList, canMarkItem } from "@/lib/server/projectWorkspace/cfTasks";

export type CfResult = { status: "ok" } | { status: "forbidden"; error: string } | { status: "error"; error: string };

const NOT_ALLOWED = "Only the SPARC team can change this list.";

async function myRole(projectId: string): Promise<string | null> {
  const { user, db } = await requireCurrentUser();
  const { data } = await db.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
  return (data as { role?: string } | null)?.role ?? null;
}

async function listKeyOf(projectId: string, itemId: string): Promise<ListKey | null> {
  const { db } = await requireCurrentUser();
  const { data } = await db.from("checklist_items").select("list_key").eq("id", itemId).eq("project_id", projectId).maybeSingle();
  const k = (data as { list_key?: string } | null)?.list_key;
  return isListKey(k) ? k : null;
}

function fromWrite(r: { status: string; error?: string }): CfResult {
  return r.status === "ok" ? { status: "ok" } : { status: "error", error: r.error ?? "Couldn't save that." };
}

export async function cfSetItemDone(projectId: string, itemId: string, done: boolean): Promise<CfResult> {
  const [role, list] = await Promise.all([myRole(projectId), listKeyOf(projectId, itemId)]);
  if (!list) return { status: "error", error: "That task no longer exists." };
  if (!canMarkItem(role, list)) return { status: "forbidden", error: list === "team" ? "Only the project lead or the SPARC team can mark a task done." : NOT_ALLOWED };
  return fromWrite(await updateChecklistItemStatus(projectId, itemId, done ? "ready" : "not_yet"));
}

export async function cfAddItem(
  projectId: string,
  listKey: string,
  input: { label: string; due: string; assigneeId: string }
): Promise<CfResult> {
  const role = await myRole(projectId);
  if (!isListKey(listKey) || !canEditList(role)) return { status: "forbidden", error: NOT_ALLOWED };
  const added = await addChecklistItem(projectId, input.label, listKey);
  if (added.status !== "ok") return fromWrite(added as { status: string; error?: string });
  const id = (added as { item?: { id: string } }).item?.id;
  if (id && input.due) await setChecklistDueDate(projectId, id, input.due);
  if (id && input.assigneeId) await setChecklistAssignee(projectId, id, input.assigneeId);
  return { status: "ok" };
}

export async function cfEditItem(
  projectId: string,
  itemId: string,
  input: { label: string; due: string; assigneeId: string }
): Promise<CfResult> {
  if (!canEditList(await myRole(projectId))) return { status: "forbidden", error: NOT_ALLOWED };
  const a = await updateChecklistItemLabel(projectId, itemId, input.label);
  if (a.status !== "ok") return fromWrite(a as { status: string; error?: string });
  const b = await setChecklistDueDate(projectId, itemId, input.due || null);
  if (b.status !== "ok") return fromWrite(b);
  return fromWrite(await setChecklistAssignee(projectId, itemId, input.assigneeId || null));
}

export async function cfDeleteItem(projectId: string, itemId: string): Promise<CfResult> {
  if (!canEditList(await myRole(projectId))) return { status: "forbidden", error: NOT_ALLOWED };
  return fromWrite(await deleteChecklistItem(projectId, itemId));
}
