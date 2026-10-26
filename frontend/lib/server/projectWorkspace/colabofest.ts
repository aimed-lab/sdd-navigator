// The rules of the ColaboFest project home, as pure functions (no I/O, no next/*
// imports) so `npm test` covers them and client components may import them:
// who may open a project, who may post and delete what, the welcome card, the
// role label, and the small text helpers for discussions. The database enforces
// the same rules (2026-10-31_*.sql); these give clear messages and drive the UI.

import { COLABOFEST_CONTACT_EMAIL } from "../../colabofestConfig.ts";
import { isStaffRole, nextUp, type TaskItem } from "./status.ts";

// ── who may open a project ───────────────────────────────────────────────────

export type AccessDecision = "sign_in" | "restricted" | "allowed";

/** ColaboFest projects are invite-only: signed out sees the sign-in page, signed
 *  in but not on the project sees "Restricted access", a member gets in. The link
 *  alone is never enough, and neither screen carries any project data. */
export function decideAccess(args: { signedIn: boolean; isMember: boolean }): AccessDecision {
  if (!args.signedIn) return "sign_in";
  return args.isMember ? "allowed" : "restricted";
}

/** The smallest slice of the database client the membership check uses. */
export type MembershipDb = {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
  };
};

/** Real membership: a project_members row for this project and this person.
 *  NEVER "the projects row is visible": the policy "Projects: member or community
 *  select" (2026-08-30_community_admin_membership.sql) also shows the row to any
 *  member of the project's community. An error counts as "not a member". */
export async function hasProjectMemberRow(db: MembershipDb, projectId: string, userId: string): Promise<boolean> {
  const { data, error } = await db
    .from("project_members")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}

/** "Still can't get in?" mailto, with the project link in the subject. */
export function contactMailto(projectLink: string, contact: string = COLABOFEST_CONTACT_EMAIL): string {
  return `mailto:${contact}?subject=${encodeURIComponent(`Can't open my ColaboFest project: ${projectLink}`)}`;
}

// ── announcements ────────────────────────────────────────────────────────────

/** Post, edit, pin or delete an announcement: a project lead or manager, or a
 *  site admin. Members only read. */
export function canManageAnnouncements(args: { role: string | null | undefined; isSiteAdmin?: boolean }): boolean {
  return !!args.isSiteAdmin || isStaffRole(args.role);
}

export type AnnouncementLike = { pinned: boolean; created_at: string };

/** Pinned first, then newest; within each group newest first. */
export function arrangeAnnouncements<T extends AnnouncementLike>(rows: T[]): T[] {
  return rows
    .slice()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at));
}

// ── discussions ──────────────────────────────────────────────────────────────

/** Any project member starts a thread or replies. */
export function canStartThread(isMember: boolean): boolean {
  return isMember;
}

/** The author, a project LEAD or a site admin deletes a thread or a reply. (A
 *  manager who is not a lead deletes only their own.) */
export function canDeleteThread(args: { isAuthor: boolean; role: string | null | undefined; isSiteAdmin?: boolean }): boolean {
  return args.isAuthor || args.role === "lead" || !!args.isSiteAdmin;
}

export const THREAD_TITLE_MAX = 200;
export const THREAD_BODY_MAX = 4000;

function clean(v: unknown): string {
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
}

export function parseThread(title: unknown, body: unknown): { ok: true; title: string; body: string } | { ok: false; error: string } {
  const t = clean(title).replace(/\s+/g, " ");
  const b = clean(body);
  if (!t) return { ok: false, error: "Give the discussion a title." };
  if (t.length > THREAD_TITLE_MAX) return { ok: false, error: `Keep the title under ${THREAD_TITLE_MAX} characters.` };
  if (!b) return { ok: false, error: "Write something to start the discussion." };
  if (b.length > THREAD_BODY_MAX) return { ok: false, error: `Keep it under ${THREAD_BODY_MAX} characters.` };
  return { ok: true, title: t, body: b };
}

export function parseReply(body: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const b = clean(body);
  if (!b) return { ok: false, error: "Write a reply first." };
  if (b.length > THREAD_BODY_MAX) return { ok: false, error: `Keep it under ${THREAD_BODY_MAX} characters.` };
  return { ok: true, body: b };
}

export const ANNOUNCEMENT_BODY_MAX = 4000;

export function parseAnnouncement(body: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const b = clean(body);
  if (!b) return { ok: false, error: "Write the announcement first." };
  if (b.length > ANNOUNCEMENT_BODY_MAX) return { ok: false, error: `Keep it under ${ANNOUNCEMENT_BODY_MAX} characters.` };
  return { ok: true, body: b };
}

/** Newest activity first (the last reply, or the thread itself). */
export function sortThreads<T extends { last_activity_at: string }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at));
}

export type TextPart = { text: string; href?: string };

/** Plain text with http(s) links made clickable. Nothing else is interpreted:
 *  the parts are rendered as text nodes and anchors, never as HTML. Trailing
 *  punctuation is not part of the link. */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const re = /\bhttps?:\/\/[^\s<>"']+/gi;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let url = m[0];
    const trail = /[.,;:!?)\]}]+$/.exec(url);
    if (trail) url = url.slice(0, url.length - trail[0].length);
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: url, href: url });
    last = m.index + url.length;
    re.lastIndex = last;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** "5m ago", "3h ago", "2d ago", else "Oct 26". `now` is a parameter so it is testable. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const sec = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

/** "Oct 26" in the program's time zone. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

// ── welcome card ─────────────────────────────────────────────────────────────

/** Shown on a ColaboFest project until this person dismisses it. */
export function showWelcome(args: { isColabofest: boolean; dismissed: boolean }): boolean {
  return args.isColabofest && !args.dismissed;
}

/** "Priya" from "Priya Raman"; the part of the email before "@" when there is no
 *  name; "there" when neither. */
export function firstName(name: string | null | undefined, email?: string | null): string {
  const n = (name ?? "").trim();
  if (n) return n.split(/\s+/)[0];
  const local = (email ?? "").split("@")[0].trim();
  return local || "there";
}

// ── team labels ──────────────────────────────────────────────────────────────

export type Affiliation = "sparc" | "southern_research";

export function isAffiliation(v: unknown): v is Affiliation {
  return v === "sparc" || v === "southern_research";
}

export const AFFILIATION_LABEL: Record<Affiliation, string> = { sparc: "SPARC", southern_research: "Southern Research" };

/** What the Team card shows beside a person: Lead / Member / SPARC / Southern
 *  Research. A lead stays "Lead"; otherwise the affiliation, when set, wins. A
 *  manager with no affiliation is "SPARC team". */
export function roleLabel(role: string, affiliation: string | null | undefined): string {
  if (role === "lead") return "Lead";
  if (isAffiliation(affiliation)) return AFFILIATION_LABEL[affiliation];
  return role === "manager" ? "SPARC team" : "Member";
}

// ── progress ─────────────────────────────────────────────────────────────────

/** The soonest unfinished item that has a due date (an overdue one comes first). */
export function nextDue<T extends TaskItem>(items: T[], today: string): T | null {
  return nextUp(items, today, items.length).find((i) => !!i.due_date) ?? null;
}
