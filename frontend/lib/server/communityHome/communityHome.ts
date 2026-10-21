// lib/server/communityHome/communityHome.ts — pure rules behind the community
// page: which tabs a viewer gets, what a signed-out visitor may see, the
// Updates stream, and small formatters.
//
// No runtime imports, so `npm test` covers it and client components may import
// it. It decides what to SHOW; the database (RLS) still decides what comes back.

import type { Announcement, CommunityFeedItem, MemberRosterEntry } from "@/lib/server/communities";

// ── tabs ─────────────────────────────────────────────────────────────────────

export const TAB_ORDER = ["home", "resources", "pages", "events", "members", "showcase"] as const;
export type TabKey = (typeof TAB_ORDER)[number];

export const TAB_LABEL: Record<TabKey, string> = {
  home: "Home",
  resources: "Resources",
  pages: "Living pages",
  events: "Events",
  members: "Members",
  showcase: "Showcase",
};

type SectionLike = { key: string; enabled: boolean };

/** Who is looking: a member sees everything; a non-member (signed in or not)
 *  sees more or less depending on the community's public_preview level. */
export type Viewer = { isMember: boolean; publicPreview: string | null | undefined };

export type ViewerAccess = {
  /** A non-member on an 'open' community: sees the roster, feed, pinned resource. */
  openPreview: boolean;
  seesMembers: boolean;
  seesPinned: boolean;
  seesResources: boolean;
  seesUpdates: boolean;
  /** Show "Join to get updates" in place of member-only content. */
  joinPrompt: boolean;
};

export function viewerAccess(v: Viewer): ViewerAccess {
  if (v.isMember) {
    return { openPreview: false, seesMembers: true, seesPinned: true, seesResources: true, seesUpdates: true, joinPrompt: false };
  }
  const open = v.publicPreview === "open";
  return {
    openPreview: open,
    seesMembers: open,
    seesPinned: open,
    seesResources: open,
    seesUpdates: open,
    joinPrompt: true,
  };
}

const enabled = (sections: SectionLike[], key: string) => sections.some((s) => s.key === key && s.enabled);

/** Tabs to show, in the fixed order. A tab whose section is turned off is
 *  hidden; Members and Living pages also need the roster to be visible to this
 *  viewer. Showcase is public. Home is always there. */
export function visibleTabs(sections: SectionLike[], viewer: Viewer): TabKey[] {
  const access = viewerAccess(viewer);
  const out: TabKey[] = ["home"];
  if (access.seesResources && (enabled(sections, "resources") || enabled(sections, "explore"))) out.push("resources");
  if (access.seesMembers) out.push("pages");
  if (enabled(sections, "events")) out.push("events");
  if (access.seesMembers && enabled(sections, "members")) out.push("members");
  if (enabled(sections, "showcase")) out.push("showcase");
  return TAB_ORDER.filter((t) => out.includes(t));
}

/** The requested ?tab= if the viewer has it, else Home. */
export function resolveTab(requested: string | null | undefined, visible: TabKey[]): TabKey {
  return (visible as string[]).includes(requested ?? "") ? (requested as TabKey) : "home";
}

// ── header ───────────────────────────────────────────────────────────────────

/** The badge on a community card: how people get in. */
export function joinModeLabel(isOpen: boolean): "Open to join" | "Request to join" {
  return isOpen ? "Open to join" : "Request to join";
}

export function eyebrow(isOpen: boolean): string {
  return isOpen ? "COMMUNITY · OPEN TO JOIN" : "COMMUNITY · REQUEST TO JOIN";
}

