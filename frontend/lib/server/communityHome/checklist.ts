// lib/server/communityHome/checklist.ts — the welcome checklist on the
// community Home tab: who sees it, which of its five items are done, and
// which steps get stored. Pure, so `npm test` covers it. Progress is stored per
// member in community_member_progress (2026-10-23_community_email_join_checklist.sql).
//
// No runtime imports.

export const CHECKLIST_DAYS = 14;
export const CHECKLIST_TOTAL = 5;

/** The two steps that need storing; the others are derived from existing data. */
export const TRACKED_STEPS = ["pinned_opened", "link_copied"] as const;
export type TrackedStep = (typeof TRACKED_STEPS)[number];

export function isTrackedStep(v: unknown): v is TrackedStep {
  return typeof v === "string" && (TRACKED_STEPS as readonly string[]).includes(v);
}

export type ChecklistProgress = Partial<Record<TrackedStep, boolean>>;

/** Keeps only known steps set to true, so stored junk can't leak into the UI. */
export function cleanProgress(raw: unknown): ChecklistProgress {
  const out: ChecklistProgress = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const s of TRACKED_STEPS) if ((raw as Record<string, unknown>)[s] === true) out[s] = true;
  }
  return out;
}

/** True when `joinedAt` is within the last `days` days (and not in the future). */
export function joinedRecently(joinedAt: string | null | undefined, now: number = Date.now(), days = CHECKLIST_DAYS): boolean {
  const t = joinedAt ? Date.parse(joinedAt) : NaN;
  if (!Number.isFinite(t)) return false;
  return t <= now + 60_000 && now - t < days * 24 * 60 * 60 * 1000;
}

/** The checklist is for active members who joined in the last 14 days and
 *  haven't dismissed it. */
export function showChecklist(a: {
  isMember: boolean;
  joinedAt: string | null | undefined;
  dismissed: boolean;
  now?: number;
}): boolean {
  return a.isMember && !a.dismissed && joinedRecently(a.joinedAt, a.now);
}

export type ChecklistItem = {
  key: "join" | "focus" | "pinned" | "page" | "invite";
  label: string;
  hint: string;
  done: boolean;
  /** Where clicking goes; null when the step is done from elsewhere on the page. */
  href: string | null;
};

export function buildChecklist(a: {
  slug: string;
  focus: string | null | undefined;
  progress: ChecklistProgress;
  ownsLivingPage: boolean;
}): { items: ChecklistItem[]; done: number; total: number } {
  const items: ChecklistItem[] = [
    { key: "join", label: "Join the community", hint: "You're in.", done: true, href: null },
    {
      key: "focus",
      label: "Tell us what you work on",
      hint: "One line, shown on your member card.",
      done: !!a.focus && a.focus.trim().length > 0,
      href: `/communities/${a.slug}?tab=members&editFocus=1`,
    },
    {
      key: "pinned",
      label: "Open the pinned slides",
      hint: "View or download the resource pinned by the admin.",
      done: a.progress.pinned_opened === true,
      href: "#pinned",
    },
    {
      key: "page",
      label: "Create or follow a living page",
      hint: "Open the assistant and choose “Create a living page”.",
      done: a.ownsLivingPage,
      href: "/explore",
    },
    {
      key: "invite",
      label: "Invite a colleague",
      hint: "Use “Share · copy link” at the top of the page.",
      done: a.progress.link_copied === true,
      href: null,
    },
  ];
  return { items, done: items.filter((i) => i.done).length, total: CHECKLIST_TOTAL };
}
