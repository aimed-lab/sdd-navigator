import test from "node:test";
import assert from "node:assert/strict";
import {
  NOTE_BODY_MAX,
  NOTE_TITLE_MAX,
  editedByLabel,
  nextPosition,
  pageCrumbs,
  pageDateLine,
  parseNoteInput,
  sectionSlug,
} from "./pageEditCore.ts";

// ── what is typed in the section editor ──────────────────────────────────────

test("a section needs a title; the title is cleaned and the text keeps its line breaks", () => {
  const r = parseNoteInput("  CD38   and fibrosis ", "Line one\r\n\r\n  Line two  ");
  assert.deepEqual(r, { ok: true, value: { title: "CD38 and fibrosis", body: "Line one\n\n  Line two" } });
  assert.equal(parseNoteInput("", "text").ok, false);
  assert.equal(parseNoteInput("   ", "text").ok, false);
  assert.equal(parseNoteInput(undefined, "text").ok, false);
  assert.equal(parseNoteInput(5, "text").ok, false);
});

test("a section may have an empty body but not an over-long title or body", () => {
  assert.deepEqual(parseNoteInput("Title", ""), { ok: true, value: { title: "Title", body: "" } });
  assert.deepEqual(parseNoteInput("Title", null), { ok: true, value: { title: "Title", body: "" } });
  assert.equal(parseNoteInput("t".repeat(NOTE_TITLE_MAX + 1), "x").ok, false);
  assert.equal(parseNoteInput("t".repeat(NOTE_TITLE_MAX), "x").ok, true);
  assert.equal(parseNoteInput("t", "b".repeat(NOTE_BODY_MAX + 1)).ok, false);
  assert.equal(parseNoteInput("t", "b".repeat(NOTE_BODY_MAX)).ok, true);
});

test("a new section's slug comes from its title and never collides", () => {
  assert.equal(sectionSlug("Open Questions", []), "open-questions");
  assert.equal(sectionSlug("Open Questions", ["open-questions"]), "open-questions-2");
  assert.equal(sectionSlug("Open Questions", ["open-questions", "open-questions-2"]), "open-questions-3");
  assert.equal(sectionSlug("Café: α/β?", []), "cafe");
  assert.equal(sectionSlug("???", []), "section");
  assert.equal(sectionSlug("???", ["section"]), "section-2");
  assert.ok(sectionSlug("x".repeat(300), []).length <= 60);
});

test("a new section goes at the end", () => {
  assert.equal(nextPosition([]), 0);
  assert.equal(nextPosition([0, 1, 2]), 3);
  assert.equal(nextPosition([5, 2]), 6);
});

// ── "Edited by" ──────────────────────────────────────────────────────────────

test("'Edited by' wording", () => {
  assert.equal(editedByLabel({ isHumanEdited: false, editedByViewer: false, name: "Ada" }), null);
  assert.equal(editedByLabel({ isHumanEdited: true, editedByViewer: true, name: "Ada" }), "Edited by you");
  assert.equal(editedByLabel({ isHumanEdited: true, editedByViewer: false, name: "Ada Lovelace" }), "Edited by Ada Lovelace");
  assert.equal(editedByLabel({ isHumanEdited: true, editedByViewer: false, name: null }), "Edited by a person");
});

// ── breadcrumbs ──────────────────────────────────────────────────────────────

const project = { id: "p1", name: "CD38 Fibrosis Team" };

test("a project page shows '<project> / Wiki', both linking to the project's wiki tab", () => {
  assert.deepEqual(pageCrumbs({ project, parent: null }), [
    { label: "CD38 Fibrosis Team", href: "/projects/p1?tab=wiki" },
    { label: "Wiki", href: "/projects/p1?tab=wiki" },
  ]);
});

test("a sub-page shows '<project> / <parent page title>', the parent linking to its page", () => {
  assert.deepEqual(pageCrumbs({ project, parent: { slug: "cd38-abc", title: "CD38 overview" } }), [
    { label: "CD38 Fibrosis Team", href: "/projects/p1?tab=wiki" },
    { label: "CD38 overview", href: "/pages/cd38-abc" },
  ]);
});

test("a page outside a project (or one whose project the viewer cannot see) has no breadcrumb", () => {
  assert.equal(pageCrumbs({ project: null, parent: null }), null);
  assert.equal(pageCrumbs({ project: null, parent: { slug: "s", title: "T" } }), null);
});

// ── date line in a project's wiki list ───────────────────────────────────────

const now = new Date("2026-10-26T12:00:00Z");

test("a page never refreshed shows 'Created <date>', not 'Not updated yet'", () => {
  assert.equal(pageDateLine(null, "2026-10-22T08:15:00Z", now), "Created Oct 22");
  assert.equal(pageDateLine("", "2026-10-22T08:15:00Z", now), "Created Oct 22");
  assert.equal(pageDateLine(undefined, "2025-03-04T00:00:00Z", now), "Created Mar 4, 2025");
});

test("a refreshed page shows 'Updated <date>'; with no dates at all it falls back", () => {
  assert.equal(pageDateLine("2026-10-25T01:00:00Z", "2026-10-22T08:15:00Z", now), "Updated Oct 25");
  assert.equal(pageDateLine(null, null, now), "Not updated yet");
  assert.equal(pageDateLine(null, "garbage", now), "Not updated yet");
});
