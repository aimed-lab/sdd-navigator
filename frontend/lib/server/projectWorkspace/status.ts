// Project status rules, shared by the workspace, the ColaboFest program page and
// the assistant: the three checklists, overdue items, what to do next, who may
// post what on the Updates tab, and a project's status pill. Pure: no I/O and no
// next/* imports, so `npm test` covers it.

import { COLABOFEST_PROGRAM } from "../../projectTypes.ts";

// ── roles ────────────────────────────────────────────────────────────────────

export type ProjectRole = "lead" | "manager" | "member";

export function isStaffRole(role: string | null | undefined): boolean {
  return role === "lead" || role === "manager";
}

export type UpdateKind = "update" | "announcement" | "help";
export const UPDATE_KINDS: readonly UpdateKind[] = ["update", "announcement", "help"];

/** Which kinds of post a person may write: an announcement needs a lead or
 *  manager; anyone on the project may ask for help. (The plain "update" kind is
 *  no longer postable: 2026-10-31_project_announcements_discussions.sql.) */
export function postableKinds(role: string | null | undefined): UpdateKind[] {
  return isStaffRole(role) ? ["announcement", "help"] : ["help"];
}

export function canPostKind(role: string | null | undefined, kind: string): boolean {
  return (postableKinds(role) as string[]).includes(kind);
}

/** Only a lead or manager marks a help post resolved. */
export function canResolve(role: string | null | undefined): boolean {
  return isStaffRole(role);
}

/** The author, a lead or a manager may delete a post. */
export function canDeleteUpdate(args: { role: string | null | undefined; isAuthor: boolean }): boolean {
  return args.isAuthor || isStaffRole(args.role);
}

/** Roles a lead may give someone on the Team tab. */
export function assignableRoles(): ProjectRole[] {
  return ["member", "manager"];
}

export const ROLE_LABEL: Record<ProjectRole, string> = { lead: "Lead", manager: "SPARC team", member: "Member" };

// ── checklist lists ──────────────────────────────────────────────────────────

export type ListKey = "team" | "sparc" | "southern_research";
export const LIST_KEYS: readonly ListKey[] = ["sparc", "southern_research", "team"];

export const LIST_LABEL: Record<ListKey, string> = {
  team: "Team tasks",
  sparc: "UAB SPARC checklist",
  southern_research: "Southern Research checklist",
};

export function isListKey(v: unknown): v is ListKey {
  return v === "team" || v === "sparc" || v === "southern_research";
}

/** The lists a project shows, in order. The two partner checklists exist only for
 *  challenge projects; Team tasks always. */
export function visibleLists(isChallenge: boolean): ListKey[] {
  return isChallenge ? ["sparc", "southern_research", "team"] : ["team"];
}

export type TaskItem = {
  label: string;
  status: string;
  position: number;
  list_key?: string | null;
  due_date?: string | null;
};

/** Today as YYYY-MM-DD in the program's time zone (Chicago), so "overdue" flips at
 *  local midnight. */
export function todayIso(now: Date = new Date(), timeZone = "America/Chicago"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Due date in the past and not ready yet. */
export function isOverdue(item: Pick<TaskItem, "status" | "due_date">, today: string): boolean {
  return !!item.due_date && item.status !== "ready" && item.due_date < today;
}

export function overdueCount(items: Pick<TaskItem, "status" | "due_date">[], today: string): number {
  return items.filter((i) => isOverdue(i, today)).length;
}

export function listProgress(items: Pick<TaskItem, "status">[]): { ready: number; total: number } {
  return { ready: items.filter((i) => i.status === "ready").length, total: items.length };
}

/** Progress of each list (a list with no items has 0 of 0). */
export function progressByList(items: Pick<TaskItem, "status" | "list_key">[]): Record<ListKey, { ready: number; total: number }> {
  const out: Record<ListKey, { ready: number; total: number }> = {
    team: { ready: 0, total: 0 },
    sparc: { ready: 0, total: 0 },
    southern_research: { ready: 0, total: 0 },
  };
  for (const i of items) {
    const k: ListKey = isListKey(i.list_key) ? i.list_key : "team";
    out[k].total += 1;
    if (i.status === "ready") out[k].ready += 1;
  }
  return out;
}

/** Items still to do, in the order to show them: overdue first (earliest due
 *  date first), then the rest with a due date (soonest first), then items with no
 *  due date (in progress before not yet, then by position). Ready items are left
 *  out. */
export function nextUp<T extends TaskItem>(items: T[], today: string, limit = 4): T[] {
  const group = (i: T) => (isOverdue(i, today) ? 0 : i.due_date ? 1 : 2);
  const statusRank = (s: string) => (s === "in_progress" ? 0 : 1);
  return items
    .filter((i) => i.status !== "ready")
    .slice()
    .sort((a, b) => {
      const g = group(a) - group(b);
      if (g !== 0) return g;
      if (group(a) < 2) {
        const d = (a.due_date ?? "").localeCompare(b.due_date ?? "");
        if (d !== 0) return d;
      }
      return statusRank(a.status) - statusRank(b.status) || a.position - b.position;
    })
    .slice(0, limit);
}

export function dueLabel(due: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due ?? "");
  if (!m) return null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mo = months[Number(m[2]) - 1];
  return mo ? `${mo} ${Number(m[3])}` : null;
}

