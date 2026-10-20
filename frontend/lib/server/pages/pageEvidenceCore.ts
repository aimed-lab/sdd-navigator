// lib/server/pages/pageEvidenceCore.ts — the database writes behind
// savePageEvidence() (pageEvidence.ts), with the client passed in and no
// runtime imports so `npm test` can run them against a recording fake.
//
// THE FIRST BUILD OF A PAGE WRITES NO page_updates. "What's new" is for items
// a refresh run added later (pageRefresh.ts writes those); the initial
// evidence is the page itself, and the page screen shows it as one line,
// "Page created <date> with <N> sources".

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

// Keyed by note SLUG, not id: tools/wiki_agent.py's file_evidence() (reused
// by tools/page_agent.py) decides filing before a brand-new note has a
// database id.
export type PageEvidenceFilingsBySlug = Record<string, PageEvidenceFiling[]>;

export type SavePageEvidenceResult =
  | { status: "ok"; itemsUpserted: number; filingsSaved: number; slugsNotFound: string[] }
  | { status: "error"; error: string };

// Structural type for the service-role client, so this file needs no import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Upserts every distinct item this run retrieved (filed or not) into
 *  page_evidence and files the ones matched to a note into
 *  page_note_evidence. Failures are returned, not swallowed: the caller
 *  (POST /api/pages) is the only writer for a brand-new page. */
export async function writePageEvidence(
  db: Db,
  pageId: string,
  filings: PageEvidenceFilingsBySlug,
  unfiled: PageEvidenceItemInput[],
  noteIdBySlug: Map<string, string>
): Promise<SavePageEvidenceResult> {
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

  return { status: "ok", itemsUpserted, filingsSaved, slugsNotFound };
}
