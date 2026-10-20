// lib/server/pages/pageEvidence.ts — page_evidence + page_note_evidence
// persistence, copied and adapted from lib/server/wikiEvidence.ts's
// saveEvidence() for the new `pages` feature
// (supabase/migrations/2026-09-30_living_pages.sql). See that file's own
// header comment for the full "every retrieved candidate is upserted,
// whether filed under a note or not" rationale this mirrors.
//
// WHAT'S DIFFERENT FROM wikiEvidence.ts, AND WHY:
//   * `page_id` instead of `project_id`; writes to `page_evidence` and
//     `page_note_evidence` instead of `project_evidence_items` and
//     `wiki_note_evidence`.
//   * Uses the SERVICE-ROLE client (getPagesServiceRoleClient), same reason
//     as pageNotes.ts: an anonymous page has no session to scope a
//     request-scoped client to, and the migration offers no INSERT policy
//     for a NULL-owner page's evidence tables.
//   * Takes `noteIdBySlug` directly (from savePageNotes()'s own return)
//     instead of re-reading page_notes back by page_id — pageNotes.ts
//     already resolved every slug it touched to a real id in the same
//     request, so there is no need for the second round trip
//     wikiEvidence.ts's saveEvidence() makes (it has to do that round trip
//     because it's a separate call in a separate request, on the /status
//     poll route, from whatever saved the notes).
//   * ALSO writes `page_updates`: one row per evidence item with a real
//     `date_iso`, per this task's own instruction — not part of
//     wikiEvidence.ts, which has no equivalent table.
//
// NOT a modification of wikiEvidence.ts — that file, including its read-side
// getProjectWikiGraph(), is untouched; this is a new file.

import { getPagesServiceRoleClient } from "@/lib/server/pages/pagesDb";

export type PageEvidenceItemInput = {
  item_id: string;
  kind: string;
  title: string;
  summary: string | null;
  url: string | null;
  source: string;
  date_iso: string | null;
  signal_metric: string | null;
  signal_value: number | null;
  signal_as_of: string | null;
};

export type PageEvidenceFiling = { item: PageEvidenceItemInput; shared_terms: string[]; rationale?: string };

// Keyed by note SLUG, not id — same reason as wikiEvidence.ts's own
// EvidenceFilingsBySlug: tools/wiki_agent.py's file_evidence() (reused
// verbatim by tools/page_agent.py) decides filing before a brand-new note
// has a database id.
export type PageEvidenceFilingsBySlug = Record<string, PageEvidenceFiling[]>;

export type SavePageEvidenceResult =
  | { status: "ok"; itemsUpserted: number; filingsSaved: number; updatesSaved: number; slugsNotFound: string[] }
  | { status: "error"; error: string };

/** Upserts every distinct item this run retrieved (filed or not) into
 *  page_evidence, files the ones matched to a note into page_note_evidence,
 *  and inserts one page_updates row per item with a real `date_iso`.
 *  BEST-EFFORT stance dropped here relative to wikiEvidence.ts's
 *  saveEvidence(): this feature has no separate "run finished, now persist"
 *  step the way the project flow's /status route does — this call's own
 *  caller (POST /api/pages) is the only writer for this brand-new page, so a
 *  failure here is reported directly in that route's response rather than
 *  logged-and-swallowed. */
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

  const byItemId = new Map<string, PageEvidenceItemInput>();
  for (const list of Object.values(filings)) {
    for (const { item } of list) byItemId.set(item.item_id, item);
  }
  for (const item of unfiled) byItemId.set(item.item_id, item);

  const rows = Array.from(byItemId.values()).map((item) => ({
    page_id: pageId,
    item_id: item.item_id,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    url: item.url,
    source: item.source,
    date_iso: item.date_iso,
    signal_metric: item.signal_metric,
    signal_value: item.signal_value,
    signal_as_of: item.signal_as_of,
    last_seen_at: new Date().toISOString(),
  }));

  let itemsUpserted = 0;
  let idByItemId = new Map<string, string>();
  if (rows.length > 0) {
    const { data, error } = await db
      .from("page_evidence")
      .upsert(rows, { onConflict: "page_id,item_id" })
      .select("id, item_id");
    if (error) {
      console.error("savePageEvidence: upsert page_evidence failed", error);
      return { status: "error", error: "Couldn't save the run's evidence." };
    }
    itemsUpserted = data?.length ?? 0;
    idByItemId = new Map((data ?? []).map((r: { id: string; item_id: string }) => [r.item_id, r.id]));
  }

  const slugsNotFound: string[] = [];
  const filingRows: { note_id: string; evidence_item_id: string; rationale: string | null }[] = [];
  for (const [slug, list] of Object.entries(filings)) {
    const noteId = noteIdBySlug.get(slug);
    if (!noteId) {
      slugsNotFound.push(slug);
      continue;
    }
    for (const { item, shared_terms, rationale } of list) {
      const evidenceItemId = idByItemId.get(item.item_id);
      if (!evidenceItemId) continue;
      filingRows.push({
        note_id: noteId,
        evidence_item_id: evidenceItemId,
        rationale: rationale ?? (shared_terms.length > 0 ? `Shares "${shared_terms.join('", "')}" with this note.` : null),
      });
    }
  }

  let filingsSaved = 0;
  if (filingRows.length > 0) {
    const { error } = await db
      .from("page_note_evidence")
      .upsert(filingRows, { onConflict: "note_id,evidence_item_id" });
    if (error) {
      console.error("savePageEvidence: upsert page_note_evidence failed", error);
      return { status: "error", error: "Couldn't file the run's evidence." };
    }
    filingsSaved = filingRows.length;
  }

  // page_updates — one row per evidence item with a real date_iso, per this
  // feature's own spec (append-only dated timeline, see
  // 2026-09-30_living_pages.sql's own "page_updates is the one genuinely new
  // shape" note). evidence_id links back to the page_evidence row just
  // upserted above when we have its id; occurred_on is DATE, not
  // TIMESTAMPTZ, so only the date portion of date_iso is kept.
  let updatesSaved = 0;
  const updateRows = Array.from(byItemId.values())
    .filter((item) => !!item.date_iso)
    .map((item) => ({
      page_id: pageId,
      evidence_id: idByItemId.get(item.item_id) ?? null,
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      url: item.url,
      occurred_on: (item.date_iso as string).slice(0, 10),
    }));
  if (updateRows.length > 0) {
    const { error } = await db.from("page_updates").insert(updateRows);
    if (error) {
      console.error("savePageEvidence: insert page_updates failed", error);
      return { status: "error", error: "Couldn't save the run's update timeline." };
    }
    updatesSaved = updateRows.length;
  }

  return { status: "ok", itemsUpserted, filingsSaved, updatesSaved, slugsNotFound };
}
