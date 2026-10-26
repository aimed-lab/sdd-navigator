import test from "node:test";
import assert from "node:assert/strict";
import { formatStatusReply, projectStatusQuestion } from "./statusReply.ts";
import { buildProjectStatus } from "./status.ts";
import { topicFromMessage } from "../assistant/assistantAnswer.ts";

test("the questions that mean 'status of my projects'", () => {
  for (const q of [
    "What's the status of my projects?",
    "status of my projects",
    "How are my projects doing?",
    "Give me an update on my projects",
    "progress of our projects",
  ]) {
    assert.deepEqual(projectStatusQuestion(q), { matches: true, colabofestOnly: false }, q);
  }
  for (const q of ["What is the status of my ColaboFest projects", "how are my colabofest 2026 projects doing"]) {
    assert.deepEqual(projectStatusQuestion(q), { matches: true, colabofestOnly: true }, q);
  }
});

test("other messages are not project-status questions", () => {
  for (const q of ["Find resources on KRAS", "status of the FDA approval for lecanemab", "my research project on PHGDH", "", "hello"]) {
    assert.equal(projectStatusQuestion(q).matches, false, q);
  }
});

test("a status question is not a topic to search for", () => {
  assert.equal(topicFromMessage("What's the status of my projects?"), null);
  assert.equal(topicFromMessage("status of my ColaboFest projects"), null);
  assert.ok(topicFromMessage("Find resources on KRAS in pancreatic cancer"));
});

const sample = buildProjectStatus({
  name: "CD38 Fibrosis",
  isChallenge: false,
  today: "2026-10-27",
  now: new Date("2026-10-27T12:00:00Z"),
  createdAt: "2026-10-20T00:00:00Z",
  items: [{ label: "Order reagents", status: "not_yet", position: 1, list_key: "team", due_date: "2026-10-20", assignee_name: "Ada" }],
  updates: [{ id: "1", kind: "help", body: "Need an antibody", created_at: "2026-10-22T00:00:00Z", resolved_at: null, author_name: "Bo" }],
  wikiTitles: ["CD38 overview"],
});

test("the answer names the status, progress, overdue owners, help, latest and wiki pages", () => {
  const text = formatStatusReply([sample]);
  assert.match(text, /\*\*CD38 Fibrosis\*\*: Needs help/);
  assert.match(text, /Team tasks: 0 of 1 ready/);
  assert.match(text, /Overdue: Order reagents \(Ada, due Oct 20\)/);
  assert.match(text, /Needs help: Need an antibody \(Bo\)/);
  assert.match(text, /Latest: Need an antibody \(2026-10-22\)/);
  assert.match(text, /Wiki pages: CD38 overview/);
});

test("empty answers say what to do, and a long list says how many were shown", () => {
  assert.match(formatStatusReply([]), /not on any projects yet.*New project/);
  assert.match(formatStatusReply([], { colabofestOnly: true }), /ColaboFest 2026/);
  assert.match(formatStatusReply([sample], { total: 12 }), /Showing 1 of 12 projects/);
});
