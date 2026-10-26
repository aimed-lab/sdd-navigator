import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizePreview, openParam, parseOpen, parseOpenShape } from "./teamPreview.ts";
import { teamReturnPath } from "./teamRules.ts";

const TEAM = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const PAGE = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

// ── the preview hides names, URLs and content ───────────────────────────────

test("preview keeps only id, name, description, count and item titles with a kind", () => {
  const p = normalizePreview({
    id: TEAM,
    name: "Intro to AI in Medicine",
    description: "A course",
    member_count: "12",
    documents: [
      { id: DOC, title: "Week 1 slides", kind: "slides", url: "https://secret.example/x", storage_path: "t/a.pptx", description: "private note", added_by: "Ada Lovelace" },
    ],
    pages: [{ id: PAGE, title: "Intro page", kind: "page", slug: "intro-page-abc", content: "SECRET BODY", owner_email: "a@b.org" }],
    members: [{ name: "Ada Lovelace", email: "ada@example.org" }],
    emails: ["ada@example.org"],
  });
  assert.ok(p);
  assert.deepEqual(Object.keys(p).sort(), ["description", "documents", "id", "member_count", "name", "pages"]);
  assert.equal(p.member_count, 12);
  assert.deepEqual(p.documents, [{ id: DOC, title: "Week 1 slides", kind: "slides" }]);
  assert.deepEqual(p.pages, [{ id: PAGE, title: "Intro page", kind: "page" }]);
  const json = JSON.stringify(p);
  for (const leak of ["secret.example", "storage_path", "SECRET BODY", "intro-page-abc", "Ada", "@", "private note"]) {
    assert.ok(!json.includes(leak), leak);
  }
});

test("preview: unknown slug or malformed answer is null; bad items are dropped", () => {
  assert.equal(normalizePreview(null), null);
  assert.equal(normalizePreview([]), null);
  assert.equal(normalizePreview({ id: "nope", name: "x" }), null);
  const p = normalizePreview({
    id: TEAM,
    name: "T",
    member_count: 1,
    documents: [{ id: "bad", title: "x", kind: "pdf" }, { id: DOC, title: "ok", kind: "weird" }, { id: OTHER, title: "  " }],
    pages: "nope",
  });
  assert.deepEqual(p?.documents, [{ id: DOC, title: "ok", kind: "link" }]);
  assert.deepEqual(p?.pages, []);
});

test("the SQL function returns only the allowed fields and is granted to anon", () => {
  const sql = readFileSync(new URL("../../../../database/migrations/2026-10-30_team_preview.sql", import.meta.url), "utf8");
  const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.get_team_preview"));
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /c\.kind = 'team'/);
  assert.match(body, /GRANT EXECUTE ON FUNCTION public\.get_team_preview\(TEXT\) TO anon, authenticated;/);
  // What goes into the JSON: no link or file addresses, storage paths, slugs, content or people.
  const built = body.replace(/--.*$/gm, "");
  for (const key of ["'id'", "'name'", "'description'", "'member_count'", "'documents'", "'pages'", "'title'", "'kind'"]) {
    assert.ok(built.includes(key), key);
  }
  for (const bad of ["'url'", "'slug'", "'content'", "'email'", "'storage", "'filename'", "'added_by'", "'user_id'", "'display_name'"]) {
    assert.ok(!built.includes(bad), bad);
  }
  assert.ok(!/p\.slug|p\.content|p\.body|\bu\.email|display_name/.test(body.replace(/--.*$/gm, "")));
});

// ── ?open= ──────────────────────────────────────────────────────────────────

test("open: known kinds only, with the right id shape", () => {
  assert.deepEqual(parseOpenShape(`doc:${DOC}`), { kind: "doc", id: DOC });
  assert.deepEqual(parseOpenShape(`page:${PAGE.toUpperCase()}`), { kind: "page", id: PAGE });
  assert.deepEqual(parseOpenShape("tile:learn"), { kind: "tile", id: "learn" });
  for (const bad of [
    undefined, null, 42, "", "doc", `doc:`, `doc:not-a-uuid`, `file:${DOC}`, `tile:admin`, `tile:`,
    `doc:${DOC}:extra`, `doc:${DOC}/../x`, `javascript:alert(1)`, `page:${PAGE}&x=1`, "a".repeat(200),
  ]) {
    assert.equal(parseOpenShape(bad), null, String(bad));
  }
});

test("open: a doc or page must belong to this team; tiles need no id", () => {
  const team = { docIds: [DOC], pageIds: [PAGE] };
  assert.deepEqual(parseOpen(`doc:${DOC}`, team), { kind: "doc", id: DOC });
  assert.deepEqual(parseOpen(`page:${PAGE}`, team), { kind: "page", id: PAGE });
  assert.equal(parseOpen(`doc:${OTHER}`, team), null);
  assert.equal(parseOpen(`page:${DOC}`, team), null);
  assert.equal(parseOpen(`doc:${PAGE}`, team), null);
  assert.deepEqual(parseOpen("tile:share", team), { kind: "tile", id: "share" });
  assert.equal(parseOpen("tile:nope", team), null);
});

test("sign-in returns to the same team with join=signin and what was clicked", () => {
  assert.equal(openParam("doc", DOC), `doc:${DOC}`);
  assert.equal(teamReturnPath("alpha", openParam("tile", "learn")), "/teams/alpha?join=signin&open=tile:learn");
  assert.equal(teamReturnPath("alpha"), "/teams/alpha?join=signin");
});
