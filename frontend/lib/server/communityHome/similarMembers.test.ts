// Run with `npm test`. "Members working on similar things": word-overlap
// matching, the reason line, stopwords, and who may be compared at all.

import test from "node:test";
import assert from "node:assert/strict";
import { buildSimilarity, closestFirst, hasFocus, reasonLine, similarMembers } from "./similarMembers.ts";

const person = (id: string, name: string, focus: string | null, pageTexts: string[] = []) => ({ id, name, focus, pageTexts });
const ME = { focus: "KRAS in pancreatic cancer", pageTexts: [] as string[] };

// ── matching ─────────────────────────────────────────────────────────────────

test("closest first: more shared words ranks higher, members with nothing in common are left out", () => {
  const out = similarMembers(ME, [
    person("a", "Ann", "Pancreatic cancer biomarkers"),
    person("b", "Bo", "KRAS inhibitors in pancreatic cancer"),
    person("c", "Cy", "Cardiac imaging"),
    person("d", "Di", "KRAS structure"),
  ]);
  assert.deepEqual(out.map((m) => m.id), ["b", "a", "d"]);
  assert.ok(out[0].score > out[1].score && out[1].score >= out[2].score);
});

test("ties keep the order given", () => {
  const out = similarMembers(ME, [person("x", "X", "KRAS lab"), person("y", "Y", "KRAS clinic")]);
  assert.deepEqual(out.map((m) => m.id), ["x", "y"]);
});

test("matching ignores case and punctuation", () => {
  const out = similarMembers(ME, [person("a", "Ann", "kras; PANCREATIC-cancer models")]);
  assert.equal(out.length, 1);
});

test("wiki page titles and seed topics count, for the viewer and for the other member", () => {
  const mine = { focus: "Drug resistance", pageTexts: ["EGFR inhibitor resistance in lung cancer"] };
  const out = similarMembers(mine, [
    person("a", "Ann", "Imaging", ["Osimertinib and EGFR in lung cancer"]),
    person("b", "Bo", "Imaging", ["Cardiac MRI"]),
  ]);
  assert.deepEqual(out.map((m) => m.id), ["a"]);
  assert.match(out[0].reason, /EGFR/);
});

test("a word in both focus lines counts for more than one only found in a page", () => {
  const mine = { focus: "glioblastoma", pageTexts: ["immunotherapy"] };
  const [first, second] = similarMembers(mine, [
    person("page", "Page", "x", ["immunotherapy trials"]),
    person("focus", "Focus", "glioblastoma models"),
  ]);
  assert.equal(first.id, "focus");
  assert.equal(second.id, "page");
});

// ── reason words ─────────────────────────────────────────────────────────────

test("reason: shared words as phrases in the viewer's own spelling", () => {
  const [m] = similarMembers(ME, [person("a", "Ann", "pancreatic cancer and kras")]);
  assert.deepEqual(m.shared, ["KRAS", "pancreatic cancer"]);
  assert.equal(m.reason, "Both: KRAS, pancreatic cancer");
});

test("reason: only the words they share, nothing else of the viewer's", () => {
  const [m] = similarMembers(ME, [person("a", "Ann", "pancreatic organoids")]);
  assert.equal(m.reason, "Both: pancreatic");
  assert.ok(!/KRAS/.test(m.reason));
});

test("reasonLine of nothing is empty", () => {
  assert.equal(reasonLine([]), "");
  assert.equal(reasonLine(["KRAS"]), "Both: KRAS");
});

// ── stopwords ────────────────────────────────────────────────────────────────

test("generic science words and short words never make a match", () => {
  const mine = { focus: "signaling pathways in the of", pageTexts: [] };
  assert.deepEqual(similarMembers(mine, [person("a", "Ann", "signaling pathways in the of")]), []);
  // "in", "the", "of" are too short or too common; "however" is a science filler word.
  assert.deepEqual(similarMembers({ focus: "however", pageTexts: [] }, [person("a", "Ann", "however")]), []);
});

test("a stopword does not appear in the reason", () => {
  const [m] = similarMembers({ focus: "KRAS signaling", pageTexts: [] }, [person("a", "Ann", "KRAS signaling networks")]);
  assert.equal(m.reason, "Both: KRAS");
});

test("no focus, no similarity", () => {
  assert.deepEqual(similarMembers({ focus: null, pageTexts: ["KRAS"] }, [person("a", "Ann", "KRAS")]), []);
  assert.deepEqual(similarMembers({ focus: "   ", pageTexts: [] }, [person("a", "Ann", "KRAS")]), []);
  assert.equal(hasFocus("  "), false);
  assert.equal(hasFocus("KRAS"), true);
});

