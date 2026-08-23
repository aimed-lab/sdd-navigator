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
// SAFE FALLBACK: on any failure (timeout, backend down, malformed response,
// the external catalog itself failing) this still returns capabilities=[] —
// matched_capabilities=[] is precisely "show Ask for help", the fallback
// the feature spec calls for. A classification failure must never block or
// fail the add/edit itself; the checklist write always succeeds.
//
// BUT [] MEANS TWO DIFFERENT THINGS, AND THIS FILE USED TO COLLAPSE THEM.
// "The model confidently found no service need here" and "we couldn't ask
// at all" both used to come back as a bare [] — indistinguishable to
// whatever called this. That's precisely the failure-looks-like-success
// shape that let the catalog's 2026-08-23 outage (`anon` denied SELECT on
// `public.entities`, upstream) go unnoticed: every item added or renamed
// while it was down silently landed on "Ask for help" as if that were a
// real determination, with nothing anywhere recording that classification
// never actually ran. `classificationFailed` is the fix — same shape as
// CategoryEmptyCard's `failed` prop for a dead Explore source: a per-call,
// non-persisted signal that this specific attempt didn't get an answer, so
// the caller can say so, distinctly from a genuine "no" — WITHOUT storing
// anything new on the row or blocking the write either.

import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";

// The backend's own catalog-call timeout is 5s (CATALOG_TIMEOUT_SEC) plus
// LLM latency on top; 10s here gives that real headroom while still
// bounding how long an "Add item" / rename click can be held open.
const CLASSIFY_TIMEOUT_MS = 10_000;

export type ClassifyResult = {
  capabilities: string[];
  // true only when classification itself didn't run (backend error, bad
  // response, timeout, network failure) — never true for a genuine "this
  // isn't a service" determination, which is capabilities=[] with
  // classificationFailed=false, same as it always was.
  classificationFailed: boolean;
};

/** Classify one checklist item's text against the capability vocabulary.
 *  Never throws — a classification hiccup can never fail the checklist
 *  write that's calling it — but now says WHICH kind of "no capabilities"
 *  this is, see ClassifyResult above. */
export async function classifyChecklistItem(itemText: string): Promise<ClassifyResult> {
  const text = itemText.trim();
  if (!text) return { capabilities: [], classificationFailed: false };

  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/classify-checklist-item`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ item_text: text }),
      signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("classifyChecklistItem: backend responded", res.status);
      return { capabilities: [], classificationFailed: true };
    }

    const data = (await res.json()) as { matched_capabilities?: unknown; error?: unknown };
    if (data.error) {
      // This branch used to return [] with NO log line at all — the exact
      // silent-swallow this comment block is about. The backend already
      // did the work of catching the real exception and naming it in
      // `error`; discarding that here instead of logging it is what let a
      // real outage look identical to "nothing to report" in this
      // process's own logs too, not just in the UI.
      console.error("classifyChecklistItem: backend reported an error", data.error);
      return { capabilities: [], classificationFailed: true };
    }
    const capabilities = Array.isArray(data.matched_capabilities)
      ? data.matched_capabilities.filter((c): c is string => typeof c === "string")
      : [];
    return { capabilities, classificationFailed: false };
  } catch (e) {
    console.error("classifyChecklistItem failed", e);
    return { capabilities: [], classificationFailed: true };
  }
}
