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
