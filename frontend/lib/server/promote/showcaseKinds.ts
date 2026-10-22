// lib/server/promote/showcaseKinds.ts — the pure rules behind the redesigned
// Promote: the thirteen item types, how older rows map onto them, each type's
// three labelled key facts, its main button, and the small derivations the
// cards need (funding amount, before/now line, event date badge, which story
// is featured).
//
// No imports, so `npm test` covers it and client components may use it.
// lib/showcaseTypes.ts re-exports the type list and labels from here.

export const SHOWCASE_TYPES = [
  "paper",
  "preprint",
  "talk",
  "poster",
  "event",
  "achievement",
  "breakthrough",
  "partnership",
  "funding",
  "tool",
  "service",
  "dataset",
  "other",
] as const;
export type ShowcaseType = (typeof SHOWCASE_TYPES)[number];

export const SHOWCASE_TYPE_LABEL: Record<ShowcaseType, string> = {
  paper: "Paper",
  preprint: "Preprint",
  talk: "Talk & slides",
  poster: "Poster",
  event: "Event",
  achievement: "Achievement",
  breakthrough: "Breakthrough",
  partnership: "Partnership",
  funding: "Funding win",
  tool: "Tool & app",
  service: "Service",
  dataset: "Dataset",
  other: "Something else",
};

/** Values a row may still carry from before this list: the picker that had
 *  "award", and the older case_study / white_paper / achievement set. They stay
 *  valid in the database; this maps them onto a current type when read. */
export const LEGACY_TYPE_MAP: Record<string, ShowcaseType> = {
  award: "achievement",
  case_study: "achievement",
  white_paper: "paper",
};

/** Any stored `type` value -> one of the thirteen. Unknown or missing -> "other". */
export function canonicalType(raw: string | null | undefined): ShowcaseType {
  const v = (raw ?? "").trim();
  if ((SHOWCASE_TYPES as readonly string[]).includes(v)) return v as ShowcaseType;
  return LEGACY_TYPE_MAP[v] ?? "other";
}

/** True when a stored `type` value belongs to this filter chip. */
export function matchesType(raw: string | null | undefined, filter: ShowcaseType | "all"): boolean {
  return filter === "all" || canonicalType(raw) === filter;
}

// ── key facts ────────────────────────────────────────────────────────────────

export type KeyFact = { label: string; value: string };

export const KEY_FACT_LABELS: Record<ShowcaseType, [string, string, string]> = {
  paper: ["The question", "What we did", "What we found"],
  preprint: ["The question", "What we did", "What we found"],
  talk: ["Topic", "Where & when", "Key takeaway"],
  poster: ["Topic", "Where & when", "Key takeaway"],
  event: ["What", "When & where", "Who should come"],
  achievement: ["What", "Who", "Why it matters"],
  breakthrough: ["The problem", "What changed", "What it means"],
  partnership: ["Partners", "Goal", "What it means for researchers"],
  funding: ["Funder", "Amount & length", "What it funds"],
  tool: ["What it does", "Before vs now", "Who it's for"],
  service: ["What we offer", "Who it's for", "How to request"],
  dataset: ["What's in it", "Size & format", "How to use"],
  other: ["What it is", "Why it matters", "What's next"],
};

/** The editor's limit for one fact value. */
export const MAX_FACT_CHARS = 90;
/** A safety cap when reading stored values (older items allowed up to 200). Values
 *  are never cut for display. */
const STORED_FACT_CAP = 200;

/** Three labelled facts for the type, with the given values (blank when absent). */
export function defaultKeyFacts(type: ShowcaseType, values: string[] = []): KeyFact[] {
  return KEY_FACT_LABELS[type].map((label, i) => ({ label, value: (values[i] ?? "").trim() }));
}

/** Stored jsonb (or anything) -> exactly three facts for this type. A missing
 *  or malformed value gives the blank defaults; a stored label is kept when it
 *  is a non-empty string, otherwise the type's label is used. */
export function normalizeKeyFacts(type: ShowcaseType, raw: unknown): KeyFact[] {
  const base = defaultKeyFacts(type);
  if (!Array.isArray(raw)) return base;
  return base.map((fallback, i) => {
    const r = raw[i];
    if (!r || typeof r !== "object") return fallback;
    const o = r as Record<string, unknown>;
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 60) : fallback.label;
    const value = typeof o.value === "string" ? o.value.trim().slice(0, STORED_FACT_CAP) : "";
    return { label, value };
  });
}

