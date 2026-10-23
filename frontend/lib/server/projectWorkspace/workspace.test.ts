import test from "node:test";
import assert from "node:assert/strict";
import {
  checklistProgress,
  flattenPages,
  nestPages,
  nextItems,
  parseTab,
  parseWikiTitle,
  projectLabel,
  tabHref,
  teamSizeLabel,
  visibleTabs,
} from "./workspace.ts";

// ── tab routing ──────────────────────────────────────────────────────────────

test("an ordinary project has five tabs; a challenge project adds Proposal last", () => {
  assert.deepEqual(visibleTabs(false), ["overview", "wiki", "tasks", "files", "team"]);
  assert.deepEqual(visibleTabs(true), ["overview", "wiki", "tasks", "files", "team", "proposal"]);
});

test("?tab= picks the tab; missing or unknown means Overview", () => {
  assert.equal(parseTab(undefined, false), "overview");
  assert.equal(parseTab("", false), "overview");
  assert.equal(parseTab("wiki", false), "wiki");
  assert.equal(parseTab("tasks", false), "tasks");
  assert.equal(parseTab("files", false), "files");
  assert.equal(parseTab("team", false), "team");
  assert.equal(parseTab("nonsense", false), "overview");
  assert.equal(parseTab("WIKI", false), "overview");
  assert.equal(parseTab(["team", "wiki"], false), "team");
  assert.equal(parseTab([], false), "overview");
});

test("Proposal is reachable only on a challenge project", () => {
  assert.equal(parseTab("proposal", true), "proposal");
  assert.equal(parseTab("proposal", false), "overview");
});

test("tab links: Overview is the plain project URL, the others carry ?tab=", () => {
  assert.equal(tabHref("abc", "overview"), "/projects/abc");
  assert.equal(tabHref("abc", "wiki"), "/projects/abc?tab=wiki");
  assert.equal(tabHref("abc", "proposal"), "/projects/abc?tab=proposal");
  for (const t of visibleTabs(true)) assert.equal(parseTab(new URL(tabHref("x", t), "http://h").searchParams.get("tab") ?? undefined, true), t);
});

// ── sidebar text ─────────────────────────────────────────────────────────────

test("project label: ColaboFest 2026 for that challenge, none for an ordinary project", () => {
  assert.equal(projectLabel("colabofest_2026"), "ColaboFest 2026");
  assert.equal(projectLabel(null), null);
  assert.equal(projectLabel(""), null);
  assert.equal(projectLabel("spring_sprint_2027"), "Spring Sprint 2027");
});

test("team size wording", () => {
  assert.equal(teamSizeLabel(1), "1 member");
  assert.equal(teamSizeLabel(4), "4 members");
});

// ── progress and next items ──────────────────────────────────────────────────

const items = [
  { label: "A", status: "ready", position: 0 },
  { label: "B", status: "not_yet", position: 1 },
  { label: "C", status: "in_progress", position: 2 },
  { label: "D", status: "not_yet", position: 3 },
  { label: "E", status: "not_yet", position: 4 },
  { label: "F", status: "not_yet", position: 5 },
];

test("progress counts ready items; an empty checklist is 0 of 0 without dividing by zero", () => {
  assert.deepEqual(checklistProgress(items), { ready: 1, total: 6, percent: 17 });
  assert.deepEqual(checklistProgress([]), { ready: 0, total: 0, percent: 0 });
});

test("next items skip ready ones, put in progress first, then follow position", () => {
  assert.deepEqual(nextItems(items, 4).map((i) => i.label), ["C", "B", "D", "E"]);
  assert.deepEqual(nextItems(items, 2).map((i) => i.label), ["C", "B"]);
  assert.deepEqual(nextItems([{ label: "A", status: "ready", position: 0 }]), []);
  assert.deepEqual(nextItems([]), []);
});

// ── nested wiki pages ────────────────────────────────────────────────────────

const page = (id: string, parent: string | null, created: string) => ({
  id,
  slug: `s-${id}`,
  title: `Page ${id}`,
  parent_page_id: parent,
  created_at: created,
});

test("sub-pages are nested under their parent, oldest first", () => {
  const tree = nestPages([
    page("c2", "a", "2026-10-03"),
    page("b", null, "2026-10-02"),
    page("a", null, "2026-10-01"),
    page("c1", "a", "2026-10-02"),
    page("d", "c1", "2026-10-04"),
  ]);
  assert.deepEqual(tree.map((n) => n.page.id), ["a", "b"]);
  assert.deepEqual(tree[0].children.map((n) => n.page.id), ["c1", "c2"]);
  assert.deepEqual(tree[0].children[0].children.map((n) => n.page.id), ["d"]);
  assert.deepEqual(flattenPages(tree).map((r) => `${r.depth}:${r.page.id}`), ["0:a", "1:c1", "2:d", "1:c2", "0:b"]);
});

test("a page whose parent is missing is shown at the top level", () => {
  const tree = nestPages([page("a", null, "1"), page("x", "deleted-parent", "2")]);
  assert.deepEqual(tree.map((n) => n.page.id), ["a", "x"]);
  assert.equal(tree[1].depth, 0);
});

test("bad data cannot loop: self-parent and parent cycles still list every page once", () => {
  const self = flattenPages(nestPages([page("a", "a", "1")]));
  assert.deepEqual(self.map((r) => r.page.id), ["a"]);
  const cyc = flattenPages(nestPages([page("a", "b", "1"), page("b", "a", "2")]));
  assert.deepEqual(cyc.map((r) => r.page.id).sort(), ["a", "b"]);
  assert.deepEqual(flattenPages(nestPages([])), []);
});

// ── new wiki page title ──────────────────────────────────────────────────────

test("the title of a new wiki page: trimmed, 3 to 120 characters", () => {
  assert.deepEqual(parseWikiTitle("  PHGDH   in Alzheimer's  "), { ok: true, title: "PHGDH in Alzheimer's" });
  assert.equal(parseWikiTitle("ab").ok, false);
  assert.equal(parseWikiTitle("   ").ok, false);
  assert.equal(parseWikiTitle(undefined).ok, false);
  assert.equal(parseWikiTitle(42).ok, false);
  assert.equal(parseWikiTitle("x".repeat(121)).ok, false);
  assert.equal(parseWikiTitle("x".repeat(120)).ok, true);
});
