// lib/server/proposal/researchFilters.ts — pure precision-filter helpers.
//
// Split out of research.ts so they stay unit-testable under the node:test runner.
// research.ts now imports runDiscover (which pulls in @/lib/server/sources/*), and
// the test runner does NOT resolve the @/ path alias — so importing research.ts
// directly would drag that whole graph in and fail to load. These helpers depend
// ONLY on type-only @/ imports (erased at runtime) plus plain data, so the test
// imports them from HERE and never touches the discovery module graph.
//
// Logic is unchanged from when it lived in research.ts.

import type { DiscoverItem } from "@/types/discover";
import type { ProposalInput } from "@/types/proposal";

// Count how many extracted term-phrases appear (case-insensitive substring) in
// the item's title + description — the precision signal. Items matching more
// terms (e.g. target AND disease) rank above single-term matches.
function termMatchCount(item: DiscoverItem, terms: string[]): number {
  const hay = `${item.title} ${item.description}`.toLowerCase();
  return terms.reduce((n, t) => (hay.includes(t.toLowerCase()) ? n + 1 : n), 0);
}

// Disease / indication markers. A term carrying one of these names an INDICATION
// (e.g. "pancreatic ductal adenocarcinoma", "glioblastoma") — the disease being
// treated — NOT the molecular focus of the project. We detect these by
// morphology rather than a disease ontology: it's deterministic, dependency-free,
// and covers the oncology-heavy domain plus common indication suffixes. This is
// what lets us subtract the disease even when the researcher writes it into the
// therapeutic_target field ("...inhibitor FOR pancreatic ductal adenocarcinoma").
//
// NB: we deliberately do NOT subtract "any term that also appears in the
// rationale" — a good rationale names the TARGET too ("KRAS G12D is the driver
// in…"), so that rule would wrongly strip the target itself. Morphology
// separates the indication from the target/modality cleanly.
const INDICATION_MARKERS = [
  "cancer", "carcinoma", "adenocarcinoma", "tumor", "tumour", "neoplasm", "neoplasia",
  "sarcoma", "leukemia", "leukaemia", "lymphoma", "melanoma", "glioma", "glioblastoma",
  "myeloma", "blastoma", "metastasis", "metastatic",
  "disease", "syndrome", "disorder",
];

function isIndicationTerm(term: string): boolean {
  const t = term.toLowerCase();
  return INDICATION_MARKERS.some((m) => t.includes(m));
}

// The project's SPECIFIC focus — the TARGET + MODALITY the researcher actually
// has (e.g. "KRAS G12D", "covalent inhibitor", "small molecule"), NOT the disease
// it treats. Derived deterministically in two steps:
//   1. Candidate = extracted terms that appear in the therapeutic_target field
//      (what-they-have), excluding broad disease/context terms that only show up
//      in the rationale.
//   2. Subtract disease/indication terms (by morphology), so a disease name in
//      the target field ("…for pancreatic ductal adenocarcinoma") does NOT count
//      as focus — otherwise disease-only papers satisfy the raised threshold.
// Returns [] when nothing survives (no identifiable molecular focus), the signal
// that paper filtering should degrade to the broad term filter rather than
// pretending the disease is a focus.
export function focusTerms(terms: string[], input: ProposalInput): string[] {
  const target = input.therapeutic_target.toLowerCase();
  const inTarget = terms.filter((t) => target.includes(t.toLowerCase()));
  return inTarget.filter((t) => !isIndicationTerm(t));
}

// Does the item text hit a focus term? True on a full-phrase substring match OR
// when every SIGNIFICANT token of the phrase appears — so "KRAS G12D" also
// matches "KRAS(G12D)" / "KRAS-G12D mutant" (varied phrasing) without loosening
// to a mere disease match (both distinctive tokens must still be present).
function focusHit(hay: string, term: string): boolean {
  const t = term.toLowerCase();
  if (hay.includes(t)) return true;
  const tokens = t.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return tokens.length > 0 && tokens.every((w) => hay.includes(w));
}

// Count how many of the project's FOCUS terms the item hits (token-aware).
function focusMatchCount(item: DiscoverItem, focus: string[]): number {
  const hay = `${item.title} ${item.description}`.toLowerCase();
  return focus.reduce((n, f) => (focusHit(hay, f) ? n + 1 : n), 0);
}

// Precision post-filter for target-queryable types (papers, trials): keep only
// items mentioning an extracted term, ranked by match count. If that leaves the
// pool empty (over-filtered), fall back to the unfiltered subset rather than
// showing nothing. No-op when we have no terms.
export function precisionFilter(items: DiscoverItem[], terms: string[]): DiscoverItem[] {
  if (terms.length === 0) return items;
  const onTarget = items
    .map((i) => ({ i, score: termMatchCount(i, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i);
  return onTarget.length > 0 ? onTarget : items;
}

// STRICTER paper-specific filter (Refinement 1). A paper must hit the project's
// SPECIFIC focus (target/approach/modality), not merely the disease area — so a
// "pancreatic cancer" paper that never mentions KRAS G12D or the drug-design
// approach is dropped. Papers are ranked focus-first, then by total term breadth.
//
// Deliberately NO fallback to the broad filter when the on-focus pool is empty:
// that fallback would silently reintroduce the exact disease-only papers this
// filter exists to drop. If nothing is on-focus we return [] — the phase simply
// shows its (well-targeted) trials/funding and no loose papers, which is the
// honest outcome. Only when we couldn't identify ANY focus term (focus === [])
// do we defer to the broad filter, since we then have no basis to tighten.
export function precisionFilterPapers(
  items: DiscoverItem[],
  terms: string[],
  focus: string[],
): DiscoverItem[] {
  if (focus.length === 0) return precisionFilter(items, terms);
  return items
    .map((i) => ({ i, focusScore: focusMatchCount(i, focus), totalScore: termMatchCount(i, terms) }))
    .filter((x) => x.focusScore > 0) // the raised threshold: must hit the actual focus
    .sort((a, b) => b.focusScore - a.focusScore || b.totalScore - a.totalScore)
    .map((x) => x.i);
}