/** Facts worth showing: those with a value. */
export function visibleFacts(facts: KeyFact[]): KeyFact[] {
  return facts.filter((f) => f.value.trim() !== "");
}

/** First sentence of some prose, cut at a word edge to `max` characters. */
export function firstSentence(text: string, max = 150): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const m = clean.match(/^(.+?[.!?])(\s|$)/);
  const s = m ? m[1] : clean;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "") + "…";
}

/** The facts to show for a row: ONLY what is stored. An item with none stored
 *  has no fact strip (the author, or the "Suggest key facts" button, fills them);
 *  nothing is derived from the article text for display. */
export function factsForRow(type: ShowcaseType, stored: unknown): KeyFact[] {
  return visibleFacts(normalizeKeyFacts(type, stored));
}

// ── the main button ──────────────────────────────────────────────────────────

export const CTA_DEFAULT_LABEL: Record<ShowcaseType, string> = {
  paper: "Read the paper",
  preprint: "Read the paper",
  talk: "View slides",
  poster: "Read more",
  event: "Register",
  achievement: "Read more",
  breakthrough: "Read more",
  partnership: "Learn more",
  funding: "Learn more",
  tool: "Try it",
  service: "Request this service",
  dataset: "Get the data",
  other: "Learn more",
};

export const CTA_LABEL_CHOICES = [
  "Read the paper",
  "View slides",
  "Register",
  "Read more",
  "Learn more",
  "Try it",
  "Request this service",
  "Get the data",
] as const;

export type Cta = { label: string; url: string };

/** The main button: the author's own label and link when set; else the type's
 *  default label on the best link we have (the DOI for a paper, the external
 *  link, or the fallback such as an attached slide deck). Null when there is
 *  nowhere to send the reader. */
export function resolveCta(
  type: ShowcaseType,
  row: { ctaLabel?: string | null; ctaUrl?: string | null; link?: string | null; doi?: string | null },
  fallbackUrl: string | null = null
): Cta | null {
  const label = (row.ctaLabel ?? "").trim() || CTA_DEFAULT_LABEL[type];
  const doi = (row.doi ?? "").trim();
  const url =
    safeHttpUrl(row.ctaUrl) ??
    (doi ? `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}` : null) ??
    safeHttpUrl(row.link) ??
    safeHttpUrl(fallbackUrl);
  return url ? { label, url } : null;
}

/** Only http(s) links are ever offered as buttons. */
export function safeHttpUrl(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The first http(s) link written in some text (an article body), or null. */
export function firstLinkIn(text: string | null | undefined): string | null {
  const m = (text ?? "").match(/https?:\/\/[^\s<>"')\]]+/i);
  if (!m) return null;
  return safeHttpUrl(m[0].replace(/[.,;:!?]+$/, ""));
}

// ── card details ─────────────────────────────────────────────────────────────

/** The amount in a funding win's "Amount & length" fact: "$1.2M over 3 years"
 *  -> "$1.2M". Null when the text carries no amount. */
export function fundingAmount(facts: KeyFact[]): string | null {
  const text = facts[1]?.value ?? "";
  const m = text.match(/(?:[$€£]\s?\d[\d,.]*\s?(?:million|billion|thousand|[kKmMbB]\b)?|\d[\d,.]*\s?(?:million|billion|thousand|[kKmMbB]\b)\s?(?:USD|EUR|GBP|dollars|euros|pounds)?)/);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

/** A tool's "Before vs now" fact as a one-line "Before … → Now …" for its card. */
export function beforeNowLine(facts: KeyFact[]): string | null {
  const v = (facts[1]?.value ?? "").trim();
  return v || null;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** The month / day for an event card's date badge, in UTC. */
export function eventBadge(iso: string | null | undefined): { month: string; day: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { month: MONTHS[d.getUTCMonth()], day: String(d.getUTCDate()) };
}

// ── featured story ───────────────────────────────────────────────────────────

/** Which entry opens the front page: the newest one an admin featured, else the
 *  newest. Entries are expected newest first (as listShowcase returns them). */
export function pickFeatured<T extends { featured: boolean }>(entries: T[]): T | null {
  return entries.find((e) => e.featured) ?? entries[0] ?? null;
}
