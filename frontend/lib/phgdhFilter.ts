// Relevance helpers for the /phgdh collection page. The explore backend returns
// whatever the sources match for "PHGDH", including papers and datasets that are
// not about it, so the page keeps only items whose own text mentions PHGDH (or
// phosphoglycerate dehydrogenase), orders the neuro-related ones first, and
// never pads a short list. Pure functions, nothing invented: everything is read
// from the item's own title and text.

import type { ExploreItem } from "@/types/explore";

const PHGDH = /phgdh|phosphoglycerate dehydrogenase/i;
const NEURO = /alzheimer|amyloid|neurodegenerat/i;
const KEY_FINDING_NEURO = /alzheimer|amyloid/i;

const textOf = (i: ExploreItem): string => {
  const abstract = typeof i.raw?.abstract === "string" ? (i.raw.abstract as string) : "";
  return [i.title, i.summary ?? "", abstract].join(" ");
};

export const mentionsPhgdh = (i: ExploreItem) => PHGDH.test(textOf(i));
export const mentionsNeuro = (i: ExploreItem) => NEURO.test(textOf(i));

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------------------------------------------------------------------------
// Notices: corrections, retractions and the like are not findings.
// ---------------------------------------------------------------------------

const NOTICE_PREFIXES = [
  "correction",
  "erratum",
  "corrigendum",
  "retraction",
  "expression of concern",
  "withdrawn",
];

/** True for a correction/erratum/corrigendum/retraction/expression-of-concern/
 *  withdrawn notice: title starts with one of those words, case-insensitive,
 *  ignoring any leading punctuation or brackets. */
export function isNotice(item: ExploreItem): boolean {
  const t = item.title.replace(/^[^a-z0-9]+/i, "").toLowerCase();
  return NOTICE_PREFIXES.some((p) => t.startsWith(p));
}

// ---------------------------------------------------------------------------
// Title series suffixes: "Title, 2." / "Title 2" / "Title (2)" / "Title [part 2]"
// are the same record as "Title" (PubMed/GEO split one record into numbered
// parts). seriesKey strips them (and trailing punctuation) for comparison.
// ---------------------------------------------------------------------------

// A bare trailing number is NOT a series suffix after words where a number is
// part of the name ("Phase 2", "Type 2", "IL 2", ...).
const NUMBER_IS_NAME = /\b(phase|stage|type|grade|class|group|cohort|arm|study|trial|il|cd|factor|chromosome|complex|vitamin|covid|sars-cov|tgf|igf|fgf|hsp|bcl|sirt|h|p)$/i;

export function seriesKey(title: string): string {
  let t = title.toLowerCase().trim();
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t
      .replace(/[\s,;:.\-]*\[\s*part\s*\d+\s*\]$/, "")
      .replace(/[\s,;:.\-]*\(\s*\d+\s*\)$/, "")
      .replace(/[\s,;:.\-]*\bpart\s*\d+[\s.]*$/, "");
    const bare = t.match(/^(.*?)[\s,;:]+\d{1,2}[\s.]*$/);
    if (bare && !NUMBER_IS_NAME.test(bare[1].trim())) t = bare[1];
    t = t.replace(/[\s,;:.\-]+$/, "");
    if (t === before) break;
  }
  return normTitle(t);
}

const descLength = (i: ExploreItem) => (i.summary ?? "").length;

/** Merge dataset lists. Repeats collapse (same DOI or same normalized title),
 *  and a numbered-series variant ("Title, 2.") collapses into its base title
 *  when the base is also present. The kept item is the one with the longer
 *  description, in the position of the first one seen. */