test("max caps the list", () => {
  const many = Array.from({ length: 9 }, (_, i) => person(`m${i}`, `M${i}`, "KRAS biology"));
  assert.equal(similarMembers(ME, many, 5).length, 5);
});

// ── the Members-tab order ────────────────────────────────────────────────────

test("closestFirst: similar members first in closeness order, everyone else after in their own order", () => {
  const roster = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const similar = similarMembers(ME, [
    person("c", "C", "KRAS pancreatic cancer"),
    person("a", "A", "KRAS"),
  ]);
  assert.deepEqual(closestFirst(roster, similar).map((x) => x.id), ["c", "a", "b", "d"]);
  assert.deepEqual(closestFirst(roster, []).map((x) => x.id), ["a", "b", "c", "d"]);
});

// ── privacy ──────────────────────────────────────────────────────────────────

const ROSTER = [
  { member_id: "m-me", user_id: "u-me", display_name: "Me", focus: "KRAS in pancreatic cancer", hidden: false },
  { member_id: "m-ann", user_id: "u-ann", display_name: "Ann", focus: "Pancreatic cancer", hidden: false },
  { member_id: "m-hid", user_id: "u-hid", display_name: "Staff", focus: "KRAS pancreatic cancer", hidden: true },
  { member_id: "m-inv", user_id: null, display_name: "Invited", focus: "KRAS", hidden: false },
];
const PAGES = [
  { owner_id: "u-ann", title: "KRAS landscape", seed_input: "KRAS mutations" },
  { owner_id: "u-someone-else", title: "KRAS elsewhere", seed_input: "KRAS" },
];
const base = { isMember: true, viewerUserId: "u-me", myFocus: "KRAS in pancreatic cancer", myPageTexts: [], roster: ROSTER, pages: PAGES };

test("privacy: a member with a focus gets matches; never themselves, never a hidden member", () => {
  const r = buildSimilarity(base)!;
  const ids = r.all.map((m) => m.id);
  assert.ok(ids.includes("m-ann") && ids.includes("m-inv"));
  assert.ok(!ids.includes("m-me"), "not compared with themselves");
  assert.ok(!ids.includes("m-hid"), "hidden members stay hidden");
});

test("privacy: signed out, or signed in but not a member, gets no similarity", () => {
  assert.equal(buildSimilarity({ ...base, isMember: false }), null);
  assert.equal(buildSimilarity({ ...base, viewerUserId: null }), null);
  assert.equal(buildSimilarity({ ...base, isMember: false, viewerUserId: null }), null);
});

test("privacy: no focus of their own, no similarity (even with pages of their own)", () => {
  assert.equal(buildSimilarity({ ...base, myFocus: null, myPageTexts: ["KRAS"] }), null);
  assert.equal(buildSimilarity({ ...base, myFocus: "  " }), null);
});

test("privacy: pages are only used for their owner, and only the ones passed in", () => {
  const r = buildSimilarity({ ...base, roster: [ROSTER[1]], pages: [] })!;
  const withoutPages = r.all.find((m) => m.id === "m-ann")!;
  assert.deepEqual(withoutPages.shared, ["pancreatic cancer"]);
  const withPages = buildSimilarity(base)!.all.find((m) => m.id === "m-ann")!;
  assert.ok(withPages.shared.includes("KRAS"), "Ann's visible page adds KRAS");
  // someone else's page never leaks onto Ann
  assert.ok(!buildSimilarity({ ...base, pages: [PAGES[1]] })!.all.find((m) => m.id === "m-ann")!.shared.includes("KRAS"));
});

test("privacy: a result carries no email and no user id", () => {
  const r = buildSimilarity({ ...base, roster: ROSTER.map((m) => ({ ...m, email: "secret@x.org" })) })!;
  for (const item of r.all) {
    assert.deepEqual(Object.keys(item).sort(), ["focus", "id", "name", "reason", "score", "shared"]);
    assert.ok(!JSON.stringify(item).includes("secret@x.org"));
    assert.ok(!JSON.stringify(item).includes("u-ann"));
  }
});

test("buildSimilarity max caps items but keeps the full list for the Members tab", () => {
  const roster = Array.from({ length: 8 }, (_, i) => ({ member_id: `m${i}`, user_id: `u${i}`, display_name: `N${i}`, focus: "KRAS biology", hidden: false }));
  const r = buildSimilarity({ ...base, roster, pages: [], max: 5 })!;
  assert.equal(r.items.length, 5);
  assert.equal(r.all.length, 8);
});
