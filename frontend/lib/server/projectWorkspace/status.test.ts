import test from "node:test";
import assert from "node:assert/strict";
import {
  PILL_LABEL,
  arrangeUpdates,
  assignableRoles,
  assigneeAllowed,
  buildProgramCard,
  buildProjectStatus,
  canDeleteUpdate,
  canPostKind,
  canResolve,
  canSeeProgram,
  dueLabel,
  firstLine,
  isOverdue,
  lastUpdateAt,
  nextUp,
  openHelp,
  overdueCount,
  parseDueDate,
  parseGithubUrl,
  parseUpdatePost,
  postableKinds,
  progressByList,
  statusPill,
  todayIso,
  visibleLists,
} from "./status.ts";

const TODAY = "2026-10-27";

// ── permissions ──────────────────────────────────────────────────────────────

test("who may post which kind: announcements need a lead or manager", () => {
  assert.deepEqual(postableKinds("member"), ["help"]);
  assert.deepEqual(postableKinds("lead"), ["announcement", "help"]);
  assert.deepEqual(postableKinds("manager"), ["announcement", "help"]);
  assert.equal(canPostKind("member", "announcement"), false);
  assert.equal(canPostKind("manager", "announcement"), true);
  // a plain "update" can no longer be posted (Announcements replaced the Updates tab)
  assert.equal(canPostKind("lead", "update"), false);
  assert.equal(canPostKind(null, "help"), true);
  assert.equal(canPostKind(null, "announcement"), false);
  assert.equal(canPostKind("member", "nonsense"), false);
});

test("only a lead or manager resolves help; the author, a lead or a manager deletes", () => {
  assert.equal(canResolve("lead"), true);
  assert.equal(canResolve("manager"), true);
  assert.equal(canResolve("member"), false);
  assert.equal(canResolve(null), false);
  assert.equal(canDeleteUpdate({ role: "member", isAuthor: true }), true);
  assert.equal(canDeleteUpdate({ role: "member", isAuthor: false }), false);
  assert.equal(canDeleteUpdate({ role: "manager", isAuthor: false }), true);
  assert.equal(canDeleteUpdate({ role: "lead", isAuthor: false }), true);
});

test("a lead can give the member or manager role, never lead through this path", () => {
  assert.deepEqual(assignableRoles(), ["member", "manager"]);
});

test("the program page is for a lead or manager on a ColaboFest project", () => {
  const cf = "colabofest_2026";
  assert.equal(canSeeProgram([{ program: cf, role: "manager" }]), true);
  assert.equal(canSeeProgram([{ program: cf, role: "lead" }]), true);
  assert.equal(canSeeProgram([{ program: cf, role: "member" }]), false);
  assert.equal(canSeeProgram([{ program: null, role: "lead" }]), false);
  assert.equal(canSeeProgram([{ program: "other_2027", role: "manager" }]), false);
  assert.equal(canSeeProgram([]), false);
  assert.equal(canSeeProgram([{ program: null, role: "lead" }, { program: cf, role: "manager" }]), true);
});

// ── posting ──────────────────────────────────────────────────────────────────

test("a post needs a kind the role may write, and 1 to 4000 characters", () => {
  assert.deepEqual(parseUpdatePost("help", "  Need the assay protocol ", "member"), {
    ok: true,
    value: { kind: "help", body: "Need the assay protocol" },
  });
  assert.equal(parseUpdatePost("update", "Ran the assay", "member").ok, false);
  assert.equal(parseUpdatePost("announcement", "Hello", "member").ok, false);
  assert.equal(parseUpdatePost("announcement", "Hello", "manager").ok, true);
  assert.equal(parseUpdatePost("help", "   ", "member").ok, false);
  assert.equal(parseUpdatePost("help", "x".repeat(4001), "member").ok, false);
  assert.equal(parseUpdatePost("help", "x".repeat(4000), "member").ok, true);
  assert.equal(parseUpdatePost("rant", "x", "lead").ok, false);
  assert.equal(parseUpdatePost(undefined, "x", "lead").ok, false);
});

