// Shapes returned by the Python backend's checklist "Find a service
// provider" action (via /api/find-provider ->
// backend/explore-mcp/tools/find_provider.py).

/** The catalog's own three verification states — "verified" means every
 *  claim was corroborated on the ENTITY'S OWN SITE, never independently
 *  confirmed. `verification_label` is the honest, pre-worded string to
 *  render; never show a warning icon for "not_yet_verified" (it usually
 *  means a bot-blocked or JavaScript-rendered site, not doubt about the
 *  company — see the backend module's own docstring). */
export type ProviderVerification = "verified" | "partially_verified" | "not_yet_verified";

export type Provider = {
  name: string | null;
  // ONE line, taken VERBATIM from the catalog's own description field —
  // never generated, never rewritten (see backend/explore-mcp/tools/
  // find_provider.py's _format_provider). Render exactly as received.
  description: string | null;
  business_types: string[];
  capability_tags: string[];
  countries_served: string[];
  website: string | null;
  verification: ProviderVerification | string | null;
  verification_label: string;
};

export type FindProviderResponse = {
  item_text?: string;
  matched_capabilities?: string[];
  providers?: Provider[];
  count?: number;
  error?: boolean | string;
};

// ── project-level lookup (POST /api/find-providers-for-project) ────────────
//
// The SAME matcher as FindProviderResponse above, applied to the union of
// capability terms already stored across a project's checklist items — see
// backend/explore-mcp/tools/find_provider.py's find_providers_for_project_
// async(). Zero new LLM calls, zero new classification.

/** One checklist item a provider was matched against — `label` is quoted
 *  directly in the UI's one-line "how this helps you" sentence, never
 *  paraphrased (same "never generate, only quote/forward verbatim"
 *  discipline as `description` above — a paraphrase would need an LLM call
 *  this feature deliberately doesn't spend). */
export type MatchedChecklistItem = { id: string; label: string };

export type ProjectProvider = Provider & {
  // Every checklist item this provider covers, computed by intersecting
  // its own capability_tags against each item's stored matched_capabilities
  // — see _attach_matched_items in find_provider.py. Never empty: a
  // provider with no matched item is dropped before this ever reaches the
  // frontend.
  matched_items: MatchedChecklistItem[];
};

export type FindProvidersForProjectResponse = {
  providers?: ProjectProvider[];
  // Distinguishes "nothing to search for" (no checklist item has a matched
  // capability) from "searched and found nothing" — both are legitimate
  // zero-provider outcomes the UI treats the same way (a plain "no match"
  // state), but the counts are still forwarded in case that ever needs to
  // change.
  items_with_capabilities?: number;
  total_items?: number;
  error?: boolean | string;
};
