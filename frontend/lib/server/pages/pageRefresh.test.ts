// Run with `npm test` (node --test). pageRefresh.ts has no runtime imports,
// so these need neither Supabase nor the Next.js build.

import test from "node:test";
import assert from "node:assert/strict";
import {
  FAILURE_RETRY_HOURS,
  STALE_AFTER_HOURS,
  diffNewItems,
  makeSupabaseRefreshDeps,
  pickStalePages,
  restrictFilings,
  runRefresh,
  type BackendRefreshResult,
  type RefreshDeps,
  type RefreshNote,
  type RefreshPage,
} from "./pageRefresh.ts";

const NOW = new Date("2026-10-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const page = (id: string, last: string | null, enabled = true): RefreshPage => ({
  id,
  slug: `slug-${id}`,
  seed_input: `topic ${id}`,
  refresh_enabled: enabled,
  last_refreshed_at: last,
});

const item = (id: string) => ({
  item_id: id,
  kind: "paper",
  title: `Title ${id}`,
  summary: null,
  url: `https://x/${id}`,
  source: "pubmed",
  date_iso: null,
  signal_metric: null,
  signal_value: null,
  signal_as_of: null,
});

const silent = () => {};

// ── picking stale pages ──────────────────────────────────────────────────────

test("pickStalePages: only enabled pages that are never-refreshed or older than 20h", () => {
  const picked = pickStalePages(
    [
      page("fresh", hoursAgo(5)),
      page("edge-fresh", hoursAgo(STALE_AFTER_HOURS - 0.1)),
      page("old", hoursAgo(30)),
      page("never", null),
      page("disabled", null, false),
    ],
    NOW
  );
  assert.deepEqual(picked.map((p) => p.id), ["never", "old"]);
});

test("pickStalePages: never-refreshed first, then oldest first, capped at 3", () => {
  const picked = pickStalePages(
    [page("a", hoursAgo(21)), page("b", hoursAgo(90)), page("c", hoursAgo(40)), page("d", null), page("e", hoursAgo(25))],
    NOW
  );
  assert.deepEqual(picked.map((p) => p.id), ["d", "b", "c"]);
});

// ── only new items ───────────────────────────────────────────────────────────

test("diffNewItems: drops known ids and duplicates within the batch", () => {
  const out = diffNewItems([item("a"), item("b"), item("b"), item("c")], ["a"]);
  assert.deepEqual(out.map((i) => i.item_id), ["b", "c"]);
});

test("restrictFilings: only existing notes and new items survive", () => {
  const out = restrictFilings(
    { keep: [{ item: item("n1") }, { item: item("old") }], ghost: [{ item: item("n1") }], empty: [{ item: item("old") }] },
    [item("n1")],
    [{ slug: "keep" }, { slug: "empty" }]
  );
  assert.deepEqual(Object.keys(out), ["keep"]);
  assert.deepEqual(out.keep.map((f) => f.item.item_id), ["n1"]);
});

// ── the run, with fake dependencies ──────────────────────────────────────────

function fakeDeps(opts: {
  pages: RefreshPage[];
  known?: Record<string, string[]>;
  backend: (topic: string) => BackendRefreshResult | Error;
}) {
  const saved: { pageId: string; ids: string[]; today: string }[] = [];
  const marked: { pageId: string; iso: string }[] = [];
  const deps: RefreshDeps = {
    listStalePages: async () => opts.pages,
    loadKnownItemIds: async (id) => opts.known?.[id] ?? [],
    loadNotes: async () => [],
    callBackend: async ({ topic }) => {
      const r = opts.backend(topic);
      if (r instanceof Error) throw r;
      return r;
    },
    saveNewItems: async ({ pageId, items, today }) => {
      saved.push({ pageId, ids: items.map((i) => i.item_id), today });
      return { itemsSaved: items.length, updatesSaved: items.length, filingsSaved: 0 };
    },
    markRefreshed: async (pageId, iso) => {
      marked.push({ pageId, iso });
    },
  };
  return { deps, saved, marked };
}

test("runRefresh: inserts only new items and stamps last_refreshed_at, even with nothing new", async () => {
  const { deps, saved, marked } = fakeDeps({
    pages: [page("p1", null), page("p2", null)],
    known: { p1: ["a"], p2: ["x"] },
    backend: (topic) => ({
      new_items: topic === "topic p1" ? [item("a"), item("b")] : [item("x")],
      evidence_filings: {},
    }),
  });
  const summary = await runRefresh(deps, NOW, silent);

  assert.deepEqual(saved, [{ pageId: "p1", ids: ["b"], today: "2026-10-20" }]); // p2 had nothing new: no save
  assert.deepEqual(marked.map((m) => m.pageId), ["p1", "p2"]);
  assert.ok(marked.every((m) => m.iso === NOW.toISOString()));
  assert.deepEqual(summary.refreshed.map((r) => [r.pageId, r.newItems]), [["p1", 1], ["p2", 0]]);
  assert.deepEqual(summary.errors, []);
});

