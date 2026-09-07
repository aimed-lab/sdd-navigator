// GENERIC_SCIENCE_STOPWORDS — ported verbatim from
// backend/explore-mcp/tools/wiki_agent.py's `_GENERIC_SCIENCE_STOPWORDS`
// (its own comment there tells the origin story in full: a paper on immune
// regulation in a hypoxia-stressed Tibetan fish got filed under a human
// kidney inflammasome note on the strength of "however", "pathways",
// "signaling" — words that describe HOW science is written, not WHAT it's
// about, and none of which named anything about NLRP3, kidneys, or
// diabetes).
//
// A SECOND COPY, not an import, same as lib/server/wikiEvidence.ts's own
// STOPWORDS already is for wiki_agent.py's (smaller, different)
// _GROUNDING_STOPWORDS — there is no shared package between the Python
// backend and this Next app, so a literal cross-language import isn't
// possible; this is the closest thing to "moving" it: one canonical word
// list, transcribed unchanged, instead of a second list someone has to
// remember to keep in sync by re-deriving it from scratch.
//
// NOTHING ELSE IMPORTS THE PYTHON ORIGINAL — grepped
// backend/explore-mcp for `_GENERIC_SCIENCE_STOPWORDS` /
// `_distinctive_content_words` before adding this: wiki_agent.py's own
// `_distinctive_content_words` (evidence filing's distinctive-overlap
// check) is the only caller, in either language. If this list ever
// drifts, wiki_agent.py's copy is still the source of truth; update both
// by hand.
//
// If you're looking for the OTHER, smaller stopword list in this
// frontend (lib/server/wikiEvidence.ts's STOPWORDS) — that one mirrors
// wiki_agent.py's _GROUNDING_STOPWORDS instead, a different, shorter list
// used for a different purpose (missing-note suggestions, not
// distinctive-overlap filing or this module's token search). Don't
// conflate the two; they solve different problems and aren't
// interchangeable.
export const GENERIC_SCIENCE_STOPWORDS = new Set([
  // hedges / connectives that show up in nearly every abstract
  "however", "therefore", "moreover", "furthermore", "additionally",
  "thus", "whereas", "likewise", "similarly", "similar", "comparable",
  "compared", "regarding", "following", "through", "them", "these",
  "those", "several", "various", "different", "differences", "existing",
  "exists", "remains", "remained", "provided", "including", "includes",
  "also", "most", "under", "were",
  // generic process/effect/measurement vocabulary — describes HOW a
  // finding was made, not WHAT it's about
  "showed", "shown", "observed", "identified", "investigated",
  "elucidated", "highlight", "highlighted", "suggest", "suggests",
  "suggested", "indicate", "indicates", "indicated", "demonstrate",
  "demonstrated", "reveal", "revealed", "associated", "association",
  "correlated", "correlation", "involved", "involvement", "regulation",
  "regulated", "regulatory", "expression", "expressed", "levels",
  "level", "signaling", "signalling", "pathway", "pathways", "effect",
  "effects", "response", "responses", "mechanism", "mechanisms",
  "process", "processes", "activation", "activated", "induced", "induce",
  "inhibition", "inhibited", "treatment", "treated", "model", "models",
  "function", "functional", "role", "roles", "target", "targets",
  "targeting", "mediated", "driven", "dependent", "independent",
  "significant", "significantly", "potential", "novel", "important",
  "key", "critical", "major", "primary", "secondary", "further",
  "additional", "recent", "current", "previous", "prior", "analysis",
  "analyzed", "patterns", "profile", "profiles", "factor", "factors",
  "system", "systems", "network", "networks", "stress", "damage",
  "exposure", "outcome", "outcomes", "strategies", "strategy",
  "enrichment", "enriched", "immune", "immune-related",
  // generic clinical/methodology nouns that still cross-matched unrelated
  // diseases on a real run (a transthyretin-amyloidosis trial filed under
  // a diabetic-kidney-disease note on "cohort"+"patients" alone)
  "patients", "patient", "cohort", "cohorts", "versus", "both", "human",
  "humans", "small", "protein", "proteins", "single",
  // long but still generic — would otherwise stand alone under Python's
  // long-unambiguous-term bypass (not ported here — this module has no
  // such bypass; see searchCommunities' own comment)
  "measurements", "measurement", "transcriptomic", "transcriptomics",
  "pharmacological", "pharmacology", "structural", "experimental",
  // pure function words / connectives — carry zero topical signal in ANY
  // context
  "where", "while", "have", "whether", "across", "such", "many",
]);
