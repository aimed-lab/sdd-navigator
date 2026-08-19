// lib/server/checklistClassify.ts — the ONE place addChecklistItem /
// updateChecklistItemLabel (lib/server/projects.ts) classify a checklist
// item's text against the provider catalog's capability vocabulary.
//
// WHY THIS RUNS AT WRITE TIME, NOT READ TIME. The backend's
// POST /api/classify-checklist-item makes one LLM call. Running it here —
// once, when an item is created or its label is edited — is what keeps a
// checklist page load, and a "Find a service provider" click, at ZERO LLM
// calls: getProject() just reads the stored matched_capabilities column
// (see database/migrations/2026-08-19_checklist_matched_capabilities.sql),
// and the results-section fetch (app/api/find-provider/route.ts) queries
// the catalog with those already-known terms.
//
// SAFE FALLBACK: on any failure (timeout, backend down, malformed response)
// this returns [] — matched_capabilities=[] is precisely "show Ask for
// help", the fallback the feature spec calls for. A classification failure
// must never block or fail the add/edit itself; the checklist write always
// succeeds, at worst with an unclassified (Ask-for-help-by-default) item
// that gets a real classification the next time its label is edited.

import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";

// The backend's own catalog-call timeout is 5s (CATALOG_TIMEOUT_SEC) plus
// LLM latency on top; 10s here gives that real headroom while still
// bounding how long an "Add item" / rename click can be held open.
const CLASSIFY_TIMEOUT_MS = 10_000;

/** Classify one checklist item's text against the capability vocabulary.
 *  Returns the matched terms, or [] on ANY failure — never throws, so a
 *  classification hiccup can never fail the checklist write that's calling
 *  it. */
export async function classifyChecklistItem(itemText: string): Promise<string[]> {
  const text = itemText.trim();
  if (!text) return [];

  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/classify-checklist-item`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ item_text: text }),
      signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as { matched_capabilities?: unknown; error?: unknown };
    if (data.error) return [];
    return Array.isArray(data.matched_capabilities)
      ? data.matched_capabilities.filter((c): c is string => typeof c === "string")
      : [];
  } catch (e) {
    console.error("classifyChecklistItem failed", e);
    return [];
  }
}