test("runRefresh: one page failing does not stop the others", async () => {
  const { deps, saved, marked } = fakeDeps({
    pages: [page("p1", null), page("p2", null), page("p3", null)],
    backend: (topic) =>
      topic === "topic p2" ? new Error("backend exploded") : { new_items: [item(topic)], evidence_filings: {} },
  });
  const summary = await runRefresh(deps, NOW, silent);

  assert.deepEqual(saved.map((s) => s.pageId), ["p1", "p3"]);
  assert.deepEqual(summary.refreshed.map((r) => r.pageId), ["p1", "p3"]);
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.errors[0].pageId, "p2");
  assert.match(summary.errors[0].error, /backend exploded/);
  // The failed page is pushed back (retried in ~FAILURE_RETRY_HOURS), not marked as just refreshed.
  const failedMark = marked.find((m) => m.pageId === "p2")!;
  assert.equal(
    failedMark.iso,
    new Date(NOW.getTime() - (STALE_AFTER_HOURS - FAILURE_RETRY_HOURS) * 3600_000).toISOString()
  );
});

test("runRefresh: a failed search is an error, not a quiet 'nothing new'", async () => {
  const { deps, saved, marked } = fakeDeps({
    pages: [page("p1", null)],
    backend: () => ({ new_items: [], evidence_filings: {}, search_failed: true, warnings: ["search down"] }),
  });
  const summary = await runRefresh(deps, NOW, silent);
  assert.equal(summary.refreshed.length, 0);
  assert.match(summary.errors[0].error, /search down/);
  assert.equal(saved.length, 0);
  assert.notEqual(marked[0].iso, NOW.toISOString());
});

test("runRefresh: failing to list pages is reported, nothing throws", async () => {
  const { deps } = fakeDeps({ pages: [], backend: () => ({ new_items: [], evidence_filings: {} }) });
  deps.listStalePages = async () => {
    throw new Error("db down");
  };
  const summary = await runRefresh(deps, NOW, silent);
  assert.equal(summary.picked, 0);
  assert.match(summary.errors[0].error, /db down/);
});

// ── human-edited notes are never written ─────────────────────────────────────

type Op = { table: string; op: string; payload?: unknown; filters: Record<string, unknown> };

/** Minimal chainable stand-in for the Supabase client: records every write
 *  and answers reads from `data`. */
function recordingDb(
  data: Record<string, Record<string, unknown>[]>,
  failOn?: { table: string; op: string }
) {
  const ops: Op[] = [];
  const db = {
    from(table: string) {
      let op = "select";
      let payload: unknown;
      const eqs: [string, unknown][] = [];
      let range: [number, number] | null = null;
      let cur: Op | null = null;
      const record = (o: string, p?: unknown) => {
        op = o;
        payload = p;
        cur = { table, op: o, payload: p, filters: {} };
        ops.push(cur);
        return b;
      };
      const rows = () => {
        if (op === "insert" || op === "upsert") {
          const list = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
          return list.map((r) => ({ id: `id-${String(r.item_id ?? r.note_id)}`, ...r }));
        }
        let out = (data[table] ?? []).filter((r) => eqs.every(([k, v]) => r[k] === v));
        if (range) out = out.slice(range[0], range[1] + 1);
        return out;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: (k: string, v: unknown) => (eqs.push([k, v]), cur && (cur.filters[k] = v), b),
        in: (k: string, v: unknown[]) => (cur && (cur.filters[k] = v), b),
        or: () => b,
        order: () => b,
        limit: () => b,
        range: (a: number, z: number) => ((range = [a, z]), b),
        insert: (p: unknown) => record("insert", p),
        upsert: (p: unknown) => record("upsert", p),
        update: (p: unknown) => record("update", p),
        delete: () => record("delete"),
        then: (resolve: (v: unknown) => void) =>
          failOn && failOn.table === table && failOn.op === op
            ? resolve({ data: null, error: { message: `injected ${table} ${op} failure` } })
            : resolve({ data: rows(), error: null }),
      };
      return b;
    },
  };
  return { db, ops };
}

