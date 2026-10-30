// lib/server/projectWorkspace/cfTasks.ts: the pure rules of the ColaboFest Tasks view:
// the three lists (Your team, SPARC, Southern Research), what each row shows, who may
// change what, and the progress numbers. No next/* imports, so `npm test` covers it.

import { FINALIST_TASKS } from "../../colabofestConfig.ts";

export type ListKey = "team" | "sparc" | "southern_research";

export const LIST_TITLE: Record<ListKey, string> = {
  team: "Your team",
  sparc: "SPARC",
  southern_research: "Southern Research",
};

/** The lead and the managers mark a TEAM item; only managers mark an item in the other lists. */
export function canMarkItem(role: string | null | undefined, list: ListKey): boolean {
  return list === "team" ? role === "lead" || role === "manager" : role === "manager";
}

/** Managers (the SPARC team) add, edit and delete items in all three lists. */
export function canEditList(role: string | null | undefined): boolean {
  return role === "manager";
}

export type CfItem = {
  id: string;
  label: string;
  status: string;
  position: number;
  list_key?: string | null;
  assignee_name?: string | null;
  due_date?: string | null;
};

export type CfRow = {
  /** The checklist item, or null for a finalist task whose item has not been created yet. */
  id: string | null;
  /** Set for the three finalist tasks (their description and key come from the config). */
  taskKey: string | null;
  label: string;
  description: string | null;
  done: boolean;
  owner: string | null;
  due: string | null;
};

export type CfList = { key: ListKey; title: string; rows: CfRow[]; done: number; total: number };

const isKey = (k: unknown): k is ListKey => k === "team" || k === "sparc" || k === "southern_research";

/** The three lists. "Your team" starts with the finalist tasks (for a finalist team, even
 *  before their items exist) and then any other team items. Rows keep their position order. */
export function buildCfLists(checklist: CfItem[], finalist: boolean): CfList[] {
  const items = [...checklist].sort((a, b) => a.position - b.position);
  const rowOf = (c: CfItem, taskKey: string | null, description: string | null): CfRow => ({
    id: c.id,
    taskKey,
    label: c.label,
    description,
    done: c.status === "ready",
    owner: c.assignee_name ?? null,
    due: c.due_date ?? null,
  });

  const team: CfRow[] = [];
  const usedIds = new Set<string>();
  if (finalist) {
    for (const t of FINALIST_TASKS) {
      const item = items.find((c) => c.label === t.label && (c.list_key ?? "team") === "team");
      if (item) usedIds.add(item.id);
      team.push(
        item
          ? rowOf(item, t.key, t.description)
          : { id: null, taskKey: t.key, label: t.label, description: t.description, done: false, owner: null, due: "2026-11-11" }
      );
    }
  }
  for (const c of items) {
    if ((c.list_key ?? "team") === "team" && !usedIds.has(c.id)) team.push(rowOf(c, null, null));
  }

  const other = (k: ListKey): CfRow[] => items.filter((c) => c.list_key === k).map((c) => rowOf(c, null, null));
  const lists: [ListKey, CfRow[]][] = [["team", team], ["sparc", other("sparc")], ["southern_research", other("southern_research")]];
  return lists.map(([key, rows]) => ({ key, title: LIST_TITLE[key], rows, done: rows.filter((r) => r.done).length, total: rows.length }));
}

/** Which lists the Tasks view shows: Your team and SPARC always (SPARC even when empty, so the
 *  SPARC team can add to it), Southern Research only when it has items, or for a manager. */
export function visibleCfLists(lists: CfList[], role: string | null | undefined): CfList[] {
  return lists.filter((l) => l.key !== "southern_research" || l.total > 0 || canEditList(role));
}

/** The Tasks tile: every finalist has it; another ColaboFest team only when a list has items
 *  (a manager always, so they can add the first). */
export function showTasksTile(lists: CfList[], finalist: boolean, role: string | null | undefined): boolean {
  return finalist || canEditList(role) || lists.some((l) => l.total > 0);
}

/** "Progress · 4 of 11 tasks done", over all three lists. */
export function progressTotals(lists: CfList[]): { done: number; total: number; percent: number } {
  const done = lists.reduce((n, l) => n + l.done, 0);
  const total = lists.reduce((n, l) => n + l.total, 0);
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** The call-to-action banner: a finalist until the finalist (team) tasks are all done. It counts
 *  only the finalist tasks, not the other lists. */
export function ctaBanner(args: { finalist: boolean; finalistDone: number; finalistTotal: number }): { title: string; sub: string } | null {
  if (!args.finalist || args.finalistTotal === 0 || args.finalistDone >= args.finalistTotal) return null;
  return {
    title: `Complete your ${args.finalistTotal} finalist tasks`,
    sub: `Due Nov 11 · ${args.finalistDone} of ${args.finalistTotal} done`,
  };
}

/** "2 of 5 done". */
export function barLine(done: number, total: number): string {
  return `${done} of ${total} done`;
}

/** The timeline: past dates greyed, the next date highlighted. */
export function timelineState(stages: readonly { from: string }[], today: string): ("past" | "next" | "later")[] {
  const next = stages.findIndex((s) => s.from > today);
  return stages.map((s, i) => (s.from <= today ? "past" : i === next ? "next" : "later"));
}

export function isCfListKey(k: unknown): k is ListKey {
  return isKey(k);
}
