// lib/server/explore/exploreLayout.ts — the pure rules behind the redesigned
// Explore pages: which four items "Today in drug discovery" shows, the Browse
// tabs, the results page's tab row (counts and order), the mixed "All" list,
// the ?category= mapping and which communities the landing offers.
//
// No runtime imports beyond the small community formatters, so `npm test`
// covers it and client components may import it.

import type { ExploreItem, ExploreSection } from "@/types/explore";
import { phaseLabel, shortDate, sourceName, statusLabel } from "../communityHome/communityHome.ts";

// ── the landing question box ────────────────────────────────────────────────

export const EXAMPLE_TOPICS = [
  "CRISPR screening",
  "Dementia care in rural communities",
  "NIH grants for AI in health",
  "KRAS in pancreatic cancer",
];

// ── dates and picking ───────────────────────────────────────────────────────

function dateMs(item: ExploreItem, now: number): number | null {
  const ms = item.date_iso ? Date.parse(item.date_iso) : NaN;
  return Number.isFinite(ms) && ms <= now ? ms : null; // a future date is not "newest"
}

/** The newest dated item (a future date does not count); the first item when
 *  none has a usable date. */
export function newestOf(items: ExploreItem[], now: number = Date.now()): ExploreItem | null {
  if (items.length === 0) return null;
  let best: { item: ExploreItem; ms: number } | null = null;
  for (const item of items) {
    const ms = dateMs(item, now);
    if (ms !== null && (!best || ms > best.ms)) best = { item, ms };
  }
  return best ? best.item : items[0];
}

/** The latest podcast episode: the highest episode number when every item has
 *  one, else the newest date, else the first item. */
export function latestEpisode(items: ExploreItem[], now: number = Date.now()): ExploreItem | null {
  if (items.length === 0) return null;
  const num = (i: ExploreItem) => (typeof i.raw?.episode_number === "number" ? (i.raw.episode_number as number) : null);
  if (items.every((i) => num(i) !== null)) {
    return [...items].sort((a, b) => (num(b) as number) - (num(a) as number))[0];
  }
  return newestOf(items, now);
}

function recruitingFirst(items: ExploreItem[], now: number): ExploreItem | null {
  const recruiting = items.filter((i) => String(i.raw?.overall_status ?? "").toUpperCase() === "RECRUITING");
  return newestOf(recruiting.length > 0 ? recruiting : items, now);
}

export type TodayCard = {
  /** Which of the four slots this fills; "more" when a slot had nothing and another item stands in. */
  slot: "regulatory" | "lab" | "trial" | "podcast" | "more";
  tag: string;
  /** Colour pair in lib/typeStyles TYPE_STYLES. */
  tint: "news" | "paper" | "community" | "podcast" | "other";
  title: string;
  /** One line: source · date, or status · phase for a trial. */
  meta: string;
  url: string | null;
  id: string;
};

const TAG: Record<string, { tag: string; tint: TodayCard["tint"] }> = {
  approval: { tag: "FDA approved", tint: "news" },
  news: { tag: "News", tint: "news" },
  paper: { tag: "Paper", tint: "paper" },
  trial: { tag: "Trial", tint: "community" },
  episode: { tag: "Podcast", tint: "podcast" },
};

export function todayMeta(item: ExploreItem, now: number = Date.now()): string {
  if (item.kind === "trial") {
    const status = statusLabel(typeof item.raw?.overall_status === "string" ? (item.raw.overall_status as string) : null);
    const phase = phaseLabel(typeof item.raw?.phase === "string" ? (item.raw.phase as string) : null);
    return [status, phase].filter(Boolean).join(" · ");
  }
  const ms = dateMs(item, now);
  const date = ms === null ? "" : shortDate(item.date_iso);
  return [sourceName(item.source), date].filter(Boolean).join(" · ");
}

function card(slot: TodayCard["slot"], item: ExploreItem, now: number, tagOverride?: string): TodayCard {
  const t = TAG[item.kind] ?? { tag: item.kind, tint: "other" as const };
  return {
    slot,
    tag: tagOverride ?? t.tag,
    tint: t.tint,
    title: item.title,
    meta: todayMeta(item, now),
    url: item.url && /^https?:\/\//i.test(item.url) ? item.url : null,
    id: item.id,
  };
}