/** A due date typed in the form: empty clears it; otherwise it must be a real
 *  YYYY-MM-DD date. */
export function parseDueDate(v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return { ok: true, value: null };
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return { ok: false, error: "Pick a valid date." };
  const s = v.trim();
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { ok: false, error: "Pick a valid date." };
  return { ok: true, value: s };
}

/** The owner of an item must be a member of the project (or nobody). */
export function assigneeAllowed(memberUserIds: (string | null)[], assigneeId: string | null): boolean {
  return assigneeId === null || memberUserIds.includes(assigneeId);
}

// ── updates ──────────────────────────────────────────────────────────────────

export const UPDATE_BODY_MAX = 4000;

export function parseUpdatePost(
  kind: unknown,
  body: unknown,
  role: string | null | undefined
): { ok: true; value: { kind: UpdateKind; body: string } } | { ok: false; error: string } {
  const text = typeof body === "string" ? body.replace(/\r\n/g, "\n").trim() : "";
  if (typeof kind !== "string" || !(UPDATE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: "Choose what kind of post this is." };
  }
  if (!canPostKind(role, kind)) {
    return {
      ok: false,
      error: kind === "announcement" ? "Only a lead or the SPARC team can post an announcement." : "That kind of post is not available.",
    };
  }
  if (!text) return { ok: false, error: "Write something first." };
  if (text.length > UPDATE_BODY_MAX) return { ok: false, error: `Keep it under ${UPDATE_BODY_MAX} characters.` };
  return { ok: true, value: { kind: kind as UpdateKind, body: text } };
}

export type UpdateRow = {
  id: string;
  kind: string;
  body: string;
  created_at: string;
  resolved_at: string | null;
};

/** Announcements pinned on top (newest first), then everything else newest first. */
export function arrangeUpdates<T extends UpdateRow>(rows: T[]): { pinned: T[]; feed: T[] } {
  const newest = (a: T, b: T) => b.created_at.localeCompare(a.created_at);
  return {
    pinned: rows.filter((r) => r.kind === "announcement").sort(newest),
    feed: rows.filter((r) => r.kind !== "announcement").sort(newest),
  };
}

