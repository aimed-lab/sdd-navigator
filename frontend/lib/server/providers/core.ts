// Service Providers directory: the pure part. Types, plain-word category
// labels, the client-side search filter, key-fact rules, the tracked website
// link, and "similar providers". No I/O and no next/* imports, so a client
// component can import it and node --test can run it.

import { SYNONYM_GROUPS } from "./synonyms.ts";

export type KeyFact = { value: string; label: string };

export type Provider = {
  slug: string;
  name: string;
  category: string;
  services: string[];
  description: string;
  website: string;
  email: string;
  phone: string;
  location: string;
  event: string;
  key_facts: KeyFact[];
  key_facts_source: string;
  cover: string;
  brochure_pages: string[];
};

/** Category names in the data file -> plain words shown on the site. */
export const CATEGORY_LABEL: Record<string, string> = {
  "CRO - Chemistry": "Chemistry CRO",
  "AI/Software": "AI & software",
  "Reagents/Consumables": "Reagents & proteins",
  "CDMO/Manufacturing": "Manufacturing",
  "CRO - Biology/Assays": "Biology & structure",
  "Lab Instruments/Equipment": "Instruments",
  Other: "Other",
};

/** Order the category chips appear in. */
export const CATEGORY_ORDER = Object.keys(CATEGORY_LABEL);

/** The key the label table knows this category by ("Other" for anything new). */
export function categoryKey(category: string): string {
  return category in CATEGORY_LABEL ? category : "Other";
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[categoryKey(category)];
}

/** Chips: only categories that have providers, with counts, in a fixed order. */
export function categoryCounts(
  providers: { category: string }[]
): { category: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of providers) {
    const key = categoryKey(p.category);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({
    category: c,
    label: CATEGORY_LABEL[c],
    count: counts.get(c) ?? 0,
  }));
}

function words(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

type Clause = { plain: string | null; alts: string[] };

// Terms as token lists, longest first, each pointing at its group's terms.
const TERMS = SYNONYM_GROUPS.flatMap((g) => {
  const terms = g.map((t) => words(t).join(" ")).filter(Boolean);
  return terms.map((t) => ({ tokens: t.split(" "), terms }));
}).sort((a, b) => b.tokens.length - a.tokens.length);

/** The query as clauses: a word (or phrase) that is in a synonym group becomes
 *  "any of the group's terms"; anything else stays a plain word. */
function clauses(query: string): Clause[] {
  const ws = words(query);
  const out: Clause[] = [];
  for (let i = 0; i < ws.length; ) {
    const hit = TERMS.find((t) => t.tokens.every((tok, k) => ws[i + k] === tok));
    if (hit) {
      out.push({ plain: null, alts: hit.terms });
      i += hit.tokens.length;
    } else {
      out.push({ plain: ws[i], alts: [] });
      i += 1;
    }
  }
  return out;
}

/** "What do you need done?": every word typed must appear in the name, the
 *  services or the description (any order), or one of its synonyms must (see
 *  synonyms.ts). Synonyms match whole words / word starts, so "ai" does not
 *  match "main". An empty search matches all. */
export function matchesQuery(
  p: Pick<Provider, "name" | "services" | "description">,
  query: string
): boolean {
  const cs = clauses(query);
  if (cs.length === 0) return true;
  const hay = words([p.name, ...p.services, p.description].join(" ")).join(" ");
  const padded = ` ${hay} `;
  return cs.every((c) =>
    c.plain !== null
      ? hay.includes(c.plain)
      : c.alts.some((a) => padded.includes(a.length <= 3 ? ` ${a} ` : ` ${a}`))
  );
}

export function filterProviders<T extends Pick<Provider, "name" | "services" | "description" | "category">>(
  providers: T[],
  query: string,
  category: string | null
): T[] {
  return providers.filter((p) => (!category || categoryKey(p.category) === category) && matchesQuery(p, query));
}

/** The facts to show: only complete ones. An empty list means no strip at all. */
export function visibleKeyFacts(p: Pick<Provider, "key_facts">): KeyFact[] {
  return (p.key_facts ?? []).filter((f) => f && String(f.value ?? "").trim() && String(f.label ?? "").trim());
}

/** Providers in the same category, never the provider itself, up to `limit`. */
export function similarProviders<T extends Pick<Provider, "slug" | "category">>(
  all: T[],
  current: Pick<Provider, "slug" | "category">,
  limit = 3
): T[] {
  return all.filter((p) => p.slug !== current.slug && p.category === current.category).slice(0, limit);
}

/** The location, or "N services" when the brochure gave none. */
export function cardFooterText(p: Pick<Provider, "location" | "services">): string {
  const loc = (p.location ?? "").trim();
  if (loc) return loc;
  const n = p.services.length;
  return `${n} ${n === 1 ? "service" : "services"}`;
}

/** The provider's own website with utm tags added, or null when it has no
 *  usable http(s) website. The ONLY address the tracked link ever points to is
 *  the website from the data file. */
export function trackedWebsiteUrl(p: Pick<Provider, "website">): string | null {
  const raw = (p.website ?? "").trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.searchParams.set("utm_source", "smartdrugdiscovery");
  u.searchParams.set("utm_medium", "directory");
  return u.toString();
}

/** Only the path of a Referer header (no host, no query), cut to 200 chars. */
export function referrerPath(referer: string | null | undefined): string {
  if (!referer) return "";
  try {
    return new URL(referer).pathname.slice(0, 200);
  } catch {
    return "";
  }
}

// ── admin activity summary ──────────────────────────────────────────────────

export type ProviderEventRow = { slug: string; event: string; created_at: string };
export type ActivityRow = { slug: string; views: number; clicks: number };

/** Views and website clicks per provider for the last `days` days; every
 *  provider appears (zeros included), busiest first. */
export function summarizeActivity(
  slugs: string[],
  events: ProviderEventRow[],
  now: Date = new Date(),
  days = 30
): ActivityRow[] {
  const since = now.getTime() - days * 24 * 60 * 60 * 1000;
  const rows = new Map<string, ActivityRow>(slugs.map((s) => [s, { slug: s, views: 0, clicks: 0 }]));
  for (const e of events) {
    if (new Date(e.created_at).getTime() < since) continue;
    const r = rows.get(e.slug);
    if (!r) continue;
    if (e.event === "profile_view") r.views += 1;
    else if (e.event === "website_click") r.clicks += 1;
  }
  return [...rows.values()].sort((a, b) => b.views + b.clicks - (a.views + a.clicks) || a.slug.localeCompare(b.slug));
}

// ── dates ────────────────────────────────────────────────────────────────────

/** A timestamp in Chicago time, like "Oct 22, 1:46 AM". */
export function formatChicago(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(d)
    .replace(/\s/g, " ");
}