test("a refresh never writes page_notes, human-edited notes included", async () => {
  const notes: RefreshNote[] = [
    { id: "n-human", slug: "human", title: "Human note", body: "kinase signalling", note_type: "concept", is_human_edited: true },
    { id: "n-auto", slug: "auto", title: "Auto note", body: "kinase signalling", note_type: "concept", is_human_edited: false },
  ];
  const { db, ops } = recordingDb({
    pages: [{ id: "p1", slug: "slug-p1", seed_input: "topic p1", refresh_enabled: true, last_refreshed_at: null }],
    page_evidence: [{ page_id: "p1", item_id: "old" }],
    page_notes: notes.map((n) => ({ ...n, page_id: "p1" })),
  });
  const deps = makeSupabaseRefreshDeps(db, async () => ({
    new_items: [item("old"), item("new1")],
    evidence_filings: {
      human: [{ item: item("new1"), shared_terms: ["kinase"] }],
      auto: [{ item: item("new1"), shared_terms: ["kinase"] }],
    },
  }));
  const summary = await runRefresh(deps, NOW, silent);

  assert.deepEqual(summary.errors, []);
  assert.equal(summary.refreshed[0].newItems, 1);
  assert.deepEqual(ops.filter((o) => o.table === "page_notes"), [], "no write of any kind touches page_notes");
  // What was written: the one new evidence row, its timeline row, filing links, and the stamp.
  const evidence = ops.find((o) => o.table === "page_evidence" && o.op === "upsert")!;
  assert.deepEqual((evidence.payload as { item_id: string }[]).map((r) => r.item_id), ["new1"]);
  const update = ops.find((o) => o.table === "page_updates")!;
  assert.equal((update.payload as { occurred_on: string }[])[0].occurred_on, "2026-10-20");
  assert.ok(ops.some((o) => o.table === "page_note_evidence" && o.op === "upsert"));
  assert.ok(ops.some((o) => o.table === "pages" && o.op === "update"));
});

// ── all or nothing for a page's new items ────────────────────────────────────

for (const failing of ["page_updates", "page_note_evidence"]) {
  test(`a failed ${failing} write removes this run's evidence, filings and timeline rows, and the page retries later`, async () => {
    const { db, ops } = recordingDb(
      {
        pages: [{ id: "p1", slug: "slug-p1", seed_input: "topic p1", refresh_enabled: true, last_refreshed_at: null }],
        page_evidence: [{ page_id: "p1", item_id: "old" }],
        page_notes: [
          { id: "n-auto", page_id: "p1", slug: "auto", title: "Auto note", body: "kinase", note_type: "concept", is_human_edited: false },
        ],
      },
      { table: failing, op: failing === "page_updates" ? "insert" : "upsert" }
    );
    const deps = makeSupabaseRefreshDeps(db, async () => ({
      new_items: [item("new1"), item("new2")],
      evidence_filings: { auto: [{ item: item("new1"), shared_terms: ["kinase"] }] },
    }));
    const summary = await runRefresh(deps, NOW, silent);

    // Reported as a failed page, not a refreshed one.
    assert.deepEqual(summary.refreshed, []);
    assert.equal(summary.errors.length, 1);
    assert.match(summary.errors[0].error, new RegExp(`injected ${failing}`));

    // Both inserted evidence rows were deleted again, with their links and timeline rows.
    const ids = ["id-new1", "id-new2"];
    const deletes = ops.filter((o) => o.op === "delete");
    assert.deepEqual(
      deletes.map((o) => o.table),
      ["page_note_evidence", "page_updates", "page_evidence"]
    );
    assert.deepEqual(deletes[0].filters.evidence_item_id, ids);
    assert.deepEqual(deletes[1].filters.evidence_id, ids);
    assert.deepEqual(deletes[2].filters.id, ids);
    assert.equal(deletes[2].filters.page_id, "p1");
    assert.deepEqual(ops.filter((o) => o.table === "page_notes"), []);

    // Retried later: stamped into the past (not "just refreshed").
    const stamp = ops.find((o) => o.table === "pages" && o.op === "update")!;
    assert.equal(
      (stamp.payload as { last_refreshed_at: string }).last_refreshed_at,
      new Date(NOW.getTime() - (STALE_AFTER_HOURS - FAILURE_RETRY_HOURS) * 3600_000).toISOString()
    );
  });
}

test("nothing is deleted when every write succeeds", async () => {
  const { db, ops } = recordingDb({
    pages: [{ id: "p1", slug: "slug-p1", seed_input: "topic p1", refresh_enabled: true, last_refreshed_at: null }],
  });
  const deps = makeSupabaseRefreshDeps(db, async () => ({ new_items: [item("new1")], evidence_filings: {} }));
  const summary = await runRefresh(deps, NOW, silent);
  assert.equal(summary.refreshed[0].newItems, 1);
  assert.deepEqual(ops.filter((o) => o.op === "delete"), []);
});
