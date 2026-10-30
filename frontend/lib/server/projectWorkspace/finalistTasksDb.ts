// lib/server/projectWorkspace/finalistTasksDb.ts: mark a ColaboFest finalist task done or
// not done. The status lives in the project's checklist_items (found by the task's
// label). Only the project lead and the managers may mark one (checked here against
// the caller's own project_members row; the checklist policies stay member-based).
// If the item is missing (a team made a finalist after the migration ran), it is
// created on the first mark.

import { requireCurrentUser } from "@/lib/auth";
import { FINALIST_DUE, FINALIST_TASKS } from "@/lib/colabofestConfig";
import { canMarkTask } from "@/lib/server/projectWorkspace/finalistTasks";

export type TaskResult = { status: "ok" } | { status: "forbidden"; error: string } | { status: "error"; error: string };

const ONLY = "Only the project lead or the SPARC team can mark a task done.";

export async function setFinalistTask(projectId: string, taskKey: string, done: boolean): Promise<TaskResult> {
  const { user, db } = await requireCurrentUser();
  const task = FINALIST_TASKS.find((t) => t.key === taskKey);
  if (!task) return { status: "error", error: "Unknown task." };

  const { data: me } = await db
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!canMarkTask((me as { role?: string } | null)?.role)) return { status: "forbidden", error: ONLY };

  const status = done ? "ready" : "not_yet";
  const { data: existing, error: findErr } = await db
    .from("checklist_items")
    .select("id")
    .eq("project_id", projectId)
    .eq("label", task.label)
    .limit(1);
  if (findErr) {
    console.error("setFinalistTask: lookup failed", findErr);
    return { status: "error", error: "Couldn't save that. Please try again." };
  }

  if (existing && existing.length > 0) {
    const { data, error } = await db
      .from("checklist_items")
      .update({ status, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("id", (existing[0] as { id: string }).id)
      .eq("project_id", projectId)
      .select("id");
    if (error || !data || data.length === 0) {
      if (error) console.error("setFinalistTask: update failed", error);
      return { status: "error", error: "Couldn't save that. Please try again." };
    }
    return { status: "ok" };
  }

  const position = 1001 + FINALIST_TASKS.findIndex((t) => t.key === taskKey);
  const { error } = await db.from("checklist_items").insert({
    id: globalThis.crypto.randomUUID(),
    project_id: projectId,
    label: task.label,
    status,
    position,
    list_key: "team",
    due_date: FINALIST_DUE.from,
    updated_by: user.id,
  });
  if (error) {
    console.error("setFinalistTask: insert failed", error);
    return { status: "error", error: "Couldn't save that. Please try again." };
  }
  return { status: "ok" };
}
