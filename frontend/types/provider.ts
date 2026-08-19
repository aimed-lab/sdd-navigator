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