export function initials(name: string): string {
  const parts = name.replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** The URL a QR code points to: the community page with ?join=1. */
export function joinUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, "")}/communities/${encodeURIComponent(slug)}?join=1`;
}

/** The newest of the given dates, or null. */
export function latestDate(dates: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const d of dates) {
    const ms = d ? Date.parse(d) : NaN;
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = d as string;
    }
  }
  return best;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 21, 2026" (UTC, so server and browser agree). */
export function shortDate(iso: string | null | undefined): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ── pinned resource ──────────────────────────────────────────────────────────

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
export const isImageFile = (filename: string): boolean => IMAGE_EXT.test(filename);

/** A signed storage URL that downloads instead of opening. */
export function downloadHref(signedUrl: string, filename: string): string {
  return `${signedUrl}${signedUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(filename)}`;
}

// ── updates ──────────────────────────────────────────────────────────────────

export type UpdateEntry = {
  id: string;
  type: "announcement" | "feed";
  tag: string;
  tint: string;
  title: string;
  body: string | null;
  url: string | null;
  source: string | null;
  /** The date the list is sorted by: an announcement's posted time or a feed
   *  item's published_at. Null when the item has none or it is in the future
   *  (such items sort last). */
  at: string | null;
  /** The text to show under the title: a published date, or for a trial its
   *  status and phase. Never a future date; "" when there is nothing to show. */
  dateLabel: string;
};

// `tint` names the --type-<tint>-bg / -fg colours in app/globals.css.
const FEED_TAG: Record<string, { tag: string; tint: string }> = {
  paper: { tag: "Paper", tint: "paper" },
  preprint: { tag: "Preprint", tint: "paper" },
  approval: { tag: "Approval", tint: "tool" },
  trial: { tag: "Trial", tint: "community" },
  dataset: { tag: "Dataset", tint: "dataset" },
  geneset: { tag: "Gene set", tint: "dataset" },
  compound: { tag: "Compound", tint: "tool" },
  target: { tag: "Target", tint: "tool" },
  grant: { tag: "Grant", tint: "news" },
  tool: { tag: "Tool", tint: "tool" },
  news: { tag: "News", tint: "news" },
  episode: { tag: "Podcast", tint: "podcast" },
};

const SCHOLARLY_SOURCES = new Set(["openalex", "pubmed", "crossref", "europepmc"]);

/** The chip for a feed item. Old rows were stored as kind "news" with a
 *  scholarly source (an older backend ran news search on OpenAlex): those are
 *  papers. Real RSS news (statnews, ...) keeps "News". */
export function feedTag(kind: string, source?: string | null): { tag: string; tint: string } {
  let k = String(kind ?? "").trim().toLowerCase();
  if (k === "news" && SCHOLARLY_SOURCES.has(String(source ?? "").trim().toLowerCase())) k = "paper";
  return FEED_TAG[k] ?? { tag: k ? k[0].toUpperCase() + k.slice(1) : "Update", tint: "other" };
}

// Source codes the Explore backend stores in community_feed_items.source.
const SOURCE_NAMES: Record<string, string> = {
  openalex: "OpenAlex",
  pubmed: "PubMed",
  crossref: "Crossref",
  europepmc: "Europe PMC",
  biorxiv: "bioRxiv",
  medrxiv: "medRxiv",
  clinicaltrials: "ClinicalTrials.gov",
  grants_gov: "Grants.gov",
  geo: "GEO",
  github: "GitHub",
  chembl: "ChEMBL",
  opentargets: "Open Targets",
  openfda: "openFDA",
  pager: "PAGER",
  biopharmadive: "BioPharma Dive",
  statnews: "STAT News",
  endpoints: "Endpoints News",
};

/** A readable source name: known codes are mapped, anything else is
 *  de-snaked and capitalised ("some_source" -> "Some source"). Already-readable
 *  names ("PubMed") pass through untouched. */
export function sourceName(source: string | null | undefined): string | null {
  const raw = String(source ?? "").trim();
  if (!raw) return null;
  const known = SOURCE_NAMES[raw.toLowerCase().replace(/[\s.-]+/g, "_")] ?? SOURCE_NAMES[raw.toLowerCase()];
  if (known) return known;
  if (/[A-Z]/.test(raw) || /\s/.test(raw)) return raw;
  const t = raw.replace(/[_-]+/g, " ");
  return t[0].toUpperCase() + t.slice(1);
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** The item's own date if it is a real date that is not in the future; else null. */
function pastDate(iso: string | null | undefined, now: number): string | null {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) && ms <= now ? (iso as string) : null;
}

/** "PHASE2" -> "Phase 2", "PHASE1/PHASE2" -> "Phase 1/2", "EARLY_PHASE1" -> "Early phase 1". */
export function phaseLabel(phase: string | null | undefined): string {
  const parts = String(phase ?? "")
    .split(/[\/,|]/)
    .map((p) => p.trim())
    .filter((p) => p && p.toUpperCase() !== "NA" && p.toUpperCase() !== "N/A");
  if (parts.length === 0) return "";
  const nums = parts.map((p) => /(\d)\s*$/.exec(p)?.[1]).filter(Boolean) as string[];
  if (nums.length === parts.length) {
    const early = parts.every((p) => /^early/i.test(p));
    return `${early ? "Early phase" : "Phase"} ${nums.join("/")}`;
  }
  return parts.join("/").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

/** "RECRUITING" -> "Recruiting", "ACTIVE_NOT_RECRUITING" -> "Active not recruiting". */
export function statusLabel(status: string | null | undefined): string {
  const t = String(status ?? "").replace(/_/g, " ").trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/** The small line under a feed item's title (after the source). A trial shows
 *  its status and phase, not a date (its dates are start dates, often in the
 *  future). Anything else shows its own published date, and never a future or
 *  missing one: then nothing. */
export function feedDateLabel(
  kind: string,
  publishedAt: string | null | undefined,
  raw: Record<string, unknown> | null | undefined,
  now: number = Date.now()
): string {
  if (kind === "trial") {
    const status = statusLabel(typeof raw?.overall_status === "string" ? raw.overall_status : null);
    const phase = phaseLabel(typeof raw?.phase === "string" ? raw.phase : null);
    return [status, phase].filter(Boolean).join(" · ");
  }
  return shortDate(pastDate(publishedAt, now));
}

/** Announcements and Explore feed items in one stream, newest first by the
 *  item's OWN date: an announcement's posted time, a feed item's published_at.
 *  (Not fetched_at: a feed Refresh re-inserts every item, so they all share it.)
 *  An item with no published date, or one dated in the future (a trial's start
 *  date), goes AFTER every dated item, in the order it arrived. */
export function buildUpdates(
  announcements: Pick<Announcement, "id" | "title" | "body" | "created_at">[],
  feedItems: Pick<CommunityFeedItem, "id" | "kind" | "title" | "url" | "summary" | "source" | "published_at" | "raw">[],
  limit = 12,
  now: number = Date.now()
): UpdateEntry[] {
  const rows: UpdateEntry[] = [
    ...announcements.map((a) => ({
      id: `a:${a.id}`,
      type: "announcement" as const,
      tag: "Announcement",
      tint: "community",
      title: a.title,
      body: clip(a.body ?? "", 220) || null,
      url: null,
      source: null,
      at: a.created_at,
      dateLabel: shortDate(a.created_at),
    })),
    ...feedItems.map((f) => ({
      id: `f:${f.id}`,
      type: "feed" as const,
      ...feedTag(f.kind, f.source),
      title: f.title,
      body: f.summary ? clip(f.summary, 220) : null,
      url: f.url && /^https?:\/\//i.test(f.url) ? f.url : null,
      source: sourceName(f.source),
      // The sort key: only a real, non-future date counts as dated.
      at: pastDate(f.published_at, now),
      dateLabel: feedDateLabel(f.kind, f.published_at, f.raw, now),
    })),
  ];
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const A = a.r.at ? Date.parse(a.r.at) : NaN;
      const B = b.r.at ? Date.parse(b.r.at) : NaN;
      const aOk = Number.isFinite(A), bOk = Number.isFinite(B);
      if (aOk && bOk && A !== B) return B - A;
      if (aOk !== bOk) return aOk ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.r)
    .slice(0, limit);
}

// ── members working on ───────────────────────────────────────────────────────

/** Members who set a focus, as name + focus. Hidden members never appear. */
export function membersWorkingOn(
  roster: Pick<MemberRosterEntry, "member_id" | "display_name" | "focus" | "hidden">[],
  max = 6
): { id: string; name: string; focus: string }[] {
  return roster
    .filter((m) => !m.hidden && m.focus && m.focus.trim())
    .slice(0, max)
    .map((m) => ({ id: m.member_id, name: m.display_name, focus: (m.focus as string).trim() }));
}
