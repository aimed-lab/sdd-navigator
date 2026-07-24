// lib/server/proposal/research.ts — proposal-specific relevant-research gathering.
//
// The extract-entities → discover → precision-filter pipeline. This is the
// proposal's precision-filtered wrapper over the live discovery engine.
//
// It used to reach both stages over HTTP (fetch(`${origin}/api/extract-interests`)
// and fetch(`${origin}/api/discover`)). Those self-fetches are gone: we now call
// the underlying lib functions (extractInterestKeywords, runDiscover) DIRECTLY
// in-process. That removes the extra serverless hops AND removes the reason those
// routes had to be callable without a session — they are now auth-gated.
//
// The pure precision-filter helpers live in ./researchFilters so they stay
// unit-testable under the node:test runner (which can't resolve the @/ alias that
// runDiscover pulls in transitively). Filter logic is unchanged.

import type { ProposalInput, ProposalResearchItem } from "@/types/proposal";
import type { DiscoverItem } from "@/types/discover";
// Relative (not @/) so this module can be loaded by the node:test runner, which
// doesn't resolve the @/ path alias for runtime imports.
import { cleanText } from "../../sanitizeText.ts";
import { extractInterestKeywords } from "../extractInterests.ts";
import { runDiscover } from "../discovery.ts";
import { focusTerms, precisionFilter, precisionFilterPapers } from "./researchFilters.ts";

// ── Relevant research (reuses the live discovery engine) ──────────────────────
//
// Precision strategy (vs. the old raw-blob query that returned broad, off-target
// results): extract clean search entities from the proposal, query discover in
// MULTI-TERM mode, then post-filter papers/trials down to items that actually
// mention the extracted entities. Grants are Grants.gov FUNDING OPPORTUNITIES —
// broad by nature — so they're NOT precision-filtered and are labelled honestly.
// The whole chain runs in parallel with the main generation call (see engine).

export type ResearchPools = {
  papers: ProposalResearchItem[];
  trials: ProposalResearchItem[];
  grants: ProposalResearchItem[];
};

const EMPTY_POOLS: ResearchPools = { papers: [], trials: [], grants: [] };

// Turn the proposal's free-text target + rationale into 3-5 clean search terms
// via the shared Groq keyword extractor (in-process — no HTTP self-fetch).
// Returns [] on any failure so research degrades gracefully to a single-term
// query. Same inputs the old /api/extract-interests self-fetch sent.
async function extractSearchTerms(input: ProposalInput): Promise<string[]> {
  try {
    const result = await extractInterestKeywords({
      working: input.therapeutic_target,
      topics: input.scientific_rationale,
    });
    if (!result.ok) return [];
    return result.keywords.filter((k) => typeof k === "string" && k.trim().length > 0);
  } catch {
    return [];
  }
}

function toResearchItem(i: DiscoverItem): ProposalResearchItem {
  return {
    // discover types are paper | grant | trial | tool; we only keep the first 3.
    type: i.type === "grant" || i.type === "trial" ? i.type : "paper",
    id: i.id,
    // Source APIs embed HTML/XML in titles (<scp>, <i>, &amp;) — clean to plain
    // text so output_data, the PDF, and saved projects are all clean.
    title: cleanText(i.title),
    source: cleanText(i.source),
    date: i.date,
    url: i.url,
  };
}

// Gather the whole research pool in ONE discover call (multi-term), split by
// type, precision-filter papers/trials, and clean titles. Never throws. Calls
// runDiscover DIRECTLY in-process — the old HTTP self-fetch to /api/discover is
// gone (fewer serverless hops, and /api/discover no longer has to be callable
// by this internal path).
export async function gatherResearch(input: ProposalInput): Promise<ResearchPools> {
  const terms = await extractSearchTerms(input);

  // Multi-term when we have extracted entities; otherwise fall back to the raw
  // target as a single query (old behaviour) so research still works. These map
  // to the same DiscoverParams the /api/discover route used to build from the
  // ?interests= / ?q= params.
  const params =
    terms.length > 0
      ? { interests: terms }
      : { q: input.therapeutic_target.slice(0, 200) };

  try {
    const { items } = await runDiscover(params);

    const rawPapers = items.filter((i) => i.type === "paper");
    const rawTrials = items.filter((i) => i.type === "trial");
    const rawGrants = items.filter((i) => i.type === "grant"); // broad — not filtered

    // Papers get the stricter focus-weighted filter; trials/grants are UNCHANGED
    // (they were already well-targeted — see the refinement note).
    const focus = focusTerms(terms, input);

    return {
      papers: precisionFilterPapers(rawPapers, terms, focus).map(toResearchItem),
      trials: precisionFilter(rawTrials, terms).map(toResearchItem),
      grants: rawGrants.map(toResearchItem),
    };
  } catch {
    return EMPTY_POOLS;
  }
}
