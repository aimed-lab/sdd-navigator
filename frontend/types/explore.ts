// Shapes returned by the Python explore backend (via /api/explore).

export type Signal = {
  metric: string; // "citations" | "stars" | "recency"
  value: number;
  as_of: string;
};

export type ExploreItem = {
  id: string;
  kind: string; // paper | news | trial | grant | tool | dataset | geneset | resource | person | episode
  title: string;
  summary: string | null;
  url: string | null;
  doi?: string | null;
  source: string;
  date_iso: string | null;
  signal: Signal | null;
  dedupe_key?: string;
  raw?: Record<string, unknown>;
};

export type ExploreSection = {
  tool: string;
  kind: string;
  query?: string;
  items: ExploreItem[];
  /** Papers section ONLY (kind === "paper"): the SAME already-fetched/ranked
   *  pool as `items`, but ordered by WINNER's own re-rank instead of date
   *  desc — rendered as a second "Key Papers" subsection under the same
   *  Papers tab (see backend/explore-mcp/tools/explore.py's search_papers
   *  handling, and CategoryStrip — there is no separate "key papers" kind
   *  or tab). Absent for every other section kind. */
  items_key?: ExploreItem[];
  error?: string;
};

/** The structured scope the backend either extracted from a search or used for
 *  the landing feed. `is_personalized` marks the one case the UI acts on: a
 *  blank-input feed scoped to the signed-in user's saved interests, which sit in
 *  `topics` (see backend/explore-mcp/tools/explore.py). */
export type ExploreScope = Record<string, unknown> & {
  topics?: string[];
  is_default?: boolean;
  is_personalized?: boolean;
};

/** backend/explore-mcp/sources/clinical_trials.py's `raw` shape — a handful
 *  of first-party fields, no top-level Item field for any of them. `why_stopped`
 *  MUST be rendered verbatim wherever it's shown, never through any LLM/
 *  summarization step — see components/ItemCard.tsx. */
export type TrialRaw = {
  nct_id?: string;
  overall_status?: string | null;
  why_stopped?: string | null;
  phase?: string | null;
};

export type ExploreResponse = {
  input?: string;
  scope?: ExploreScope;
  tools_called?: string[];
  reasoning?: string | null;
  sections: ExploreSection[];
  error?: boolean;
};
