// lib/server/projectWorkspace/finalistTasks.ts: the pure rules of the ColaboFest
// finalist page: the three tasks and their status (read from checklist_items by
// label), the to-do banner, who may mark a task, the view names, the tile lines and
// the next date on the timeline. No imports from next/*, so `npm test` covers it.

import { COLABOFEST_STAGES, FINALIST_DUE, FINALIST_TASKS, type FinalistTaskKey } from "../../colabofestConfig.ts";

export type TaskRow = { key: FinalistTaskKey; label: string; description: string; done: boolean; itemId: string | null };

/** Each finalist task with its status: "ready" on the matching checklist item is Done,
 *  anything else (or no item yet) is To do. */
export function finalistTaskRows(checklist: { id: string; label: string; status: string }[]): TaskRow[] {
  return FINALIST_TASKS.map((t) => {
    const item = checklist.find((c) => c.label === t.label);
    return { key: t.key, label: t.label, description: t.description, done: item?.status === "ready", itemId: item?.id ?? null };
  });
}

export function tasksDone(rows: { done: boolean }[]): number {
  return rows.filter((r) => r.done).length;
}

/** The banner under the hero: finalists only; "Next step" until all three are done. */
export function finalistBanner(args: { finalist: boolean; done: number; total: number }): { kind: "todo" | "done"; text: string } | null {
  if (!args.finalist) return null;
  if (args.total > 0 && args.done >= args.total) return { kind: "done", text: "All tasks done. The SPARC team will contact you." };
  return { kind: "todo", text: `Next step: complete your ${args.total} finalist tasks by ${FINALIST_DUE.shown}` };
}

/** The project lead and the managers (the SPARC team) mark a task done. */
export function canMarkTask(role: string | null | undefined): boolean {
  return role === "lead" || role === "manager";
}

/** The Manage tile and view: the SPARC team (managers), and a site admin. */
export function canManageProject(role: string | null | undefined, isSiteAdmin = false): boolean {
  return role === "manager" || isSiteAdmin;
}

export const PROJECT_VIEWS = ["tasks", "files", "announcements", "team", "timeline", "manage"] as const;
export type ProjectView = (typeof PROJECT_VIEWS)[number];

/** The section the URL asks for (?view=, else the old ?tab= mapped), among the ones this
 *  viewer has; null is the project home. */
export function resolveProjectView(
  view: string | null | undefined,
  tab: string | null | undefined,
  available: readonly ProjectView[]
): ProjectView | null {
  const old: Record<string, string> = { updates: "announcements", announcements: "announcements", files: "files", team: "team", tasks: "tasks" };
  const want = view ?? (tab ? old[tab] : null) ?? null;
  return want && (available as readonly string[]).includes(want) ? (want as ProjectView) : null;
}

/** Inside Manage, which of the old sections is open (?section=). */
export const MANAGE_SECTIONS = ["announcements", "tasks", "files", "wiki", "team", "proposal"] as const;
export type ManageSection = (typeof MANAGE_SECTIONS)[number];

export function resolveManageSection(raw: string | null | undefined, hasProposal: boolean): ManageSection {
  const ok = MANAGE_SECTIONS.filter((s) => s !== "proposal" || hasProposal);
  return (ok as readonly string[]).includes(raw ?? "") ? (raw as ManageSection) : "announcements";
}

/** "2 of 3 done". */
export function tasksTileLine(done: number, total: number): string {
  return `${done} of ${total} done`;
}

/** The next point on the timeline after `today` ("Nov 11"), or null once the last has passed. */
export function nextTimelineDate(today: string): { label: string; shown: string } | null {
  const next = COLABOFEST_STAGES.find((s) => s.from > today);
  return next ? { label: next.label, shown: next.shown } : null;
}
