// lib/server/communityHome/tiles.ts: the pure rules behind the community page's tile
// layout and its Events: which section the URL asks for, the small lines under each
// tile, the "Latest" mix, and event input checking (including the date and time
// someone types in the program's time zone, Chicago). No imports, so `npm test`
// covers it and client components may import it.

// ── sections (?view=) ────────────────────────────────────────────────────────

export const COMMUNITY_VIEWS = ["announcements", "events", "members", "resources", "pages", "showcase", "manage"] as const;
export type CommunityView = (typeof COMMUNITY_VIEWS)[number];

/** The section the URL asks for: ?view= first, else the old ?tab= mapped to its view
 *  (home maps to the community home, null). Anything the viewer cannot open is the
 *  home. */
export function resolveView(
  view: string | null | undefined,
  tab: string | null | undefined,
  available: readonly CommunityView[]
): CommunityView | null {
  const want = view ?? (tab && tab !== "home" ? tab : null);
  return want && (available as readonly string[]).includes(want) ? (want as CommunityView) : null;
}

/** "Investigators" only for the SPARC community; "Members" everywhere else. */
export function memberTileLabel(slug: string): string {
  return slug === "sparc-investigators" ? "Investigators" : "Members";
}

/** The pinned tile's short name: "Apply" for an application form, else the first
 *  words of the title (at most 14 characters). */
export function shortPinnedLabel(title: string): string {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "Pinned";
  if (/\b(apply|application)\b/i.test(t)) return "Apply";
  const words = t.split(" ");
  let out = words[0];
  for (let i = 1; i < words.length && (out + " " + words[i]).length <= 14; i++) out += " " + words[i];
  return out.length > 14 ? `${out.slice(0, 13)}…` : out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many of these were created in the last `days` days. */
export function newCount(items: { created_at: string }[], now: Date, days = 7): number {
  const since = now.getTime() - days * DAY_MS;
  return items.filter((i) => {
    const t = Date.parse(i.created_at);
    return Number.isFinite(t) && t >= since && t <= now.getTime() + DAY_MS;
  }).length;
}

// ── events ───────────────────────────────────────────────────────────────────

export type EventLike = { starts_at: string };

const ZONE = "America/Chicago";

function parts(iso: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: ZONE, ...opts }).formatToParts(new Date(iso))) out[p.type] = p.value;
  return out;
}

/** Upcoming first (soonest first), then past (most recent first). */
export function splitEvents<T extends EventLike>(events: T[], now: Date): { upcoming: T[]; past: T[] } {
  const t = now.getTime();
  const upcoming = events.filter((e) => Date.parse(e.starts_at) >= t).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const past = events.filter((e) => Date.parse(e.starts_at) < t).sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  return { upcoming, past };
}

/** "Nov 13". */
export function eventDay(iso: string): string {
  const p = parts(iso, { month: "short", day: "numeric" });
  return `${p.month} ${p.day}`;
}

/** "2:00 PM". */
export function eventTime(iso: string): string {
  const p = parts(iso, { hour: "numeric", minute: "2-digit", hour12: true });
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** The date badge: month in capitals over the day number. */
export function eventBadge(iso: string): { month: string; day: string } {
  const p = parts(iso, { month: "short", day: "numeric" });
  return { month: p.month.toUpperCase(), day: p.day };
}

/** The line under the Events tile. */
export function nextEventLabel(events: EventLike[], now: Date): string {
  const next = splitEvents(events, now).upcoming[0];
  return next ? `Next: ${eventDay(next.starts_at)}` : "None yet";
}

/** The input boxes' value for a stored time: "2026-11-13" and "14:00" in Chicago. */
export function eventInputValues(iso: string): { date: string; time: string } {
  const p = parts(iso, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

/** A Chicago wall-clock date and time ("2026-11-13", "14:00") as an ISO instant, or null. */
export function chicagoToIso(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, da, h, mi);
  // Find the instant whose Chicago wall clock reads `wall` (two passes handle a daylight-saving edge).
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(guess).toISOString(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour === "24" ? "0" : p.hour), Number(p.minute));
    guess += wall - shown;
  }
  const iso = new Date(guess).toISOString();
  // Reject 2026-02-31 and the like: it must read back the same.
  return eventInputValues(iso).date === date ? iso : null;
}