/** Exactly four cards from data the landing already loads, when there is enough
 *  to fill them: the newest FDA approval or news item, one AI.MED Lab paper,
 *  one trial, the newest podcast episode. A slot with nothing is filled from
 *  what is left (news, then papers, trials, approvals), so a thin feed still
 *  shows four. */
export function pickToday(
  data: {
    approvals?: ExploreItem[];
    news?: ExploreItem[];
    labPapers?: ExploreItem[];
    trials?: ExploreItem[];
    episodes?: ExploreItem[];
    papers?: ExploreItem[];
  },
  now: number = Date.now()
): TodayCard[] {
  const approvals = data.approvals ?? [];
  const news = data.news ?? [];
  const trials = data.trials ?? [];
  const papers = data.papers ?? [];

  const picked: TodayCard[] = [];
  const used = new Set<string>();
  const take = (slot: TodayCard["slot"], item: ExploreItem | null, tag?: string) => {
    if (!item || used.has(item.id)) return;
    used.add(item.id);
    picked.push(card(slot, item, now, tag));
  };

  take("regulatory", newestOf([...approvals, ...news], now));
  take("lab", newestOf(data.labPapers ?? [], now), "Lab paper");
  take("trial", recruitingFirst(trials, now));
  take("podcast", latestEpisode(data.episodes ?? [], now));

  const pool = [
    ...[...news].sort((a, b) => (dateMs(b, now) ?? 0) - (dateMs(a, now) ?? 0)),
    ...papers,
    ...trials,
    ...approvals,
  ];
  for (const item of pool) {
    if (picked.length >= 4) break;
    take("more", item);
  }
  return picked.slice(0, 4);
}

// ── communities near your work ──────────────────────────────────────────────

type CommunityLike = { community: { name: string; member_count?: number | null }; member: boolean };

/** The viewer's communities first, otherwise the largest; three of them. */
export function pickCommunities<T extends CommunityLike>(items: T[], max = 3): T[] {
  const size = (x: T) => x.community.member_count ?? 0;
  return [...items]
    .sort(
      (a, b) =>
        Number(b.member) - Number(a.member) || size(b) - size(a) || a.community.name.localeCompare(b.community.name)
    )
    .slice(0, max);
}

// ── the results page: tabs, counts and the mixed "All" list ─────────────────

/** Always-present tabs, in order (shown even with a zero count). */
export const FIXED_RESULT_TABS: { key: string; label: string }[] = [
  { key: "paper", label: "Papers" },
  { key: "trial", label: "Trials" },
  { key: "approval", label: "FDA" },
  { key: "compound", label: "Compounds" },
  { key: "dataset", label: "Datasets" },
  { key: "grant", label: "Grants" },
];

// Other kinds appear as tabs only when they have results, in this order, then
// anything unknown alphabetically.
const EXTRA_ORDER = ["preprint", "tool", "news", "target", "geneset", "resource", "person", "episode"];

const EXTRA_LABEL: Record<string, string> = {
  preprint: "Preprints",
  tool: "Tools",
  news: "News",
  target: "Targets",
  geneset: "Gene sets",
  resource: "Lab resources",
  person: "People",
  episode: "Podcast",
};

export function labelForResultKind(kind: string): string {
  return (
    FIXED_RESULT_TABS.find((t) => t.key === kind)?.label ??
    EXTRA_LABEL[kind] ??
    kind.charAt(0).toUpperCase() + kind.slice(1)
  );
}

export function itemsOfKind(sections: ExploreSection[], kind: string): ExploreItem[] {
  return sections.filter((s) => s.kind === kind).flatMap((s) => s.items ?? []);
}

export function countOfKind(sections: ExploreSection[], kind: string): number {
  return itemsOfKind(sections, kind).length;
}

export type ResultTab = { key: string; label: string; count: number };

