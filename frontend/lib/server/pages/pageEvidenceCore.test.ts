// Run with `npm test`. The first build of a page writes evidence and filings
// but no page_updates: "What's new" is only for refresh-added items.

import test from "node:test";
import assert from "node:assert/strict";
import { writePageEvidence, type PageEvidenceItemInput } from "./pageEvidenceCore.ts";

const item = (id: string): PageEvidenceItemInput => ({
  item_id: id,
  kind: "paper",
  title: `Title ${id}`,
  summary: null,
  url: `https://x/${id}`,
  source: "pubmed",
  date_iso: "2026-09-01",
  signal_metric: null,
  signal_value: null,
  signal_as_of: null,
});

function recordingDb() {
  const writes: { table: string; op: string }[] = [];
  const db = {
    from(table: string) {
      let op = "select";
      let payload: Record<string, unknown>[] = [];
      const b: any = {
        upsert: (p: Record<string, unknown>[]) => ((op = "upsert"), (payload = p), writes.push({ table, op }), b),
        insert: (p: Record<string, unknown>[]) => ((op = "insert"), (payload = p), writes.push({ table, op }), b),
        select: () => b,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: payload.map((r) => ({ id: `id-${String(r.item_id)}`, item_id: r.item_id })), error: null }),
      };
      return b;
    },
  };
  return { db, writes };
}

test("creating a page writes evidence and filings, and no page_updates", async () => {
  const { db, writes } = recordingDb();
  const res = await writePageEvidence(
    db,
    "p1",
    { "note-a": [{ item: item("a"), shared_terms: [], rationale: "Cited as [1]" }] },
    [item("b")],
    new Map([["note-a", "n1"]])
  );
  assert.equal(res.status, "ok");
  if (res.status === "ok") {
    assert.equal(res.itemsUpserted, 2);
    assert.equal(res.filingsSaved, 1);
  }
  assert.deepEqual(writes.map((w) => `${w.table}:${w.op}`), ["page_evidence:upsert", "page_note_evidence:upsert"]);
  assert.ok(!writes.some((w) => w.table === "page_updates"));
});
