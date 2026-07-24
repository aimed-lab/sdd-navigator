// Shared discovery types — used by the /api/discover engine (lib/server/discovery
// + lib/server/sources/*), by generate-proposal's research pipeline, and by the
// client feed components (DiscoverCard, HomeDashboard, LandingLiveStrip, the
// Discovery page, navigatorRadar). Relocated here from app/api/discover/route.ts
// in Step 4a so no consumer imports a type from a route module.

export type DiscoverItem = {
  id: string;
  type: "paper" | "grant" | "trial" | "tool";
  title: string;
  description: string;
  source: string;
  date: string;
  dateISO: string;
  url: string;
  tags: string[];
  relevance: number; // 1-5
  // Optional named-axis validation record (relevance/recency/integrity/dedup),
  // attached by lib/server/validation.validateDiscoverItems for surviving items.
  // Optional so nothing that constructs a DiscoverItem before validation breaks.
  validation?: ItemValidation;
};

// Per-item quality record from the validation layer (Starling-style named axes,
// each with a verdict + reason). Kept alongside the item for debugging why it was
// shown or ranked lower. Defined here (not in lib/server) so client components can
// read it too without importing a server module.
export type ItemValidation = {
  overall: "pass" | "flag" | "fail";
  axes: Partial<Record<"relevance" | "recency" | "integrity" | "dedup", { verdict: "pass" | "flag" | "fail"; reason: string }>>;
};

// A source item before relevance scoring — what each lib/server/sources fetcher returns.
export type RawDiscoverItem = Omit<DiscoverItem, "relevance">;