/** All, then the fixed kinds (zero counts kept), then any other kind that has results. */
export function resultTabs(sections: ExploreSection[]): ResultTab[] {
  const total = sections.reduce((n, s) => n + (s.items ?? []).length, 0);
  const fixed = new Set(FIXED_RESULT_TABS.map((t) => t.key));
  const extraKinds = Array.from(new Set(sections.map((s) => s.kind)))
    .filter((k) => !fixed.has(k) && countOfKind(sections, k) > 0)
    .sort((a, b) => {
      const ia = EXTRA_ORDER.indexOf(a);
      const ib = EXTRA_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  return [
    { key: "all", label: "All", count: total },
    ...FIXED_RESULT_TABS.map((t) => ({ ...t, count: countOfKind(sections, t.key) })),
    ...extraKinds.map((k) => ({ key: k, label: labelForResultKind(k), count: countOfKind(sections, k) })),
  ];
}

/** ?category=<kind> -> the tab to open. "all" for nothing, an unknown kind, or
 *  a kind with no tab. (null stays the All tab in the page's own state.) */
export function categoryToTab(category: string | null | undefined, tabs: ResultTab[]): string {
  const c = (category ?? "").trim();
  return c && tabs.some((t) => t.key === c) ? c : "all";
}

export type MixedGroup = { kind: string; label: string; items: ExploreItem[]; total: number };

const MIX_QUOTA: Record<string, number> = { approval: 3, paper: 4, trial: 3 };
// The All list's order: FDA, papers, trials, then the other fixed kinds, then the rest.
const MIX_ORDER = ["approval", "paper", "trial", "compound", "dataset", "grant", ...EXTRA_ORDER];

export function mixedAll(sections: ExploreSection[], limit = 10): MixedGroup[] {
  const kinds = Array.from(new Set(sections.map((s) => s.kind))).filter((k) => countOfKind(sections, k) > 0);
  const rank = (k: string) => (MIX_ORDER.indexOf(k) < 0 ? 99 : MIX_ORDER.indexOf(k));
  const order = [...kinds].sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));

  const taken = new Map<string, number>();
  let used = 0;
  for (const k of order) {
    const n = Math.min(MIX_QUOTA[k] ?? 1, countOfKind(sections, k), limit - used);
    if (n > 0) taken.set(k, n);
    used += Math.max(n, 0);
  }
  // Spare room goes to kinds in the same order, one at a time.
  let progress = true;
  while (used < limit && progress) {
    progress = false;
    for (const k of order) {
      if (used >= limit) break;
      const have = taken.get(k) ?? 0;
      if (have < countOfKind(sections, k)) {
        taken.set(k, have + 1);
        used += 1;
        progress = true;
      }
    }
  }

  return order
    .filter((k) => (taken.get(k) ?? 0) > 0)
    .map((k) => ({
      kind: k,
      label: labelForResultKind(k),
      items: itemsOfKind(sections, k).slice(0, taken.get(k) as number),
      total: countOfKind(sections, k),
    }));
}

// ── scope: what a question is searching ─────────────────────────────────────

export type ScopeKey = "all" | "paper" | "preprint" | "trial" | "approval" | "grant" | "tool" | "episode" | "news";

/** The scope picker on the question box, in order. `key` is also the
 *  ?category= value (the existing kind names). */
export const SCOPES: { key: ScopeKey; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "paper", label: "Papers" },
  { key: "preprint", label: "Preprints" },
  { key: "trial", label: "Clinical trials" },
  { key: "approval", label: "FDA approvals" },
  { key: "grant", label: "Grants" },
  { key: "tool", label: "Tools & datasets" },
  { key: "episode", label: "Podcast" },
  { key: "news", label: "News" },
];

// Plural / friendly spellings of the same kinds ("?category=grants").
const SCOPE_ALIASES: Record<string, ScopeKey> = {
  papers: "paper",
  preprints: "preprint",
  trials: "trial",
  fda: "approval",
  approvals: "approval",
  grants: "grant",
  tools: "tool",
  dataset: "tool",
  datasets: "tool",
  podcast: "episode",
  episodes: "episode",
};

/** The scope a ?category= value means. "all" for nothing or anything else
 *  (compound, geneset, ... are tabs of the full results, not scopes). */