export const EVENT_TITLE_MAX = 200;
export const EVENT_PLACE_MAX = 200;
export const EVENT_LINK_MAX = 500;
export const EVENT_TEXT_MAX = 1000;

export type EventValue = { title: string; starts_at: string; location: string | null; link: string | null; description: string | null };

/** What the Add event form sent, checked: a title, a real date and time, an https
 *  link (or none), and trimmed optional text. */
export function parseEventInput(input: {
  title?: unknown;
  date?: unknown;
  time?: unknown;
  location?: unknown;
  link?: unknown;
  description?: unknown;
}): { ok: true; value: EventValue } | { ok: false; error: string } {
  const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const title = text(input.title);
  if (!title) return { ok: false, error: "Give the event a title." };
  if (title.length > EVENT_TITLE_MAX) return { ok: false, error: `Keep the title under ${EVENT_TITLE_MAX} characters.` };

  const date = typeof input.date === "string" ? input.date.trim() : "";
  const time = typeof input.time === "string" && input.time.trim() ? input.time.trim() : "09:00";
  if (!date) return { ok: false, error: "Pick a date." };
  const startsAt = chicagoToIso(date, time);
  if (!startsAt) return { ok: false, error: "That date or time is not valid." };

  const location = text(input.location);
  if (location.length > EVENT_PLACE_MAX) return { ok: false, error: `Keep the place under ${EVENT_PLACE_MAX} characters.` };

  const rawLink = typeof input.link === "string" ? input.link.trim() : "";
  let link: string | null = null;
  if (rawLink) {
    if (rawLink.length > EVENT_LINK_MAX || !/^https:\/\/[^\s]+$/i.test(rawLink)) {
      return { ok: false, error: "The link must start with https://" };
    }
    link = rawLink;
  }

  const description = typeof input.description === "string" ? input.description.replace(/\r\n/g, "\n").trim() : "";
  if (description.length > EVENT_TEXT_MAX) return { ok: false, error: `Keep the description under ${EVENT_TEXT_MAX} characters.` };

  return { ok: true, value: { title, starts_at: startsAt, location: location || null, link, description: description || null } };
}

// ── "Latest" ─────────────────────────────────────────────────────────────────

export type LatestKind = "announcement" | "event" | "join";
export type LatestEntry = { key: string; kind: LatestKind; title: string; at: string; meta: string };

/** One list of announcements, upcoming events and recent joins, newest first
 *  (by when each was posted or joined), at most `max`. */
export function buildLatest(
  input: {
    announcements: { id: string; title: string; created_at: string; author?: string | null }[];
    events: { id: string; title: string; starts_at: string; created_at: string }[];
    joins: { id: string; name: string; at: string }[];
  },
  now: Date,
  max = 6
): LatestEntry[] {
  const all: LatestEntry[] = [
    ...input.announcements.map((a) => ({
      key: `a:${a.id}`,
      kind: "announcement" as const,
      title: a.title,
      at: a.created_at,
      meta: a.author ? `Announcement · ${a.author}` : "Announcement",
    })),
    ...input.events
      .filter((e) => Date.parse(e.starts_at) >= now.getTime())
      .map((e) => ({ key: `e:${e.id}`, kind: "event" as const, title: e.title, at: e.created_at, meta: `Event · ${eventDay(e.starts_at)}` })),
    ...input.joins.map((j) => ({ key: `j:${j.id}`, kind: "join" as const, title: `${j.name} joined`, at: j.at, meta: "New member" })),
  ];
  return all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, max);
}
