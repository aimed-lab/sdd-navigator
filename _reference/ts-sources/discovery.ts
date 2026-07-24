// lib/server/discovery.ts — the live discovery aggregation engine.
//
// Moved VERBATIM from app/api/discover/route.ts (Step 4a): the fan-out over
// active terms, quality filter, dedup, future-date filter, relevance scoring, the
// in-process scope cache, and RawDiscoverItem → DiscoverItem shaping — wrapped as
// runDiscover(). The route now just parses query params and calls this. The cache
// stays module-scoped here so it persists across requests exactly as before.
//
// Two consumers rely on the DiscoverItem[] output shape: the Discovery page (via
// the route) and generate-proposal's research pipeline (also via the route).

import type { DiscoverItem, RawDiscoverItem } from "@/types/discover";
import { fetchPubMed } from "@/lib/server/sources/pubmed";
import { fetchOpenAlex } from "@/lib/server/sources/openalex";
import { fetchCrossref } from "@/lib/server/sources/crossref";
import { fetchGrantsGov } from "@/lib/server/sources/grantsGov";
import { fetchClinicalTrials } from "@/lib/server/sources/clinicalTrials";
import { fetchGitHubTools } from "@/lib/server/sources/github";
import { validateDiscoverItems } from "@/lib/server/validation";

const DEFAULT_QUERY = "drug discovery AI";
const PER_SOURCE_CAP = 6;
// When multiple terms are active we fan out 6 sources per term, so cap the
// number of active terms to keep the total fetch count bounded and fast.
const MAX_ACTIVE_TERMS = 3;

// ── Dedupe + relevance scoring ───────────────────────────────────────────────────

function dedupeKey(item: RawDiscoverItem): string {
  const doiMatch = /doi\.org\/(.+)$/i.exec(item.url);
  if (doiMatch) return `doi:${doiMatch[1].toLowerCase()}`;
  try {
    const u = new URL(item.url);
    return `url:${(u.hostname + u.pathname).toLowerCase()}`;
  } catch {
    return `title:${item.title.trim().toLowerCase()}`;
  }
}

// Simple heuristic: keyword overlap with the query bumps the score, very recent
// items get a small boost, very old ones get a small penalty. Kept intentionally
// simple per spec rather than a full relevance model.
function scoreRelevance(item: RawDiscoverItem, queryTerms: string[]): number {
  const text = `${item.title} ${item.description}`.toLowerCase();
  const matched = queryTerms.filter((t) => t.length > 2 && text.includes(t)).length;
  let score = 2 + Math.min(matched, 2);

  const ageDays = (Date.now() - new Date(item.dateISO).getTime()) / 86_400_000;
  if (ageDays >= 0 && ageDays <= 30) score += 1;
  else if (ageDays > 365 * 2) score -= 1;

  return Math.max(1, Math.min(5, Math.round(score)));
}

// ── Quality filter ───────────────────────────────────────────────────────────
// Applied to each fetched item BEFORE dedupe/score, per-source in the combine
// step so one over-aggressive rule can never empty the whole feed. Every rule
// is conservative: when in doubt, keep the item.

// Obvious book front-matter titles (case-insensitive, exact) + "Chapter N …".
const FRONT_MATTER_EXACT = new Set([
  "index", "contents", "table of contents", "preface", "foreword",
  "conclusion", "references", "bibliography", "appendix",
]);
const CHAPTER_RE = /^chapter\s+\d+\b/i;

function looksLikeFrontMatter(title: string): boolean {
  const t = title.trim().toLowerCase();
  if (FRONT_MATTER_EXACT.has(t)) return true;
  if (CHAPTER_RE.test(t)) return true;
  return false;
}

// Non-biomedical domain terms that show up in pure keyword-collision junk
// (e.g. "inhibitor of coal oxidation", "anti-corrosion steel"). Kept narrow
// and unambiguous so we never clip real biomedical work.
const NON_BIOMED_TERMS = [
  "coal", "corrosion", "anti-corrosion", "anticorrosion",
  "steel", "alloy", "asphalt", "bitumen", "concrete", "masonry",
  "petroleum", "crude oil", "gasoline", "diesel", "lubricant",
  "hydrate agglomeration", "wax deposition", "scale inhibitor", "welding",
  "galvaniz", "cathodic protection", "froth flotation",
];

