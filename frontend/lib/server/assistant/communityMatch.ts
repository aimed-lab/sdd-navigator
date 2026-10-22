// lib/server/assistant/communityMatch.ts — ranking communities for a topic, and
// saying WHY one matched ("Matches: pancreatic cancer, KRAS"). Pure, so
// `npm test` covers it; used by searchCommunities (lib/server/communities.ts),
// the assistant's "find or create a community" step and the agent's
// search_communities tool.
//
// Ranking, best first:
//   * a community that matches MORE of the query's distinctive words wins;
//   * a word in the NAME counts more than one in a topic, and a topic more than
//     one in the purpose text;
//   * words that sit side by side in the query ("pancreatic cancer") and also
//     side by side in the community get a bonus, so a phrase match outranks two
//     unrelated single-word hits.
// The assistant also asks for a minimum coverage, so a community that only
// shares "cancer" with "pancreatic cancer KRAS" is not offered as a match.

import { GENERIC_SCIENCE_STOPWORDS } from "../genericScienceStopwords.ts";

const MIN_TOKEN_LENGTH = 3;
// Everyday words that say nothing about a topic ("community on KRAS").
const COMMON_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "how", "what", "about", "into",
  "community", "communities", "group", "new", "create", "find", "join", "want", "need", "like",
]);

export type RankableCommunity = {
  name: string;
  description: string | null;
  explore_topics: string[];
};

export type RankedCommunity<T> = {
  community: T;
  score: number;
  /** Share of the query's words found, 0..1. */
  coverage: number;
  /** Why it matched: phrases first, then single words, in the query's own spelling. */
  matched: string[];
};

type Token = { lower: string; shown: string };

/** The query's distinctive words: lowercase, 3+ letters, not generic science filler. */
export function queryTokens(text: string): Token[] {
  const out: Token[] = [];
  const seen = new Set<string>();
  for (const w of text.match(/[A-Za-z0-9]+/g) ?? []) {
    const lower = w.toLowerCase();
    if (lower.length < MIN_TOKEN_LENGTH || GENERIC_SCIENCE_STOPWORDS.has(lower) || COMMON_WORDS.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    out.push({ lower, shown: w });
  }
  return out;
}

const norm = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" ");

const WEIGHT = { name: 3, topic: 2, description: 1 } as const;

export function rankCommunities<T extends RankableCommunity>(
  query: string,
  communities: T[],
  opts: { minCoverage?: number; limit?: number } = {}
): RankedCommunity<T>[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];

  const ranked = communities.map((community) => {
    const fields = [
      { text: norm(community.name), w: WEIGHT.name },
      ...community.explore_topics.map((t) => ({ text: norm(t), w: WEIGHT.topic })),
      { text: norm(community.description ?? ""), w: WEIGHT.description },
    ];

    let score = 0;
    const found = new Set<string>();
    for (const t of tokens) {
      let best = 0;
      for (const f of fields) if (f.text.includes(t.lower)) best += f.w;
      if (best > 0) found.add(t.lower);
      score += best;
    }

    // Side-by-side words: a bonus for each pair that is also adjacent in a field.
    const phrases: string[] = [];
    for (let i = 0; i < tokens.length; ) {
      let hit = 0;
      for (let j = tokens.length; j - i >= 2; j--) {
        const phrase = tokens.slice(i, j).map((t) => t.lower).join(" ");
        const field = fields.find((f) => f.text.includes(phrase));
        if (field) {
          score += field.w * (j - i - 1) * 2;
          phrases.push(tokens.slice(i, j).map((t) => t.shown).join(" "));
          hit = j - i;
          break;
        }
      }
      i += hit || 1;
    }

    const inPhrase = new Set(phrases.flatMap((p) => p.toLowerCase().split(" ")));
    const singles = tokens.filter((t) => found.has(t.lower) && !inPhrase.has(t.lower)).map((t) => t.shown);

    return {
      community,
      score,
      coverage: found.size / tokens.length,
      matched: [...phrases, ...singles],
    };
  });

  const minCoverage = opts.minCoverage ?? 0;
  const kept = ranked
    .filter((r) => r.score > 0 && r.coverage >= minCoverage)
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage); // stable: ties keep input order
  return opts.limit ? kept.slice(0, opts.limit) : kept;
}

/** What the assistant needs of a community to show a match card. */
export type CommunityMatch = {
  id: string;
  slug: string;
  name: string;
  purpose: string | null;
  memberCount: number;
  isOpen: boolean;
  /** The admin's name, only when this viewer is allowed to see the roster. */
  runBy: string | null;
  /** "Matches: …" terms. */
  why: string[];
  /** The viewer's relationship: drives Join / Request to join / nothing. */
  state: "signed_out" | "none" | "pending" | "active";
};

/** The action a match card offers. Join for an open community, Request to join
 *  otherwise; nothing once the viewer is in or has asked; sign-in when signed out. */
export function matchAction(m: Pick<CommunityMatch, "isOpen" | "state">):
  | { kind: "join" | "request"; label: "Join" | "Request to join" }
  | { kind: "signin"; label: "Sign in to join" | "Sign in to request" }
  | { kind: "none"; label: "Member" | "Request pending" } {
  if (m.state === "signed_out") return { kind: "signin", label: m.isOpen ? "Sign in to join" : "Sign in to request" };
  if (m.state === "active") return { kind: "none", label: "Member" };
  if (m.state === "pending") return { kind: "none", label: "Request pending" };
  return m.isOpen ? { kind: "join", label: "Join" } : { kind: "request", label: "Request to join" };
}

/** The community "People on this" shows: the best match the viewer is NOT a
 *  member of; if every match is one they are already in, the best of those
 *  (shown as "You're a member"). Matches arrive best first. Null when empty. */
export function pickPeopleMatch<T extends Pick<CommunityMatch, "state">>(matches: T[]): T | null {
  return matches.find((m) => m.state !== "active") ?? matches[0] ?? null;
}

export const MATCH_MIN_COVERAGE = 0.6;
export const MATCH_LIMIT = 3;