export function scopeFromParam(param: string | null | undefined): ScopeKey {
  const p = (param ?? "").trim().toLowerCase();
  if (!p || p === "all") return "all";
  if (SCOPES.some((s) => s.key === p)) return p as ScopeKey;
  return SCOPE_ALIASES[p] ?? "all";
}

/** The ?category= value for a scope; null for Everything. */
/** The source kinds a search in this scope must query directly (sent to the
 *  backend as `only_kinds`), or null when the normal routed search applies.
 *  "Tools & datasets" is two kinds; Podcast has its own page and search. */
export function scopeKinds(scope: ScopeKey): string[] | null {
  if (scope === "all" || scope === "episode") return null;
  return scope === "tool" ? ["tool", "dataset"] : [scope];
}

export function scopeParam(scope: ScopeKey): string | null {
  return scope === "all" ? null : scope;
}

/** Where a question with this scope goes. A topic searches within the scope; no
 *  topic opens the scope's full list. Podcast has its own searchable page. */
export function scopeHref(scope: ScopeKey, topic: string | null | undefined): string {
  const t = (topic ?? "").trim();
  const enc = encodeURIComponent(t);
  if (!t) return scope === "all" ? "/explore" : scope === "episode" ? "/explore/podcast" : `/explore?category=${scope}`;
  if (scope === "all") return `/explore/${enc}`;
  if (scope === "episode") return `/explore/podcast?q=${enc}`;
  return `/explore/${enc}?category=${scope}`;
}

// ── the "Jump to" row ───────────────────────────────────────────────────────

export type JumpTile = { key: string; icon: string; title: string; line: string; href: string };

/** Seven tiles straight to a full list. The podcast line uses the real episode
 *  count when it is known, and never invents one. */
export function jumpTiles(episodeCount: number | null): JumpTile[] {
  return [
    { key: "papers", icon: "article", title: "Latest papers", line: "New research, newest first", href: scopeHref("paper", null) },
    { key: "preprints", icon: "draft", title: "Preprints", line: "Before peer review", href: scopeHref("preprint", null) },
    { key: "grants", icon: "payments", title: "Open grants", line: "Deadlines soonest first", href: scopeHref("grant", null) },
    { key: "trials", icon: "medical_services", title: "Clinical trials", line: "Recruiting first", href: scopeHref("trial", null) },
    { key: "tools", icon: "build", title: "Tools & datasets", line: "Open-source and public resources", href: scopeHref("tool", null) },
    {
      key: "podcast",
      icon: "podcasts",
      title: "Podcast",
      line: episodeCount !== null && episodeCount > 0 ? `${episodeCount} episodes · transcripts` : "Episodes · transcripts",
      href: scopeHref("episode", null),
    },
    { key: "news", icon: "newspaper", title: "News", line: "Headlines from the field", href: scopeHref("news", null) },
  ];
}

// ── list orders ─────────────────────────────────────────────────────────────

function closeMs(item: ExploreItem): number | null {
  const raw = item.raw?.close_date;
  const ms = typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** Grants still open, soonest deadline first; then grants with no usable
 *  deadline (order kept); closed ones last. */
export function sortGrantsByDeadline(items: ExploreItem[], now: number = Date.now()): ExploreItem[] {
  const startOfToday = now - (now % 86_400_000);
  const rank = (i: ExploreItem) => {
    const ms = closeMs(i);
    return ms === null ? 1 : ms >= startOfToday ? 0 : 2;
  };
  return items
    .map((item, order) => ({ item, order }))
    .sort((a, b) => {
      const ra = rank(a.item);
      const rb = rank(b.item);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (closeMs(a.item) as number) - (closeMs(b.item) as number) || a.order - b.order;
      return a.order - b.order;
    })
    .map((x) => x.item);
}

/** Trials that are recruiting first, the rest after, order otherwise kept. */
export function sortTrialsRecruitingFirst(items: ExploreItem[]): ExploreItem[] {
  const recruiting = (i: ExploreItem) => String(i.raw?.overall_status ?? "").toUpperCase() === "RECRUITING";
  return [...items.filter(recruiting), ...items.filter((i) => !recruiting(i))];
}