// Biomedical anchors — presence of any of these overrides a non-biomed hit,
// so genuinely biomedical work (e.g. "pulmonary surfactant") is never dropped.
const BIOMED_TERMS = [
  "cell", "protein", "gene", "genom", "enzyme", "cancer", "tumor", "tumour",
  "disease", "patient", "clinical", "therap", "receptor", "molecular",
  "biolog", "neuro", "brain", "alzheimer", "parkinson", "metaboli", "kinase",
  "mutation", "pathway", "in vivo", "in vitro", "mouse", "mice", " rat ",
  "human", "tissue", "blood", "immune", "antibody", "pharmac", "medic",
  "health", "drug", "peptide", "antigen", "vaccine", "pathogen", "bacteri",
  "virus", "viral", "biomarker", "physiolog", "clinic",
];

function isOffDomain(text: string): boolean {
  const hasNonBiomed = NON_BIOMED_TERMS.some((t) => text.includes(t));
  if (!hasNonBiomed) return false; // nothing suspicious — keep
  const hasBiomed = BIOMED_TERMS.some((t) => text.includes(t));
  return !hasBiomed; // drop only when clearly off-domain with no biomedical anchor
}

const FUTURE_DATE_TOLERANCE_MS = 60 * 86_400_000; // ~60 days

function passesQualityFilter(item: RawDiscoverItem): boolean {
  // 1. Book front-matter masquerading as papers (title-pattern fallback; the
  //    Crossref `type` filter at fetch time is the primary guard).
  if (item.type === "paper" && looksLikeFrontMatter(item.title)) return false;

  // 2. Date sanity — drop far-future placeholder dates for papers/tools/trials.
  //    Grants stay lenient: Grants.gov forecasted opportunities are legitimately
  //    dated in the future.
  if (item.type !== "grant") {
    const t = new Date(item.dateISO).getTime();
    if (!isNaN(t) && t - Date.now() > FUTURE_DATE_TOLERANCE_MS) return false;
  }

  // 3. Biomedical relevance guard — cut obvious off-domain keyword collisions.
  if (isOffDomain(`${item.title} ${item.description}`.toLowerCase())) return false;

  return true;
}

// ── Short-lived scope cache ──────────────────────────────────────────────────
//
// A module-scoped Map, in-process — deliberately not a database table or
// external cache service. It's a comfort window over the live fetch, not a
// source of truth: a redeploy or serverless cold start just means the next
// request repopulates it, which is fine since the live fetch is still the
// fallback. Keyed by the resolved scope — the sorted+joined set of active
// terms (the interest terms or single search term actually used, or the
// general default for anonymous users) — so each distinct combination of
// terms gets its own cached feed independent of who's asking, and the same
// combination (in any order) reuses one entry.
const DISCOVER_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4h — tune here (spec range: 3-6h)
const DISCOVER_CACHE_PRUNE_AFTER_MS = DISCOVER_CACHE_TTL_MS * 6; // bound Map growth from one-off searches

type DiscoverCacheEntry = { items: DiscoverItem[]; cachedAt: number };
const discoverCache = new Map<string, DiscoverCacheEntry>();

