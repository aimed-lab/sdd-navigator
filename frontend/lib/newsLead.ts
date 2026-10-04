// Picks which headline leads the Explore news front. Not simply the newest:
// score each title for drug-discovery relevance, skip mainly-political titles
// for the lead slot (they can still appear in the list), and prefer recent
// items. Falls back to the newest item when nothing scores.
//
// Pure functions, safe for client and server.

import type { ExploreItem } from "@/types/explore";

const RELEVANT =
  /\b(fda|approv\w*|trial\w*|phase|drugs?|therap\w*|biotech\w*|pharma\w*|ai|data|target\w*|molecul\w*|antibod\w*|cancer|vaccin\w*|launch\w*|deal|acqui\w*)\b/gi;

const POLITICAL = /\b(trump|biden|elections?|congress\w*|senate|midterms?)\b/i;

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

/** Number of distinct relevance words in the title. */
export function relevanceScore(title: string): number {
  const hits = title.match(RELEVANT) ?? [];
  return new Set(hits.map((h) => h.toLowerCase())).size;
}

export function isPolitical(title: string): boolean {
  return POLITICAL.test(title);
}

const time = (i: ExploreItem): number => {
  const t = i.date_iso ? new Date(i.date_iso).getTime() : NaN;
  return isNaN(t) ? 0 : t;
};

/** Returns the items with the chosen lead first and the rest in their original
 *  order. */
export function withBestLead(items: ExploreItem[]): ExploreItem[] {
  if (items.length < 2) return items;

  const eligible = items.filter((i) => !isPolitical(i.title));
  const now = Date.now();
  const recent = eligible.filter((i) => time(i) > 0 && now - time(i) <= RECENT_MS);
  const pool = recent.length > 0 ? recent : eligible;

  let lead: ExploreItem | undefined;
  let best = 0;
  for (const i of pool) {
    const s = relevanceScore(i.title);
    // Higher score wins; ties go to the newer item.
    if (s > best || (s === best && s > 0 && lead && time(i) > time(lead))) {
      best = s;
      lead = i;
    }
  }

  // Nothing scored: newest non-political item, or just the newest item.
  if (!lead) {
    const byNewest = (list: ExploreItem[]) =>
      [...list].sort((a, b) => time(b) - time(a))[0];
    lead = byNewest(eligible) ?? byNewest(items);
  }
  if (!lead) return items;
  return [lead, ...items.filter((i) => i !== lead)];
}
