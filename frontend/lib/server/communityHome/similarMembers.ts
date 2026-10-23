// lib/server/communityHome/similarMembers.ts — "members working on similar
// things": compare what the viewer works on with what each other member works
// on, by plain word overlap. No LLM and no network.
//
// WHAT COUNTS AS "WHAT SOMEONE WORKS ON": their focus line in this community,
// plus the titles and seed topics of wiki pages they own. For the viewer that
// is everything they own (their own private pages are theirs to use); for any
// other member it is only what the caller passes in, which is the roster and
// page rows the viewer is already allowed to read (public_preview rules, public
// or team-readable pages). This module never fetches anything and has no field
// for an email, so it cannot leak one.
//
// WORDS: the assistant's community tokenizer (queryTokens in
// assistant/communityMatch.ts): lowercase, 3+ letters, minus the generic science
// stopwords (genericScienceStopwords.ts) and everyday filler.
//
// No runtime imports beyond that tokenizer, so `npm test` covers it.

import { queryTokens } from "../assistant/communityMatch.ts";

export type Workings = {
  /** The focus line the member set in this community. */
  focus: string | null;
  /** Titles and seed topics of their wiki pages (only the ones the viewer may see). */
  pageTexts: string[];
};

export type SimilarCandidate = Workings & { id: string; name: string };

export type SimilarMember = {
  id: string;
  name: string;
  focus: string | null;
  /** Higher is closer; 0 never appears in a result. */
  score: number;
  /** The shared words, as phrases in the viewer's own spelling. */
  shared: string[];
  /** "Both: KRAS, pancreatic cancer" */
  reason: string;
};

const MAX_REASON_PHRASES = 4;

const clean = (s: string | null | undefined) => (s ?? "").trim();

/** Does the viewer have a focus line? Similarity is only offered when they do. */
export function hasFocus(focus: string | null | undefined): boolean {
  return clean(focus).length > 0;
}

function wordSet(texts: string[]): Set<string> {
  return new Set(texts.flatMap((t) => queryTokens(t).map((x) => x.lower)));
}

/** "Both: KRAS, pancreatic cancer". */
export function reasonLine(shared: string[]): string {
  return shared.length > 0 ? `Both: ${shared.join(", ")}` : "";
}

/** The shared words as phrases: words that sit side by side in the viewer's own
 *  text stay together ("pancreatic cancer"), a stopword or punctuation breaks
 *  the run. Order follows the viewer's text, focus first. */
export function sharedPhrases(mine: Workings, shared: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const texts = [clean(mine.focus), ...mine.pageTexts.map(clean)].filter(Boolean);
  const usable = new Set(queryTokens(texts.join(" ")).map((t) => t.lower)); // the same filter as scoring
  for (const text of texts) {
    // Split into runs at anything that is not a counted shared word.
    let run: string[] = [];
    const flush = () => {
      if (run.length > 0) {
        const phrase = run.join(" ");
        const key = phrase.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(phrase);
        }
        run = [];
      }
    };
    for (const piece of text.split(/([A-Za-z0-9]+)/)) {
      if (/^[A-Za-z0-9]+$/.test(piece)) {
        const lower = piece.toLowerCase();
        if (usable.has(lower) && shared.has(lower)) run.push(piece);
        else flush();
      } else if (/[.,;:!?()[\]/\\|]/.test(piece)) {
        flush(); // punctuation ends a phrase; spaces and hyphens do not
      }
    }
    flush();
  }
  // Drop a single word that a longer phrase already contains.
  const phrases = out.filter((p, i) => !out.some((q, j) => j !== i && q.length > p.length && q.toLowerCase().includes(p.toLowerCase())));
  return phrases.slice(0, MAX_REASON_PHRASES);
}

/** Score one other member against the viewer. A word both people put in their
 *  FOCUS lines counts double: it is what they say they work on. */
