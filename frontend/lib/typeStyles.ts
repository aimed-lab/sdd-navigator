// Design tokens and small pure helpers for the editorial Explore look (and the
// homepage's "Live on the network today" tiles). One place for the per-type
// tints. The colors live as CSS variables in app/globals.css (:root, --type-*),
// and this file refers to them, so a restyle is a one-file change.
//
// Brand green is for actions only (buttons, active chips, links). Nothing here
// uses it to decorate content.
//
// Safe for server and client components (no React, no browser-only APIs).

import type { ExploreItem } from "@/types/explore";

export type TypeKey = "paper" | "dataset" | "tool" | "news" | "podcast" | "community" | "other";

export const TYPE_STYLES: Record<TypeKey, { label: string; bg: string; fg: string }> = {
  paper: { label: "Paper", bg: "var(--type-paper-bg)", fg: "var(--type-paper-fg)" },
  dataset: { label: "Dataset", bg: "var(--type-dataset-bg)", fg: "var(--type-dataset-fg)" },
  tool: { label: "Tool", bg: "var(--type-tool-bg)", fg: "var(--type-tool-fg)" },
  news: { label: "News", bg: "var(--type-news-bg)", fg: "var(--type-news-fg)" },
  podcast: { label: "Podcast", bg: "var(--type-podcast-bg)", fg: "var(--type-podcast-fg)" },
  community: { label: "Community", bg: "var(--type-community-bg)", fg: "var(--type-community-fg)" },
  other: { label: "Resource", bg: "var(--type-other-bg)", fg: "var(--type-other-fg)" },
};

/** Short label for a result's type, including the niche kinds that share the
 *  neutral tint. */
const KIND_LABELS: Record<string, string> = {
  geneset: "Gene set",
  compound: "Compound",
  target: "Target evidence",
  trial: "Clinical trial",
  person: "Person",
  resource: "Lab resource",
  grant: "Grant",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? TYPE_STYLES[typeKeyForKind(kind)].label;
}

/** Maps an ExploreItem.kind to its visual type. */
export function typeKeyForKind(kind: string): TypeKey {
  switch (kind) {
    case "paper":
      return "paper";
    case "dataset":
      return "dataset";
    case "tool":
      return "tool";
    case "news":
      return "news";
    case "episode":
      return "podcast";
    case "communities":
      return "community";
    default:
      return "other";
  }
}

// ---------------------------------------------------------------------------
// Dates: shown only when present and not in the future, as muted relative text.
// ---------------------------------------------------------------------------

function validDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return null; // epoch/placeholder
  if (d.getTime() > Date.now()) return null; // never show a future date
  return d;
}

/** "5m ago", "3h ago", "2d ago", else "Oct 2" (with the year when it isn't
 *  this year). null when there is no usable date. */
export function relativeTime(iso: string | null | undefined): string | null {
  const d = validDate(iso);
  if (!d) return null;
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Four-digit year, or null. */
export function yearOf(iso: string | null | undefined): string | null {
  const d = validDate(iso);
  return d ? String(d.getFullYear()) : null;
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

/** Publisher name for a news item (the backend puts it in raw.source_name and,
 *  for RSS items, also in summary). null when unknown. */
export function newsSource(item: ExploreItem): string | null {
  const s = item.raw?.source_name;
  if (typeof s === "string" && s.trim()) return s.trim();
  return item.summary?.trim() || null;
}

/** A real summary for a news item, i.e. one that is not just the source name. */
export function newsSummary(item: ExploreItem): string | null {
  const s = item.summary?.trim();
  if (!s) return null;
  const src = newsSource(item);
  return src && s === src ? null : s;
}

// ---------------------------------------------------------------------------
// Papers: authors, venue, year. The backend has no structured fields for these,
// so read them from `raw` (PubMed / OpenAlex / Crossref shapes) and fall back
// to the "Published in X. Authors" summary string it builds.
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;
const asRaw = (v: unknown): Raw | null => (v && typeof v === "object" ? (v as Raw) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function authorNames(item: ExploreItem): string[] {
  const raw = item.raw ?? {};
  // PubMed: authors: [{ name }]
  if (Array.isArray(raw.authors)) {
    const names = raw.authors.map((a) => str(asRaw(a)?.name)).filter((n): n is string => !!n);
    if (names.length) return names;
  }
  // OpenAlex: authorships: [{ author: { display_name } }]
  if (Array.isArray(raw.authorships)) {
    const names = raw.authorships
      .map((a) => str(asRaw(asRaw(a)?.author)?.display_name))
      .filter((n): n is string => !!n);
    if (names.length) return names;
  }
  // Crossref: author: [{ given, family }]
  if (Array.isArray(raw.author)) {
    const names = raw.author
      .map((a) => {
        const r = asRaw(a);
        return [str(r?.given), str(r?.family)].filter(Boolean).join(" ");
      })
      .filter(Boolean);
    if (names.length) return names;
  }
  return [];
}

function venueOf(item: ExploreItem): string | null {
  const raw = item.raw ?? {};
  const pm = str(raw.source);
  if (pm && item.id.startsWith("pubmed:")) return pm;
  const oa = str(asRaw(asRaw(raw.primary_location)?.source)?.display_name);
  if (oa) return oa;
  const cr = Array.isArray(raw["container-title"]) ? str(raw["container-title"][0]) : null;
  if (cr) return cr;
  return null;
}

/** "Smith et al." for two or more authors; a lone author stays as is. */
export function shortAuthors(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names[0]} et al.`;
}

export function paperMeta(item: ExploreItem): {
  authors: string | null;
  venue: string | null;
  year: string | null;
} {
  let authors = shortAuthors(authorNames(item));
  let venue = venueOf(item);

  // Fallback: the summary the backend builds, "Published in <venue>. <authors>".
  if ((!authors || !venue) && item.summary) {
    const m = item.summary.match(/^Published in (.+?)\.(?:\s+(.*))?$/);
    if (m) {
      venue = venue ?? m[1].trim();
      if (!authors && m[2]) {
        const first = m[2].split(",")[0].trim();
        authors = first ? (m[2].includes(",") || /et al\.?$/.test(m[2]) ? `${first} et al.` : first) : null;
      }
    }
  }
  return { authors, venue, year: yearOf(item.date_iso) };
}
