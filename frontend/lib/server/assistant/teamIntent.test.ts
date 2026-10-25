import test from "node:test";
import assert from "node:assert/strict";
import { detectTeamIntent, teamDraftReply, teamListReply } from "./teamIntent.ts";

const CREATE = [
  "create a team",
  "create me a team",
  "Create me a team.",
  "make a team",
  "make me a team",
  "start a team",
  "set up a team",
  "build a team",
  "new team",
  "a new team",
  "create a new team",
  "I want to create a team",
  "I'd like to make a team",
  "can you create a team?",
  "please create a team",
  "let's start a team",
  "new team for my talk",
  "create a team for my talk",
];

for (const text of CREATE) {
  test(`team intent: "${text}" is a create command with no name`, () => {
    assert.deepEqual(detectTeamIntent(text), { kind: "create", name: null });
  });
}

test("team intent: a name after called / named is filled in", () => {
  assert.deepEqual(detectTeamIntent("start a team called Lung Lab"), { kind: "create", name: "Lung Lab" });
  assert.deepEqual(detectTeamIntent('Create a team named "ColaboFest 2026"!'), { kind: "create", name: "ColaboFest 2026" });
  assert.deepEqual(detectTeamIntent("make me a team called   My  Team "), { kind: "create", name: "My Team" });
});

for (const text of ["my teams", "show my teams", "show me my teams", "open my team", "list my teams", "see my teams", "go to my teams", "which teams am I on?", "what are my teams"]) {
  test(`team intent: "${text}" is a list command`, () => {
    assert.deepEqual(detectTeamIntent(text), { kind: "list" });
  });
}

// The other direction: research questions that mention a team still search.
const NOT_TEAM = [
  "papers on team-based care",
  "latest papers on team science",
  "how to create a team of researchers",
  "create a team of experts on EGFR",
  "what makes a good team",
  "show the most recent papers on create me a team",
  "find resources on my team's drug",
  "team",
  "teams",
  "open my team's documents",
  "EGFR lung cancer",
  "create a wiki page for my team",
  "make a wiki page for my team Lung Lab about: EGFR",
  "create a community",
  "find a community for teams",
  "",
];
for (const text of NOT_TEAM) {
  test(`team intent: "${text}" is not a team command`, () => {
    assert.equal(detectTeamIntent(text), null);
  });
}

test("team replies", () => {
  assert.match(teamDraftReply("Lung Lab"), /Lung Lab/);
  assert.match(teamDraftReply(null), /Name it below/);
  assert.equal(teamListReply(0), "You are not on a team yet. You can create one now.");
  assert.equal(teamListReply(1), "You are on 1 team:");
  assert.equal(teamListReply(3), "You are on 3 teams:");
});