export function mergeDatasets(...lists: ExploreItem[][]): ExploreItem[] {
  const all = mergeUniqueKeepLongest(lists.flat());
  const baseKeys = new Set(all.filter((i) => normTitle(i.title) === seriesKey(i.title)).map((i) => seriesKey(i.title)));
  const groups = new Map<string, ExploreItem>();
  const order: string[] = [];
  for (const item of all) {
    const key = seriesKey(item.title);
    const isVariant = normTitle(item.title) !== key;
    // A suffixed title only joins its base's group when the base exists;
    // otherwise it stands alone (so "Phase 2" and "Phase 3" never merge).
    const groupKey = isVariant && baseKeys.has(key) ? key : normTitle(item.title);
    const prev = groups.get(groupKey);
    if (!prev) {
      groups.set(groupKey, item);
      order.push(groupKey);
    } else if (descLength(item) > descLength(prev)) {
      groups.set(groupKey, item);
    }
  }
  return order.map((k) => groups.get(k)!);
}

/** Like mergeUnique, but when two items collide the one with the longer
 *  description is kept (in the first one's position). */
function mergeUniqueKeepLongest(items: ExploreItem[]): ExploreItem[] {
  const out: ExploreItem[] = [];
  const byTitle = new Map<string, number>();
  const byDoi = new Map<string, number>();
  for (const item of items) {
    const doi = item.doi?.toLowerCase().trim();
    const title = normTitle(item.title);
    const at = doi && byDoi.has(doi) ? byDoi.get(doi) : byTitle.get(title);
    if (at !== undefined) {
      if (descLength(item) > descLength(out[at])) out[at] = item;
      continue;
    }
    out.push(item);
    byTitle.set(title, out.length - 1);
    if (doi) byDoi.set(doi, out.length - 1);
  }
  return out;
}

/** Datasets: items with PHGDH / phosphoglycerate dehydrogenase in the TITLE
 *  first, then those that only mention it in the description. Inside each
 *  group: neuro-related first, then the rest, newest first. */
export function rankDatasets(items: ExploreItem[]): ExploreItem[] {
  const inTitle = (i: ExploreItem) => PHGDH.test(i.title);
  return [
    ...rankByNeuroThenDate(items.filter(inTitle)),
    ...rankByNeuroThenDate(items.filter((i) => !inTitle(i))),
  ];
}

/** Merge lists, dropping repeats: same DOI, else same normalized title. */
export function mergeUnique(...lists: ExploreItem[][]): ExploreItem[] {
  const seenDoi = new Set<string>();
  const seenTitle = new Set<string>();
  const out: ExploreItem[] = [];
  for (const item of lists.flat()) {
    const doi = item.doi?.toLowerCase().trim();
    const title = normTitle(item.title);
    if ((doi && seenDoi.has(doi)) || seenTitle.has(title)) continue;
    if (doi) seenDoi.add(doi);
    seenTitle.add(title);
    out.push(item);
  }
  return out;
}

const time = (i: ExploreItem) => {
  const t = i.date_iso ? new Date(i.date_iso).getTime() : NaN;
  return isNaN(t) ? 0 : t;
};

/** Neuro-related first, then the rest; newest first within each group. */
export function rankByNeuroThenDate(items: ExploreItem[]): ExploreItem[] {
  const byDate = (a: ExploreItem, b: ExploreItem) => time(b) - time(a);
  return [
    ...items.filter(mentionsNeuro).sort(byDate),
    ...items.filter((i) => !mentionsNeuro(i)).sort(byDate),
  ];
}

const citations = (i: ExploreItem) =>
  i.signal?.metric === "citations" && typeof i.signal.value === "number" ? i.signal.value : 0;

/** The single best "key finding": a paper or dataset whose TITLE contains PHGDH
 *  and Alzheimer/amyloid. Most cited first (when the source reports it), then
 *  newest. null when none qualifies. */
export function pickKeyFinding(items: ExploreItem[]): ExploreItem | null {
  const candidates = items.filter(
    (i) => /phgdh/i.test(i.title) && KEY_FINDING_NEURO.test(i.title)
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => citations(b) - citations(a) || time(b) - time(a))[0];
}
