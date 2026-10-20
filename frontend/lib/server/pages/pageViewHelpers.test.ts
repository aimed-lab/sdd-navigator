// Run with `npm test` (node --test). Pure helpers behind the /pages screens.

import test from "node:test";
import assert from "node:assert/strict";
import {
  citationNumber,
  creationLine,
  formatDay,
  groupEvidenceByKind,
  groupUpdatesByDate,
  initialSourceCount,
  newItemsCutoffIso,
  parseNoteBody,
  summarizeKinds,
  type EvidenceRow,
  type UpdateRow,
} from "./pageViewHelpers.ts";

const NOW = new Date("2026-10-20T12:00:00Z");

const upd = (id: string, kind: string, occurred_on: string): UpdateRow => ({
  id,
  kind,
  title: `T ${id}`,
  summary: null,
  url: `https://x/${id}`,
  occurred_on,
});

test("formatDay: no timezone drift, year only when it is not this year", () => {
  assert.equal(formatDay("2026-10-20", NOW), "Oct 20");
  assert.equal(formatDay("2026-10-20T23:59:59Z", NOW), "Oct 20");
  assert.equal(formatDay("2025-01-05", NOW), "Jan 5, 2025");
  assert.equal(formatDay(null, NOW), null);
  assert.equal(formatDay("nonsense", NOW), null);
});

test("summarizeKinds: counts with singular and plural nouns in a stable order", () => {
  assert.equal(
    summarizeKinds([{ kind: "approval" }, { kind: "paper" }, { kind: "paper" }, { kind: "paper" }]),
    "3 new papers, 1 new FDA approval"
  );
  assert.equal(summarizeKinds([{ kind: "trial" }, { kind: "trial" }]), "2 new clinical trials");
});

test("groupUpdatesByDate: newest day first, headline reads 'Oct 20: ...'", () => {
  const groups = groupUpdatesByDate(
    [
      upd("a", "paper", "2026-10-18"),
      upd("b", "paper", "2026-10-20"),
      upd("c", "paper", "2026-10-20"),
      upd("d", "paper", "2026-10-20"),
      upd("e", "approval", "2026-10-20"),
    ],
    NOW
  );
  assert.deepEqual(groups.map((g) => g.date), ["2026-10-20", "2026-10-18"]);
  assert.equal(groups[0].headline, "Oct 20: 3 new papers, 1 new FDA approval");
  assert.equal(groups[1].headline, "Oct 18: 1 new paper");
  assert.equal(groups[0].items.length, 4);
});

test("citationNumber: only the page agent's 'Cited as [n]' rationale counts", () => {
  assert.equal(citationNumber("Cited as [3]"), 3);
  assert.equal(citationNumber('Shares "kinase" with this note.'), null);
  assert.equal(citationNumber(null), null);
});

test("parseNoteBody: resolves known citations and note links, leaves unknown ones as text", () => {
  const paragraphs = parseNoteBody(
    "EGFR drives growth [1]. See [[Resistance]] and also [9].\n\nSecond paragraph [2].",
    new Map([[1, "ev-1"], [2, "ev-2"]]),
    new Map([["resistance", "resistance"]])
  );
  assert.equal(paragraphs.length, 2);
  assert.deepEqual(paragraphs[0].filter((p) => p.type === "cite"), [{ type: "cite", n: 1, itemId: "ev-1" }]);
  assert.deepEqual(paragraphs[0].filter((p) => p.type === "notelink"), [
    { type: "notelink", title: "Resistance", slug: "resistance" },
  ]);
  // [9] has no evidence for this note: stays literal text.
  assert.ok(paragraphs[0].some((p) => p.type === "text" && p.text.includes("[9]")));
  assert.deepEqual(paragraphs[1].filter((p) => p.type === "cite"), [{ type: "cite", n: 2, itemId: "ev-2" }]);
});

test("parseNoteBody: a link to a note that does not exist has no slug", () => {
  const [parts] = parseNoteBody("See [[Ghost]].", new Map(), new Map());
  assert.deepEqual(parts.filter((p) => p.type === "notelink"), [{ type: "notelink", title: "Ghost", slug: null }]);
});

test("groupEvidenceByKind: papers first, then Explore order, unknown kinds last", () => {
  const row = (item_id: string, kind: string): EvidenceRow => ({
    id: `id-${item_id}`,
    item_id,
    kind,
    title: item_id,
    summary: null,
    url: null,
    source: "s",
    date_iso: null,
    signal_metric: null,
    signal_value: null,
    signal_as_of: null,
  });
  const sections = groupEvidenceByKind([
    row("g", "grant"),
    row("x", "weird"),
    row("t", "trial"),
    row("p1", "paper"),
    row("p2", "paper"),
    row("a", "approval"),
  ]);
  assert.deepEqual(sections.map((s) => s.kind), ["paper", "trial", "approval", "grant", "weird"]);
  assert.deepEqual(sections[0].items.map((i) => i.id), ["p1", "p2"]);
});

test("newItemsCutoffIso: seven days back", () => {
  assert.equal(newItemsCutoffIso(NOW), "2026-10-13T12:00:00.000Z");
});

test("initialSourceCount: evidence no refresh update announced is the first build", () => {
  assert.equal(initialSourceCount(["e1", "e2", "e3", "e4"], [{ evidence_id: "e3" }, { evidence_id: null }, { evidence_id: "e4" }]), 2);
  assert.equal(initialSourceCount([], []), 0);
  assert.equal(initialSourceCount(["e1"], []), 1);
});

test("creationLine: 'Page created <date> with <N> sources'", () => {
  assert.equal(creationLine("2026-10-20T08:00:00Z", 12, NOW), "Page created Oct 20 with 12 sources");
  assert.equal(creationLine("2026-10-20T08:00:00Z", 1, NOW), "Page created Oct 20 with 1 source");
  assert.equal(creationLine("2026-10-20T08:00:00Z", 0, NOW), "Page created Oct 20");
  assert.equal(creationLine("2025-03-02T08:00:00Z", 3, NOW), "Page created Mar 2, 2025 with 3 sources");
  assert.equal(creationLine(null, 3, NOW), "Page created with 3 sources");
});
