import test from "node:test";
import assert from "node:assert/strict";
import { insertPageRow } from "./pageInsert.ts";

// A fake client that behaves like an RLS-enforcing one: any insert that asks
// for rows back (.select/.single/.returns) fails with the policy error, because
// "Pages: read" cannot see a row inside the statement that inserts it.
function fakeDb(errors: Array<{ code?: string; message: string } | null> = []) {
  const inserted: Record<string, unknown>[] = [];
  let returningRequested = false;
  const db = {
    from(table: string) {
      assert.equal(table, "pages");
      return {
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          const error = errors.shift() ?? null;
          const result = Promise.resolve({ error });
          return Object.assign(result, {
            select() {
              returningRequested = true;
              return { single: () => Promise.resolve({ data: null, error: { message: 'new row violates row-level security policy for table "pages"' } }) };
            },
          });
        },
      };
    },
  };
  return { db, inserted, returning: () => returningRequested };
}

const base = { title: "CD38 inhibition in lung fibrosis", seed_input: "CD38 inhibition in lung fibrosis", owner_id: "u1", visibility: "team" };

test("the page row is inserted with an id made in code and without asking for rows back", async () => {
  const f = fakeDb();
  const r = await insertPageRow(f.db, { ...base, project_id: "p1" }, () => "cd38-abc123", () => "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(r, { ok: true, id: "11111111-1111-4111-8111-111111111111", slug: "cd38-abc123" });
  assert.equal(f.returning(), false, "RETURNING would fail the 'Pages: read' policy for a session client");
  assert.equal(f.inserted.length, 1);
  assert.equal(f.inserted[0].id, "11111111-1111-4111-8111-111111111111");
  assert.equal(f.inserted[0].owner_id, "u1");
});

test("a project page carries project_id and parent_page_id; an ordinary page carries neither", async () => {
  const withProject = fakeDb();
  await insertPageRow(withProject.db, { ...base, project_id: "p1", parent_page_id: "par1" }, () => "s");
  assert.equal(withProject.inserted[0].project_id, "p1");
  assert.equal(withProject.inserted[0].parent_page_id, "par1");
  assert.equal(withProject.inserted[0].seed_type, "topic");

  const plain = fakeDb();
  await insertPageRow(plain.db, { ...base }, () => "s");
  assert.ok(!("project_id" in plain.inserted[0]) && !("parent_page_id" in plain.inserted[0]));
  const anon = fakeDb();
  await insertPageRow(anon.db, { ...base, owner_id: null, visibility: "public" }, () => "s");
  assert.equal(anon.inserted[0].owner_id, null);
});

test("a slug collision retries with a new slug and the same id; other errors stop at once", async () => {
  let n = 0;
  const f = fakeDb([{ code: "23505", message: "dup" }, null]);
  const r = await insertPageRow(f.db, base, () => `slug-${++n}`, () => "id-1");
  assert.deepEqual(r, { ok: true, id: "id-1", slug: "slug-2" });
  assert.deepEqual(f.inserted.map((x) => x.slug), ["slug-1", "slug-2"]);
  assert.ok(f.inserted.every((x) => x.id === "id-1"));

  const bad = fakeDb([{ code: "42501", message: "denied" }, null]);
  const r2 = await insertPageRow(bad.db, base, () => "s");
  assert.deepEqual(r2, { ok: false, error: "denied" });
  assert.equal(bad.inserted.length, 1);

  const stuck = fakeDb([{ code: "23505", message: "dup" }, { code: "23505", message: "dup" }, { code: "23505", message: "dup" }]);
  const r3 = await insertPageRow(stuck.db, base, () => "s", () => "i", 3);
  assert.deepEqual(r3, { ok: false, error: "dup" });
  assert.equal(stuck.inserted.length, 3);
});

test("generated ids are real UUIDs by default", async () => {
  const f = fakeDb();
  const r = await insertPageRow(f.db, base, () => "s");
  assert.ok(r.ok && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.id));
});
