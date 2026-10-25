import test from "node:test";
import assert from "node:assert/strict";
import { realProjectOps, statusOfMyProjects } from "./agentProjectOps.ts";

type Row = Record<string, unknown>;

// A tiny fake of the Supabase query builder: tables of rows, .eq/.in filters,
// order/limit ignored, awaited like a promise. `visible` models row-level
// security: only rows of projects the researcher is on come back.
function fakeDb(tables: Record<string, Row[]>, names: Row[] = []) {
  const reads: string[] = [];
  const db = {
    from(table: string) {
      reads.push(table);
      let rows = tables[table] ?? [];
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = chain;
      q.order = chain;
      q.limit = chain;
      q.eq = (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), q);
      q.in = (col: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[col]))), q);
      q.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
      return q;
    },
    rpc: async () => ({ data: names, error: null }),
  };
  return { db, reads };
}

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

const tables = () => ({
  project_members: [
    { project_id: P1, user_id: "me", role: "lead" },
    { project_id: P1, user_id: "u2", role: "member" },
    { project_id: P2, user_id: "me", role: "member" },
    { project_id: "other", user_id: "u9", role: "lead" },
  ],
  projects: [
    { id: P1, name: "CD38 Fibrosis", challenge_key: "colabofest_2026", created_at: "2026-10-01T00:00:00Z" },
    { id: P2, name: "KRAS Pilot", challenge_key: null, created_at: "2026-10-01T00:00:00Z" },
    { id: "other", name: "Not mine", challenge_key: null, created_at: "2026-10-01T00:00:00Z" },
  ],
  checklist_items: [
    { project_id: P1, label: "Order reagents", status: "not_yet", position: 1, list_key: "team", due_date: "2026-10-05", assignee_id: "u2" },
  ],
  project_updates: [
    { id: "a", project_id: P1, author_id: "u2", kind: "help", body: "Need an antibody", created_at: "2026-10-20T00:00:00Z", resolved_at: null },
  ],
  pages: [{ project_id: P1, title: "CD38 overview" }],
});

test("list: only the projects the researcher is on, with label, role and team size", async () => {
  const { db } = fakeDb(tables());
  const list = await realProjectOps.list(db, "me");
  assert.deepEqual(list.map((p) => [p.name, p.label, p.my_role, p.team_size]), [
    ["CD38 Fibrosis", "ColaboFest 2026", "lead", 2],
    ["KRAS Pilot", null, "member", 1],
  ]);
});

test("list: a researcher on no project gets an empty list", async () => {
  const { db } = fakeDb(tables());
  assert.deepEqual(await realProjectOps.list(db, "nobody"), []);
});

test("status: checklist, overdue owner name, open help, wiki titles", async () => {
  const { db } = fakeDb(tables(), [{ user_id: "u2", name: "Bo" }]);
  const s = await realProjectOps.status(db, P1, new Date("2026-10-27T12:00:00Z"));
  assert.ok(s);
  assert.equal(s!.project, "CD38 Fibrosis");
  assert.equal(s!.status, "Needs help");
  assert.deepEqual(s!.overdue_items, [{ item: "Order reagents", list: "Team tasks", owner: "Bo", due: "2026-10-05" }]);
  assert.deepEqual(s!.open_help_requests.map((h) => [h.text, h.by]), [["Need an antibody", "Bo"]]);
  assert.deepEqual(s!.wiki_pages, ["CD38 overview"]);
});

test("status: a project the researcher cannot see comes back as nothing (row-level security)", async () => {
  const t = tables();
  t.projects = t.projects.filter((p) => p.id !== P2); // RLS hides it
  const { db } = fakeDb(t);
  assert.equal(await realProjectOps.status(db, P2), null);
});

test("status of my projects: all of them, or only the ColaboFest ones, capped", async () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const all = await statusOfMyProjects(realProjectOps, fakeDb(tables()).db, "me", { now });
  assert.deepEqual(all.projects.map((p) => p.project), ["CD38 Fibrosis", "KRAS Pilot"]);
  assert.equal(all.total, 2);

  const cf = await statusOfMyProjects(realProjectOps, fakeDb(tables()).db, "me", { colabofestOnly: true, now });
  assert.deepEqual(cf.projects.map((p) => p.project), ["CD38 Fibrosis"]);

  const capped = await statusOfMyProjects(realProjectOps, fakeDb(tables()).db, "me", { max: 1, now });
  assert.equal(capped.projects.length, 1);
  assert.equal(capped.total, 2);
});

test("it only reads: no write method is ever used on the database", async () => {
  const { db, reads } = fakeDb(tables());
  await statusOfMyProjects(realProjectOps, db, "me");
  assert.ok(reads.length > 0);
  assert.ok(!("insert" in db) && !("update" in db) && !("delete" in db));
});
