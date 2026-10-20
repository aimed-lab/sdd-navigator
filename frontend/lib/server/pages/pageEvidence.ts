// lib/server/pages/pageEvidence.ts — page_evidence + page_note_evidence
// persistence for a brand-new page, copied and adapted from
// lib/server/wikiEvidence.ts's saveEvidence()
// (database/migrations/2026-10-20_living_pages.sql). See that file's own
// header comment for the "every retrieved candidate is upserted, whether
// filed under a note or not" rationale this mirrors.
//
// WHAT'S DIFFERENT FROM wikiEvidence.ts, AND WHY:
//   * `page_id` instead of `project_id`; writes to `page_evidence` and
//     `page_note_evidence`.
//   * Uses the SERVICE-ROLE client (getPagesServiceRoleClient), same reason
//     as pageNotes.ts: an anonymous page has no session to scope a
//     request-scoped client to.
//   * Takes `noteIdBySlug` directly (from savePageNotes()'s own return)
//     instead of re-reading page_notes back by page_id.
//   * Writes NO page_updates. The first build of a page is the page itself;
//     "What's new" only lists what later refresh runs add (pageRefresh.ts).
//
// The writes live in pageEvidenceCore.ts (client passed in, no runtime
// imports) so they can be tested; this file only supplies the client.

import { getPagesServiceRoleClient } from "@/lib/server/pages/pagesDb";
import {
  writePageEvidence,
  type PageEvidenceFilingsBySlug,
  type PageEvidenceItemInput,
  type SavePageEvidenceResult,
} from "@/lib/server/pages/pageEvidenceCore";

export type {
  PageEvidenceFiling,
  PageEvidenceFilingsBySlug,
  PageEvidenceItemInput,
  SavePageEvidenceResult,
} from "@/lib/server/pages/pageEvidenceCore";

export async function savePageEvidence(
  pageId: string,
  filings: PageEvidenceFilingsBySlug,
  unfiled: PageEvidenceItemInput[],
  noteIdBySlug: Map<string, string>
): Promise<SavePageEvidenceResult> {
  const db = getPagesServiceRoleClient();
  if (!db) {
    return { status: "error", error: "Server misconfigured: no service-role Supabase client." };
  }
  return writePageEvidence(db, pageId, filings, unfiled, noteIdBySlug);
}