/** The help posts nobody has resolved yet, newest first. */
export function openHelp<T extends UpdateRow>(rows: T[]): T[] {
  return rows
    .filter((r) => r.kind === "help" && !r.resolved_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function firstLine(body: string, max = 140): string {
  const line = (body.split("\n").find((l) => l.trim()) ?? "").trim();
  return line.length > max ? `${line.slice(0, max - 3).trimEnd()}...` : line;
}

/** The newest update of any kind, or null. */
export function lastUpdateAt(rows: Pick<UpdateRow, "created_at">[]): string | null {
  return rows.reduce<string | null>((m, r) => (m === null || r.created_at > m ? r.created_at : m), null);
}

// ── status pill ──────────────────────────────────────────────────────────────

export type StatusPill = "needs_help" | "quiet" | "on_track";
export const STALE_AFTER_DAYS = 14;

export const PILL_LABEL: Record<StatusPill, string> = {
  needs_help: "Needs help",
  quiet: "No update in 14+ days",
  on_track: "On track",
};

/** Needs help (an unresolved help post) comes first, then a project with no
 *  update (or, with none ever, no activity since it was created) in 14 days,
 *  otherwise on track. */
export function statusPill(args: {
  openHelpCount: number;
  lastUpdate: string | null;
  createdAt?: string | null;
  now?: Date;
}): StatusPill {
  if (args.openHelpCount > 0) return "needs_help";
  const now = args.now ?? new Date();
  const since = args.lastUpdate ?? args.createdAt ?? null;
  if (!since) return "quiet";
  const t = new Date(since).getTime();
  if (Number.isNaN(t)) return "quiet";
  return now.getTime() - t > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000 ? "quiet" : "on_track";
}

// ── program view ─────────────────────────────────────────────────────────────

/** The program page and the link to it are for someone who is a lead or manager on
 *  at least one project in the ColaboFest program (projects.program). */
export function canSeeProgram(memberships: { program: string | null; role: string }[]): boolean {
  return memberships.some((m) => m.program === COLABOFEST_PROGRAM && isStaffRole(m.role));
}

// ── GitHub link ──────────────────────────────────────────────────────────────

export const GITHUB_URL_MAX = 300;

/** A GitHub link as the database accepts it: https://github.com/<path>. Empty
 *  means clear it. */
export function parseGithubUrl(v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return { ok: true, value: null };
  if (s.length > GITHUB_URL_MAX) return { ok: false, error: "That link is too long." };
  if (!/^https:\/\/github\.com\/[A-Za-z0-9._~/%-]+$/.test(s)) {
    return { ok: false, error: "Paste a link that starts with https://github.com/" };
  }
  return { ok: true, value: s };
}

// ── status summary (assistant) ───────────────────────────────────────────────

export type StatusInput = {
  name: string;
  isChallenge: boolean;
  items: (TaskItem & { assignee_name?: string | null })[];
  updates: (UpdateRow & { author_name?: string | null })[];
  wikiTitles: string[];
  today: string;
  now?: Date;
  createdAt?: string | null;
};

/** What the assistant tells a researcher about one project. */
export function buildProjectStatus(i: StatusInput) {
  const progress = progressByList(i.items);
  const lists = visibleLists(i.isChallenge).map((k) => ({
    list: LIST_LABEL[k],
    ready: progress[k].ready,
    total: progress[k].total,
  }));
  const overdue = i.items
    .filter((it) => isOverdue(it, i.today))
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
    .map((it) => ({
      item: it.label,
      list: LIST_LABEL[isListKey(it.list_key) ? it.list_key : "team"],
      owner: it.assignee_name ?? null,
      due: it.due_date ?? null,
    }));
  const help = openHelp(i.updates).map((u) => ({ text: firstLine(u.body), by: u.author_name ?? null, posted: u.created_at.slice(0, 10) }));
  const recent = i.updates
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 3)
    .map((u) => ({ kind: u.kind, text: firstLine(u.body), by: u.author_name ?? null, posted: u.created_at.slice(0, 10) }));
  const pill = statusPill({ openHelpCount: help.length, lastUpdate: lastUpdateAt(i.updates), createdAt: i.createdAt, now: i.now });
  return {
    project: i.name,
    status: PILL_LABEL[pill],
    checklists: lists,
    overdue_items: overdue,
    open_help_requests: help,
    latest_updates: recent,
    wiki_pages: i.wikiTitles.slice(0, 20),
  };
}

// ── program card (ColaboFest page) ───────────────────────────────────────────

export type ProgramCard = {
  id: string;
  name: string;
  teamSize: number;
  pill: StatusPill;
  progress: { list: ListKey; label: string; ready: number; total: number }[];
  overdue: number;
  lastUpdate: string | null;
};

export function buildProgramCard(i: {
  id: string;
  name: string;
  createdAt: string | null;
  teamSize: number;
  items: { status: string; list_key?: string | null; due_date?: string | null }[];
  updates: { kind: string; created_at: string; resolved_at: string | null }[];
  now?: Date;
}): ProgramCard {
  const now = i.now ?? new Date();
  const progress = progressByList(i.items);
  const open = i.updates.filter((u) => u.kind === "help" && !u.resolved_at).length;
  const last = lastUpdateAt(i.updates);
  return {
    id: i.id,
    name: i.name,
    teamSize: i.teamSize,
    pill: statusPill({ openHelpCount: open, lastUpdate: last, createdAt: i.createdAt, now }),
    progress: visibleLists(true).map((k) => ({ list: k, label: LIST_LABEL[k], ...progress[k] })),
    overdue: overdueCount(i.items, todayIso(now)),
    lastUpdate: last,
  };
}