const u = (id: string, kind: string, created: string, resolved: string | null = null) => ({
  id,
  kind,
  body: `${kind} ${id}`,
  created_at: created,
  resolved_at: resolved,
});

test("announcements are pinned on top, the feed is newest first", () => {
  const { pinned, feed } = arrangeUpdates([
    u("a", "update", "2026-10-01T00:00:00Z"),
    u("b", "announcement", "2026-10-02T00:00:00Z"),
    u("c", "help", "2026-10-03T00:00:00Z"),
    u("d", "announcement", "2026-10-04T00:00:00Z"),
    u("e", "update", "2026-10-05T00:00:00Z"),
  ]);
  assert.deepEqual(pinned.map((x) => x.id), ["d", "b"]);
  assert.deepEqual(feed.map((x) => x.id), ["e", "c", "a"]);
});

test("open help posts: unresolved help only, newest first", () => {
  const rows = [
    u("a", "help", "2026-10-01T00:00:00Z"),
    u("b", "help", "2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z"),
    u("c", "update", "2026-10-03T00:00:00Z"),
    u("d", "help", "2026-10-04T00:00:00Z"),
  ];
  assert.deepEqual(openHelp(rows).map((x) => x.id), ["d", "a"]);
  assert.equal(lastUpdateAt(rows), "2026-10-04T00:00:00Z");
  assert.equal(lastUpdateAt([]), null);
  assert.equal(firstLine("\n\n  First line here\nsecond"), "First line here");
  assert.ok(firstLine("x".repeat(300)).length <= 140);
});

// ── checklists: lists, overdue, ordering ─────────────────────────────────────

test("an ordinary project has Team tasks only; a challenge project has the partner checklists too", () => {
  assert.deepEqual(visibleLists(false), ["team"]);
  assert.deepEqual(visibleLists(true), ["sparc", "southern_research", "team"]);
});

test("overdue means a due date before today and not ready", () => {
  assert.equal(isOverdue({ status: "not_yet", due_date: "2026-10-26" }, TODAY), true);
  assert.equal(isOverdue({ status: "in_progress", due_date: "2026-10-01" }, TODAY), true);
  assert.equal(isOverdue({ status: "ready", due_date: "2026-10-01" }, TODAY), false);
  assert.equal(isOverdue({ status: "not_yet", due_date: TODAY }, TODAY), false);
  assert.equal(isOverdue({ status: "not_yet", due_date: "2026-11-01" }, TODAY), false);
  assert.equal(isOverdue({ status: "not_yet", due_date: null }, TODAY), false);
  assert.equal(
    overdueCount([{ status: "not_yet", due_date: "2026-10-01" }, { status: "ready", due_date: "2026-10-01" }, { status: "not_yet", due_date: null }], TODAY),
    1
  );
});

test("today is the Chicago date", () => {
  assert.equal(todayIso(new Date("2026-10-27T03:30:00Z")), "2026-10-26");
  assert.equal(todayIso(new Date("2026-10-27T15:00:00Z")), "2026-10-27");
});

test("progress is counted per list; items without a list count as team tasks", () => {
  const p = progressByList([
    { status: "ready", list_key: "sparc" },
    { status: "not_yet", list_key: "sparc" },
    { status: "ready", list_key: "team" },
    { status: "in_progress", list_key: null },
    { status: "ready", list_key: "southern_research" },
  ]);
  assert.deepEqual(p.sparc, { ready: 1, total: 2 });
  assert.deepEqual(p.southern_research, { ready: 1, total: 1 });
  assert.deepEqual(p.team, { ready: 1, total: 2 });
});

