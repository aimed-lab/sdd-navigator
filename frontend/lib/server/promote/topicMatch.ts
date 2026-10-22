// lib/server/promote/topicMatch.ts — which living (topic) page and which
// community best match a Promote item, for its "Follow the topic" box. Pure; the
// lists come from followTopic.ts.
//
// WHY THIS IS NOT THE ASSISTANT'S MATCHER. The assistant looks for a community
// for a SHORT topic ("KRAS in pancreatic cancer") and demands that 60% of the
// words match. An item's headline and tags are a dozen words long, so that
// threshold can never be met and nothing was ever found; and narrowing the page
// query to the item's four LONGEST words dropped short, distinctive terms such
// as "PHGDH". Both are replaced here:
//   - pages: every public page is scored, with words that appear in few pages
//     counting more than words that appear in many;
//   - communities: ranked with no coverage floor, accepted on a name or topic
//     hit on a distinctive word.

import { rankCommunities, type RankableCommunity } from "../assistant/communityMatch.ts";

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "our", "your", "their", "new", "how", "why",
  "what", "who", "are", "was", "were", "has", "have", "had", "not", "but", "can", "now", "all", "more",
  "research", "study", "paper", "lab", "team", "using", "use", "based", "results", "data",
  "first", "pilot", "validates", "validated", "validate", "open", "launches", "announces", "shows", "show",
]);

export function topicWords(text: string): string[] {
  const out = new Set<string>();
  for (const w of (text ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (w.length >= 4 && !STOP.has(w)) out.add(w);
  }
  return [...out];
}

export type TopicPage = { slug: string; title: string; seed?: string | null };

/** Accepted when a page scores at least this: one word found in only a few pages,
 *  or several in more. */
export const PAGE_MIN_SCORE = 3;

/** The page that shares the most distinctive words with the item, or null. */
export function bestTopicPage(itemText: string, pages: TopicPage[]): TopicPage | null {
  const words = topicWords(itemText);
  if (words.length === 0 || pages.length === 0) return null;

  const hays = pages.map((p) => ({
    page: p,
    hay: new Set(topicWords(`${p.title} ${p.seed ?? ""}`)),
    title: new Set(topicWords(p.title)),
  }));
  // A word found in few pages says more than one found in most of them.
  const weight = (w: string): number => {
    const df = hays.filter((h) => h.hay.has(w)).length;
    return df === 0 ? 0 : df <= 3 ? 3 : df <= 10 ? 2 : 1;
  };
  const weights = new Map(words.map((w) => [w, weight(w)]));

  let best: { page: TopicPage; score: number } | null = null;
  for (const h of hays) {
    let score = 0;
    for (const w of words) {
      if (h.hay.has(w)) score += (weights.get(w) ?? 0) + (h.title.has(w) ? 1 : 0);
    }
    if (score >= PAGE_MIN_SCORE && (!best || score > best.score)) best = { page: h.page, score };
  }
  return best ? best.page : null;
}

export type CommunityChoice<T> = { community: T; score: number; matched: string[] };

/** The community that best matches the item's headline and tags: ranked with no
 *  coverage floor, and accepted only when the top one scores at least 2 (a topic
 *  or name hit, not a stray mention in the purpose text). */
export function bestCommunity<T extends RankableCommunity>(
  text: string,
  communities: T[]
): CommunityChoice<T> | null {
  const query = topicWords(text).join(" ");
  if (!query) return null;
  const top = rankCommunities(query, communities, { minCoverage: 0, limit: 1 })[0];
  return top && top.score >= 2 ? { community: top.community, score: top.score, matched: top.matched } : null;
}
