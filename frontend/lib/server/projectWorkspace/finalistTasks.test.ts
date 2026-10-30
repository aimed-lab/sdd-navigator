import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MANAGE_SECTIONS,
  PROJECT_VIEWS,
  canManageProject,
  canMarkTask,
  finalistBanner,
  finalistTaskRows,
  nextTimelineDate,
  resolveManageSection,
  resolveProjectView,
  tasksDone,
  tasksTileLine,
} from "./finalistTasks.ts";
import { COLABOFEST_CONTACT_EMAIL, FINALIST_TASKS } from "../../colabofestConfig.ts";

const lf = (t: string) => t.split(String.fromCharCode(13)).join("");
const src = (rel: string) => lf(readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8"));
const sql = (n: string) => lf(readFileSync(new URL(`../../../../database/migrations/${n}`, import.meta.url), "utf8"));
const code = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

test("three tasks with the agreed titles, and the contact email in the third", () => {
  assert.deepEqual(FINALIST_TASKS.map((t) => t.label), ["Finalize your readiness checklist", "Write your 6-week work plan", "Schedule your kickoff meeting"]);
  assert.ok(FINALIST_TASKS[2].description.includes(COLABOFEST_CONTACT_EMAIL));
  assert.match(FINALIST_TASKS[0].description, /\$20K service award/);
});

test("task status is read from the checklist item with the same label", () => {
  const items = [
    { id: "a", label: "Write your 6-week work plan", status: "ready" },
    { id: "b", label: "Schedule your kickoff meeting", status: "not_yet" },
    { id: "c", label: "Something else", status: "ready" },
  ];
  const rows = finalistTaskRows(items);
  assert.deepEqual(rows.map((r) => [r.key, r.done, r.itemId]), [["readiness", false, null], ["workplan", true, "a"], ["kickoff", false, "b"]]);
  assert.equal(tasksDone(rows), 1);
  assert.equal(tasksTileLine(1, 3), "1 of 3 done");
});

test("the to-do banner: finalists only, then the all-done line", () => {
  assert.equal(finalistBanner({ finalist: false, done: 0, total: 3 }), null);
  assert.deepEqual(finalistBanner({ finalist: true, done: 1, total: 3 }), { kind: "todo", text: "Next step: complete your 3 finalist tasks by Nov 11" });
  assert.deepEqual(finalistBanner({ finalist: true, done: 3, total: 3 }), { kind: "done", text: "All tasks done. The SPARC team will contact you." });
});

test("who marks a task, who manages", () => {
  assert.equal(canMarkTask("lead"), true);
  assert.equal(canMarkTask("manager"), true);
  assert.equal(canMarkTask("member"), false);
  assert.equal(canMarkTask(null), false);
  assert.equal(canManageProject("manager"), true);
  assert.equal(canManageProject("lead"), false);
  assert.equal(canManageProject("member"), false);
  assert.equal(canManageProject("member", true), true);
});

test("views: ?view= first, then the old ?tab=, only the ones the viewer has", () => {
  assert.deepEqual([...PROJECT_VIEWS], ["tasks", "files", "announcements", "team", "timeline", "manage"]);
  const member = ["tasks", "files", "announcements", "team", "timeline"] as const;
  assert.equal(resolveProjectView("timeline", undefined, member), "timeline");
  assert.equal(resolveProjectView(undefined, "updates", member), "announcements");
  assert.equal(resolveProjectView(undefined, "files", member), "files");
  assert.equal(resolveProjectView("manage", undefined, member), null, "a member has no Manage");
  assert.equal(resolveProjectView("discussions", undefined, member), null, "no Discussions");
  assert.equal(resolveProjectView(undefined, "discussions", member), null);
  assert.equal(resolveProjectView("tasks", undefined, ["files"]), null, "a non-finalist has no Tasks");
  assert.equal(resolveManageSection("wiki", false), "wiki");
  assert.equal(resolveManageSection("proposal", false), "announcements");
  assert.equal(resolveManageSection("proposal", true), "proposal");
  assert.equal(resolveManageSection(undefined, true), "announcements");
  assert.ok(MANAGE_SECTIONS.includes("team"));
});

test("timeline: the next date", () => {
  assert.deepEqual(nextTimelineDate("2026-10-30"), { label: "Finalist agreement due", shown: "Nov 11" });
  assert.deepEqual(nextTimelineDate("2026-11-11"), { label: "Finalist presentations and awards", shown: "Nov 13" });
  assert.equal(nextTimelineDate("2027-06-01"), null);
});

test("the ColaboFest page: finalists only for tasks, Discussions gone, access check kept, other projects untouched", () => {
  const page = src("app/projects/[id]/page.tsx");
  assert.match(page, /hasProjectMemberRow\(db, id, user\.id\)/);
  assert.match(page, /const isColabofest = project\.program === COLABOFEST_PROGRAM;/);
  assert.match(page, /isColabofest && colabView !== "manage"/);
  assert.match(page, /\.\.\.\(project\.finalist \? \(\["tasks"\] as ProjectView\[\]\) : \[\]\)/);
  // a project outside the program still goes through the old parseTab
  assert.match(page, /: parseTab\(sp\.tab, !!project\.challenge_key\)/);
  const colab = code(src("components/projects/workspace/ColabofestProject.tsx"));
  assert.doesNotMatch(colab, /DiscussionsList|ThreadView|listThreads|Discussions/);
  assert.match(colab, /finalist && tiles\.push|if \(finalist\) tiles\.push/);
  assert.match(colab, /showManage/);
  assert.match(colab, /border-dashed/);
  assert.match(colab, /Open in Box/);
  assert.match(colab, /Your files will appear here soon\./);
  assert.match(colab, /Don&apos;t see the folder\? Accept the Box invite email, or email/);
  assert.match(colab, /announcements\.slice\(0, 3\)/);
  assert.doesNotMatch(colab, /#(?:22c55e|16a34a|166534|dcfce7)|green-\d|emerald/);
  assert.match(src("app/projects/[id]/actions.ts"), /export async function setFinalistTaskAction/);
  const db = src("lib/server/projectWorkspace/finalistTasksDb.ts");
  assert.match(db, /canMarkTask\(\(me as/);
  assert.ok(db.indexOf("canMarkTask(") < db.indexOf('.from("checklist_items")'), "the role is checked before any write");
  const ui = src("components/projects/workspace/FinalistTasks.tsx");
  assert.match(ui, /\{canMark && \(/);
  assert.match(ui, /Mark not done/);
});

test("finalist tasks migration: idempotent, finalists of the program only, keyed by label", () => {
  const m = sql("2026-11-06_colabofest_finalist_tasks.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(m, /program = 'colabofest_2026'/);
  assert.match(m, /finalist = true/);
  assert.match(m, /NOT EXISTS/);
  for (const t of FINALIST_TASKS) assert.ok(m.includes(t.label), t.label);
  assert.match(m, /due_date/);
  assert.match(m, /2026-11-11/);
  assert.doesNotMatch(m, /DELETE|UPDATE |DROP /i);
});

test("the hero's small label is the project's description line", () => {
  const page = src("app/projects/[id]/page.tsx");
  assert.match(page, /label=\{heroLabel\(project\.description\)\}/);
  const colab = src("components/projects/workspace/ColabofestProject.tsx");
  assert.match(colab, /\(label \|\| "ColaboFest 2026"\)\.toUpperCase\(\)/);
});

test("ColaboFest project page: a My projects link above the hero, no floating chat button; other projects keep it", () => {
  const page = src("app/projects/[id]/page.tsx");
  const start = page.indexOf("if (isColabofest) {", page.indexOf("const taskRows") - 400);
  const end = page.indexOf("<ColabofestProject", start);
  const before = page.slice(start, end);
  assert.match(before, /href="\/projects"/);
  assert.match(before, /My projects/);
  const colab = page.slice(start, page.indexOf("</ColabofestProject>", start) > 0 ? page.indexOf("</ColabofestProject>", start) : page.indexOf("max-w-container-max", end));
  assert.doesNotMatch(code(colab.slice(0, colab.indexOf("manageSection") + 400)), /<ProjectChatbot/);
  // an ordinary project still renders the chat button
  assert.match(page.slice(page.lastIndexOf("</main>")), /<ProjectChatbot/);
});