test("next up: overdue first (earliest due first), then by due date, then undated", () => {
  const items = [
    { label: "undated not yet", status: "not_yet", position: 1, due_date: null },
    { label: "undated in progress", status: "in_progress", position: 5, due_date: null },
    { label: "due next month", status: "not_yet", position: 2, due_date: "2026-11-15" },
    { label: "overdue recent", status: "not_yet", position: 3, due_date: "2026-10-25" },
    { label: "overdue old", status: "in_progress", position: 4, due_date: "2026-10-01" },
    { label: "due soon", status: "not_yet", position: 6, due_date: "2026-10-30" },
    { label: "done", status: "ready", position: 0, due_date: "2026-10-02" },
  ];
  assert.deepEqual(nextUp(items, TODAY, 10).map((i) => i.label), [
    "overdue old",
    "overdue recent",
    "due soon",
    "due next month",
    "undated in progress",
    "undated not yet",
  ]);
  assert.equal(nextUp(items, TODAY, 2).length, 2);
  assert.deepEqual(nextUp([], TODAY), []);
});

test("due dates: empty clears, otherwise a real YYYY-MM-DD date", () => {
  assert.deepEqual(parseDueDate(""), { ok: true, value: null });
  assert.deepEqual(parseDueDate(null), { ok: true, value: null });
  assert.deepEqual(parseDueDate("2026-11-30"), { ok: true, value: "2026-11-30" });
  assert.equal(parseDueDate("2026-02-30").ok, false);
  assert.equal(parseDueDate("11/30/2026").ok, false);
  assert.equal(parseDueDate(5).ok, false);
  assert.equal(dueLabel("2026-11-03"), "Nov 3");
  assert.equal(dueLabel(null), null);
});

test("the owner of an item must be a member (or nobody)", () => {
  assert.equal(assigneeAllowed(["u1", "u2", null], "u2"), true);
  assert.equal(assigneeAllowed(["u1"], "u9"), false);
  assert.equal(assigneeAllowed(["u1"], null), true);
  assert.equal(assigneeAllowed([null], "u1"), false);
});

// ── status pill ──────────────────────────────────────────────────────────────

const NOW = new Date("2026-10-27T12:00:00Z");

test("status pill: needs help beats quiet beats on track", () => {
  assert.equal(statusPill({ openHelpCount: 1, lastUpdate: "2026-10-26T00:00:00Z", now: NOW }), "needs_help");
  assert.equal(statusPill({ openHelpCount: 1, lastUpdate: null, now: NOW }), "needs_help");
  assert.equal(statusPill({ openHelpCount: 0, lastUpdate: "2026-10-20T00:00:00Z", now: NOW }), "on_track");
  assert.equal(statusPill({ openHelpCount: 0, lastUpdate: "2026-10-13T11:00:00Z", now: NOW }), "quiet"); // just over 14 days
  assert.equal(statusPill({ openHelpCount: 0, lastUpdate: "2026-10-13T13:00:00Z", now: NOW }), "on_track"); // just under
  assert.equal(PILL_LABEL.quiet, "No update in 14+ days");
});

test("a project with no update yet is judged from when it was created", () => {
  assert.equal(statusPill({ openHelpCount: 0, lastUpdate: null, createdAt: "2026-10-25T00:00:00Z", now: NOW }), "on_track");
  assert.equal(statusPill({ openHelpCount: 0, lastUpdate: null, createdAt: "2026-09-01T00:00:00Z", now: NOW }), "quiet");
  assert.equal(statusPill({ openHelpCount: 0, lastUpdate: null, now: NOW }), "quiet");
});

test("a program card: pill, per-list progress, overdue count and last update", () => {
  const card = buildProgramCard({
    id: "p1",
    name: "CD38 Fibrosis",
    createdAt: "2026-09-01T00:00:00Z",
    teamSize: 4,
    now: NOW,
    items: [
      { status: "ready", list_key: "sparc", due_date: null },
      { status: "not_yet", list_key: "sparc", due_date: "2026-10-01" },
      { status: "not_yet", list_key: "team", due_date: "2026-10-26" },
      { status: "ready", list_key: "team", due_date: "2026-10-01" },
    ],
    updates: [
      { kind: "update", created_at: "2026-10-20T00:00:00Z", resolved_at: null },
      { kind: "help", created_at: "2026-10-22T00:00:00Z", resolved_at: null },
    ],
  });
  assert.equal(card.pill, "needs_help");
  assert.equal(card.overdue, 2);
  assert.equal(card.teamSize, 4);
  assert.equal(card.lastUpdate, "2026-10-22T00:00:00Z");
  assert.deepEqual(card.progress.map((p) => [p.list, p.ready, p.total]), [["sparc", 1, 2], ["southern_research", 0, 0], ["team", 1, 2]]);

  const resolved = buildProgramCard({
    id: "p1", name: "x", createdAt: null, teamSize: 1, now: NOW, items: [],
    updates: [{ kind: "help", created_at: "2026-10-22T00:00:00Z", resolved_at: "2026-10-23T00:00:00Z" }],
  });
  assert.equal(resolved.pill, "on_track");
});