function compare(mine: Workings, myAll: Set<string>, myFocus: Set<string>, other: Workings) {
  const theirFocus = wordSet([clean(other.focus)]);
  const theirAll = wordSet([clean(other.focus), ...other.pageTexts]);
  const shared = new Set<string>();
  let score = 0;
  myAll.forEach((w) => {
    if (!theirAll.has(w)) return;
    shared.add(w);
    score += myFocus.has(w) && theirFocus.has(w) ? 2 : 1;
  });
  return { score, shared };
}

/** Everyone who shares at least one distinctive word with the viewer, closest
 *  first (ties keep the order given). Empty when the viewer has no focus. */
export function similarMembers(mine: Workings, others: SimilarCandidate[], max?: number): SimilarMember[] {
  if (!hasFocus(mine.focus)) return [];
  const myAll = wordSet([clean(mine.focus), ...mine.pageTexts]);
  const myFocus = wordSet([clean(mine.focus)]);
  if (myAll.size === 0) return [];

  const scored = others
    .map((o, order) => ({ o, order, ...compare(mine, myAll, myFocus, o) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ o, score, shared }): SimilarMember => {
      const shownShared = sharedPhrases(mine, shared);
      return {
        id: o.id,
        name: o.name,
        focus: clean(o.focus) || null,
        score,
        shared: shownShared,
        reason: reasonLine(shownShared),
      };
    });
  return max ? scored.slice(0, max) : scored;
}

/** The Members-tab "Closest to you" order: the similar members first (closest
 *  first), then everyone else in their existing order. */
export function closestFirst<T extends { id: string }>(items: T[], similar: SimilarMember[]): T[] {
  const rank = new Map(similar.map((s, i) => [s.id, i]));
  return items
    .map((item, order) => ({ item, order, rank: rank.get(item.id) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
      if (a.rank !== undefined) return -1;
      if (b.rank !== undefined) return 1;
      return a.order - b.order;
    })
    .map((x) => x.item);
}

// ── gathering the inputs the viewer may use ──────────────────────────────────

type RosterRow = {
  member_id: string;
  user_id: string | null;
  display_name: string;
  focus: string | null;
  hidden: boolean;
};

type PageRow = { owner_id: string; title: string; seed_input: string };

/** Builds the comparison for one viewer, or null when none may be shown.
 *
 *  PRIVACY:
 *   - only an ACTIVE MEMBER gets similarity: a signed-out visitor or a
 *     non-member (even on an 'open' community whose roster they can read) sees
 *     today's view;
 *   - only with a focus of their own;
 *   - the roster and pages are used as given (already limited by the database
 *     to what this viewer may read); hidden members are dropped, the viewer's
 *     own row is never compared with itself;
 *   - the result carries names, focus lines and shared words only, never an
 *     email or a user id. */
export function buildSimilarity(args: {
  isMember: boolean;
  viewerUserId: string | null;
  myFocus: string | null;
  myPageTexts: string[];
  roster: RosterRow[];
  pages: PageRow[];
  max?: number;
}): { items: SimilarMember[]; all: SimilarMember[] } | null {
  if (!args.isMember || !args.viewerUserId || !hasFocus(args.myFocus)) return null;

  const pagesByOwner = new Map<string, string[]>();
  for (const p of args.pages) {
    const list = pagesByOwner.get(p.owner_id) ?? [];
    list.push(p.title, p.seed_input);
    pagesByOwner.set(p.owner_id, list);
  }

  const others: SimilarCandidate[] = args.roster
    .filter((m) => !m.hidden && m.user_id !== args.viewerUserId)
    .map((m) => ({
      id: m.member_id,
      name: m.display_name,
      focus: m.focus,
      pageTexts: m.user_id ? (pagesByOwner.get(m.user_id) ?? []) : [],
    }));

  const mine: Workings = { focus: args.myFocus, pageTexts: args.myPageTexts };
  const all = similarMembers(mine, others);
  return { items: args.max ? all.slice(0, args.max) : all, all };
}