function pruneDiscoverCache(now: number) {
  for (const [key, entry] of discoverCache) {
    if (now - entry.cachedAt > DISCOVER_CACHE_PRUNE_AFTER_MS) discoverCache.delete(key);
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
//
// Progressive rendering note: every source is fetched in parallel via
// Promise.allSettled (6 sources × up to MAX_ACTIVE_TERMS terms) and the
// response is returned once they've all settled (each is individually
// fast/reliable, so the slowest one bounds the total). To upgrade to true
// progressive rendering later, swap this for a ReadableStream/NDJSON response
// that pushes each source's items as its promise resolves, and have the client
// append incrementally instead of waiting for the single JSON payload.

export type DiscoverParams = {
  q?: string;
  interests?: string[];
  forceRefresh?: boolean;
};

export type DiscoverResponse = {
  items: DiscoverItem[];
  personalized: boolean;
  query: string;
  cachedAt: number;
  fromCache: boolean;
};

export async function runDiscover(params: DiscoverParams): Promise<DiscoverResponse> {
  const qOverride = params.q;
  const interests = params.interests ?? [];
  const forceRefresh = params.forceRefresh ?? false;

  const personalized = !qOverride && interests.length > 0;

  // Resolve the active terms. A typed search still scopes to that one term
  // (unchanged). Otherwise blend the user's interests — capped at
  // MAX_ACTIVE_TERMS so the fan-out stays bounded — falling back to the
  // general default for anonymous users. Deduped case-insensitively.
  let activeTerms: string[];
  if (qOverride) {
    activeTerms = [qOverride];
  } else if (interests.length > 0) {
    const seen = new Set<string>();
    activeTerms = [];
    for (const t of interests) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      activeTerms.push(t);
      if (activeTerms.length >= MAX_ACTIVE_TERMS) break;
    }
  } else {
    activeTerms = [DEFAULT_QUERY];
  }

  // Per-term fairness: shrink the per-source cap as more terms fan out so no
  // single term floods the feed. The merge + score/sort below then surfaces
  // the best across all terms. Single-term queries keep the full cap (6), so
  // typed search and anonymous default behave exactly as before.
  const perSourceCap = Math.max(3, Math.ceil(PER_SOURCE_CAP / activeTerms.length));

  // Score against the union of every active term's words, so an item matching
  // any active term gets the relevance bump (not just the first term's words).
  const queryTerms = activeTerms.join(" ").toLowerCase().split(/\s+/).filter(Boolean);
  // Cache key = sorted, joined set of active terms, so the same combination
  // (in any order) reuses one entry and different combinations stay distinct.
  const cacheKey = activeTerms.map((t) => t.toLowerCase()).sort().join("|");

  const now = Date.now();
  const cached = discoverCache.get(cacheKey);
  const cacheIsFresh = !!cached && now - cached.cachedAt < DISCOVER_CACHE_TTL_MS;

  const queryLabel = activeTerms.join(", ");

  if (!forceRefresh && cacheIsFresh) {
    return { items: cached!.items, personalized, query: queryLabel, cachedAt: cached!.cachedAt, fromCache: true };
  }

  const results = await Promise.allSettled(
    activeTerms.flatMap((t) => [
      fetchPubMed(t, perSourceCap),
      fetchOpenAlex(t, perSourceCap),
      fetchCrossref(t, perSourceCap),
      fetchGrantsGov(t, perSourceCap),
      fetchClinicalTrials(t, perSourceCap),
      fetchGitHubTools(t, perSourceCap),
    ])
  );

  const seen = new Set<string>();
  const items: DiscoverItem[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue; // per-source isolation — one failure never breaks the rest
    for (const raw of r.value) {
      if (!passesQualityFilter(raw)) continue; // drop junk before dedupe/score
      const key = dedupeKey(raw);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ ...raw, relevance: scoreRelevance(raw, queryTerms) });
    }
  }

  items.sort(
    (a, b) => b.relevance - a.relevance || new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime()
  );

  // Quality layer (Starling-style named axes): rule-based integrity/recency/dedup
  // on everything, then a batched LLM relevance judge on the top survivors. Runs
  // on the sorted list so the judge sees the strongest candidates first, and its
  // re-rank (flagged below passing) refines the sort above. Fail-open by contract
  // — a validation error returns the unvalidated items rather than an empty feed.
  // We validate BEFORE caching so cache hits serve already-validated results and
  // never re-incur the LLM cost. Both consumers (Discovery feed + Navigator
  // per-phase research) inherit this through runDiscover.
  const validated = await validateDiscoverItems(items, queryLabel);

  pruneDiscoverCache(now);
  discoverCache.set(cacheKey, { items: validated, cachedAt: now });

  return { items: validated, personalized, query: queryLabel, cachedAt: now, fromCache: false };
}