// ── GitHub link ──────────────────────────────────────────────────────────────

test("GitHub links: https://github.com/ only; empty clears", () => {
  assert.deepEqual(parseGithubUrl("https://github.com/aimed-lab/sdd-navigator"), { ok: true, value: "https://github.com/aimed-lab/sdd-navigator" });
  assert.deepEqual(parseGithubUrl("  "), { ok: true, value: null });
  for (const bad of ["http://github.com/a/b", "https://gitlab.com/a/b", "https://github.com.evil.com/a", "https://github.com/", "javascript:alert(1)", "github.com/a/b", "https://github.com/a b"]) {
    assert.equal(parseGithubUrl(bad).ok, false, bad);
  }
  assert.equal(parseGithubUrl("https://github.com/" + "a".repeat(300)).ok, false);
});

// ── the assistant's project status ───────────────────────────────────────────

test("project status for the assistant: progress per list, overdue with owners, open help, last 3 updates, wiki titles", () => {
  const s = buildProjectStatus({
    name: "CD38 Fibrosis",
    isChallenge: true,
    today: TODAY,
    now: NOW,
    createdAt: "2026-09-01T00:00:00Z",
    items: [
      { label: "Order reagents", status: "not_yet", position: 1, list_key: "team", due_date: "2026-10-20", assignee_name: "Ada" },
      { label: "Sign MTA", status: "ready", position: 2, list_key: "sparc", due_date: "2026-10-01" },
      { label: "Safety plan", status: "in_progress", position: 3, list_key: "southern_research", due_date: "2026-10-10", assignee_name: null },
    ],
    updates: [
      { id: "1", kind: "update", body: "one", created_at: "2026-10-01T00:00:00Z", resolved_at: null, author_name: "Ada" },
      { id: "2", kind: "update", body: "two", created_at: "2026-10-02T00:00:00Z", resolved_at: null },
      { id: "3", kind: "help", body: "Need an antibody\nplease", created_at: "2026-10-03T00:00:00Z", resolved_at: null, author_name: "Bo" },
      { id: "4", kind: "update", body: "four", created_at: "2026-10-04T00:00:00Z", resolved_at: null },
    ],
    wikiTitles: ["CD38 overview"],
  });
  assert.equal(s.status, "Needs help");
  assert.deepEqual(s.checklists, [
    { list: "UAB SPARC checklist", ready: 1, total: 1 },
    { list: "Southern Research checklist", ready: 0, total: 1 },
    { list: "Team tasks", ready: 0, total: 1 },
  ]);
  assert.deepEqual(s.overdue_items.map((o) => [o.item, o.owner]), [["Safety plan", null], ["Order reagents", "Ada"]]);
  assert.deepEqual(s.open_help_requests, [{ text: "Need an antibody", by: "Bo", posted: "2026-10-03" }]);
  assert.deepEqual(s.latest_updates.map((x) => x.text), ["four", "Need an antibody", "two"]);
  assert.deepEqual(s.wiki_pages, ["CD38 overview"]);

  const plain = buildProjectStatus({ name: "P", isChallenge: false, today: TODAY, now: NOW, items: [], updates: [], wikiTitles: [], createdAt: "2026-10-26T00:00:00Z" });
  assert.deepEqual(plain.checklists, [{ list: "Team tasks", ready: 0, total: 0 }]);
  assert.equal(plain.status, "On track");
});
