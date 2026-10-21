// Run with `npm test`. The welcome checklist: who sees it and how it counts.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChecklist,
  cleanProgress,
  isTrackedStep,
  joinedRecently,
  showChecklist,
} from "./checklist.ts";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

test("joinedRecently: within 14 days yes, older no, bad or future-dated handled", () => {
  assert.equal(joinedRecently(daysAgo(0), NOW), true);
  assert.equal(joinedRecently(daysAgo(13), NOW), true);
  assert.equal(joinedRecently(daysAgo(14), NOW), false);
  assert.equal(joinedRecently(daysAgo(60), NOW), false);
  assert.equal(joinedRecently(null, NOW), false);
  assert.equal(joinedRecently("nonsense", NOW), false);
  assert.equal(joinedRecently(new Date(NOW + 5 * 86_400_000).toISOString(), NOW), false);
});

test("showChecklist: members who joined recently and haven't dismissed it", () => {
  const base = { isMember: true, joinedAt: daysAgo(3), dismissed: false, now: NOW };
  assert.equal(showChecklist(base), true);
  assert.equal(showChecklist({ ...base, dismissed: true }), false);
  assert.equal(showChecklist({ ...base, isMember: false }), false);
  assert.equal(showChecklist({ ...base, joinedAt: daysAgo(20) }), false);
});

test("buildChecklist: a brand-new member has 1 of 5 done (joining)", () => {
  const c = buildChecklist({ slug: "ai", focus: null, progress: {}, ownsLivingPage: false });
  assert.equal(c.total, 5);
  assert.equal(c.done, 1);
  assert.deepEqual(c.items.map((i) => [i.key, i.done]), [
    ["join", true], ["focus", false], ["pinned", false], ["page", false], ["invite", false],
  ]);
});

test("buildChecklist: each item is done by its own signal", () => {
  const done = (o: Partial<Parameters<typeof buildChecklist>[0]>) =>
    buildChecklist({ slug: "ai", focus: null, progress: {}, ownsLivingPage: false, ...o }).items.filter((i) => i.done).map((i) => i.key);
  assert.deepEqual(done({ focus: "KRAS biology" }), ["join", "focus"]);
  assert.deepEqual(done({ focus: "   " }), ["join"], "a blank focus is not done");
  assert.deepEqual(done({ progress: { pinned_opened: true } }), ["join", "pinned"]);
  assert.deepEqual(done({ ownsLivingPage: true }), ["join", "page"]);
  assert.deepEqual(done({ progress: { link_copied: true } }), ["join", "invite"]);
  const all = buildChecklist({ slug: "ai", focus: "x", progress: { pinned_opened: true, link_copied: true }, ownsLivingPage: true });
  assert.equal(all.done, 5);
});

test("buildChecklist: the focus item opens the existing focus editor", () => {
  const c = buildChecklist({ slug: "ai-drug", focus: null, progress: {}, ownsLivingPage: false });
  assert.equal(c.items.find((i) => i.key === "focus")?.href, "/communities/ai-drug?tab=members&editFocus=1");
});

test("tracked steps: only the two known ones are accepted and stored", () => {
  assert.equal(isTrackedStep("pinned_opened"), true);
  assert.equal(isTrackedStep("link_copied"), true);
  assert.equal(isTrackedStep("focus"), false);
  assert.equal(isTrackedStep(undefined), false);
  assert.deepEqual(cleanProgress({ pinned_opened: true, link_copied: "yes", evil: true }), { pinned_opened: true });
  assert.deepEqual(cleanProgress(null), {});
  assert.deepEqual(cleanProgress([1]), {});
});
