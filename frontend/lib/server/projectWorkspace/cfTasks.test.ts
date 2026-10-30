import test from "node:test";
import assert from "node:assert/strict";
import { barLine, buildCfLists, canEditList, canMarkItem, ctaBanner, progressTotals, showTasksTile, timelineState, visibleCfLists } from "./cfTasks.ts";
import { FINALIST_TASKS } from "../../colabofestConfig.ts";

const item = (id: string, label: string, list: string, status = "not_yet", position = 1) => ({ id, label, status, position, list_key: list });

test("permissions: lead/manager mark team items, only managers the other lists and all edits", () => {
  assert.equal(canMarkItem("lead", "team"), true);
  assert.equal(canMarkItem("manager", "team"), true);
  assert.equal(canMarkItem("member", "team"), false);
  assert.equal(canMarkItem("lead", "sparc"), false);
  assert.equal(canMarkItem("manager", "southern_research"), true);
  assert.equal(canEditList("manager"), true);
  assert.equal(canEditList("lead"), false);
});

test("three lists, progress counts all of them, the CTA only the finalist tasks", () => {
  const lists = buildCfLists([item("a", "x", "sparc", "ready"), item("b", "y", "sparc"), item("c", "z", "southern_research")], true);
  assert.deepEqual(lists.map((l) => l.key), ["team", "sparc", "southern_research"]);
  assert.equal(lists[0].total, FINALIST_TASKS.length);
  const p = progressTotals(lists);
  assert.equal(p.total, FINALIST_TASKS.length + 3);
  assert.equal(p.done, 1);
  assert.equal(ctaBanner({ finalist: true, finalistDone: 1, finalistTotal: 3 })?.sub, "Due Nov 11 · 1 of 3 done");
  assert.equal(ctaBanner({ finalist: true, finalistDone: 3, finalistTotal: 3 }), null);
  assert.equal(ctaBanner({ finalist: false, finalistDone: 0, finalistTotal: 0 }), null);
  assert.equal(barLine(2, 5), "2 of 5 done");
});

test("Southern Research hides when empty unless manager; tasks tile for non-finalists only with items", () => {
  const empty = buildCfLists([], false);
  assert.equal(visibleCfLists(empty, "member").some((l) => l.key === "southern_research"), false);
  assert.equal(visibleCfLists(empty, "manager").some((l) => l.key === "southern_research"), true);
  assert.equal(showTasksTile(empty, false, "member"), false);
  assert.equal(showTasksTile(buildCfLists([item("a", "x", "sparc")], false), false, "member"), true);
  assert.equal(showTasksTile(empty, true, "member"), true);
});

test("timeline states", () => {
  assert.deepEqual(timelineState([{ from: "2026-01-01" }, { from: "2026-02-01" }, { from: "2026-03-01" }], "2026-01-15"), ["past", "next", "later"]);
});
