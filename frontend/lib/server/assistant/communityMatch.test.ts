// Run with `npm test`. Community search ranking and the match-card rules.

import test from "node:test";
import assert from "node:assert/strict";
import { matchAction, pickPeopleMatch, queryTokens, rankCommunities, MATCH_MIN_COVERAGE } from "./communityMatch.ts";

const c = (name: string, description: string | null, topics: string[] = []) => ({ name, description, explore_topics: topics });

const PANC = c("Pancreatic Cancer Research", "Basic and translational work on pancreatic cancer.", ["pancreatic ductal adenocarcinoma", "KRAS"]);
const KRAS = c("KRAS Drug Discovery", "Targeting KRAS across tumour types.", ["KRAS inhibitors"]);
const GENERIC = c("Cancer Patients Network", "Support for cancer patients and families.", []);
const LUNG = c("Lung Cancer Genomics", "Lung cancer mutations.", ["EGFR"]);
// Alphabetical, as listCommunities() returns them.
const ALL = [GENERIC, KRAS, LUNG, PANC];

test("queryTokens: drops short words and generic science filler, keeps the user's spelling", () => {
  assert.deepEqual(queryTokens("KRAS in the pancreatic cancer signaling").map((t) => t.shown), ["KRAS", "pancreatic", "cancer"]);
  assert.deepEqual(queryTokens("of an to"), []);
  assert.deepEqual(queryTokens("kras KRAS Kras").map((t) => t.shown), ["kras"], "duplicates count once");
});

test("a name/purpose/topic match ranks above a weak single-word hit", () => {
  const ranked = rankCommunities("pancreatic cancer KRAS", ALL).map((r) => r.community.name);
  assert.equal(ranked[0], "Pancreatic Cancer Research");
  // "Cancer Patients Network" and "Lung Cancer Genomics" only share the word cancer: they trail.
  assert.ok(ranked.indexOf("KRAS Drug Discovery") < ranked.indexOf("Cancer Patients Network"));
  assert.ok(ranked.indexOf("KRAS Drug Discovery") < ranked.indexOf("Lung Cancer Genomics"));
});

test("a word in the name outweighs the same word only in the purpose", () => {
  const inName = c("KRAS Biology", null);
  const inPurpose = c("Oncology Group", "We study KRAS signalling.");
  const ranked = rankCommunities("KRAS", [inPurpose, inName]);
  assert.equal(ranked[0].community, inName);
});

test("words side by side in the query and in the community earn a phrase bonus", () => {
  const together = c("Pancreatic Cancer Group", null);
  const apart = c("Cancer Genomics", "A group studying pancreatic islets.");
  const [first, second] = rankCommunities("pancreatic cancer", [apart, together]);
  assert.equal(first.community, together);
  assert.ok(first.score > second.score);
});

test("why it matched: the phrase first, then the remaining words, in the user's spelling", () => {
  const [top] = rankCommunities("pancreatic cancer KRAS", ALL);
  assert.deepEqual(top.matched, ["pancreatic cancer", "KRAS"]);
  assert.equal(top.coverage, 1);
});

test("minimum coverage removes communities that share only one word", () => {
  const strict = rankCommunities("pancreatic cancer KRAS", ALL, { minCoverage: MATCH_MIN_COVERAGE }).map((r) => r.community.name);
  assert.deepEqual(strict, ["Pancreatic Cancer Research", "KRAS Drug Discovery"].filter((n) => strict.includes(n)));
  assert.ok(!strict.includes("Cancer Patients Network"));
  assert.ok(!strict.includes("Lung Cancer Genomics"));
  assert.ok(strict.includes("Pancreatic Cancer Research"));
});

test("a one-word query still matches on that word", () => {
  const r = rankCommunities("KRAS", ALL, { minCoverage: MATCH_MIN_COVERAGE }).map((x) => x.community.name);
  assert.deepEqual(r.sort(), ["KRAS Drug Discovery", "Pancreatic Cancer Research"]);
});

test("limit caps the list; nothing matching or nothing distinctive gives an empty list", () => {
  assert.equal(rankCommunities("cancer", ALL, { limit: 2 }).length, 2);
  assert.deepEqual(rankCommunities("quantum chromodynamics", ALL), []);
  assert.deepEqual(rankCommunities("of the", ALL), []);
  assert.deepEqual(rankCommunities("", ALL), []);
});

test("equal scores keep the input (alphabetical) order", () => {
  const a = c("Alpha KRAS", null);
  const b = c("Beta KRAS", null);
  assert.deepEqual(rankCommunities("KRAS", [a, b]).map((r) => r.community.name), ["Alpha KRAS", "Beta KRAS"]);
});

test("matchAction: Join for open, Request to join for others, sign-in when signed out, nothing once in", () => {
  assert.deepEqual(matchAction({ isOpen: true, state: "none" }), { kind: "join", label: "Join" });
  assert.deepEqual(matchAction({ isOpen: false, state: "none" }), { kind: "request", label: "Request to join" });
  assert.equal(matchAction({ isOpen: true, state: "signed_out" }).kind, "signin");
  assert.equal(matchAction({ isOpen: false, state: "signed_out" }).label, "Sign in to request");
  assert.deepEqual(matchAction({ isOpen: true, state: "active" }), { kind: "none", label: "Member" });
  assert.deepEqual(matchAction({ isOpen: false, state: "pending" }), { kind: "none", label: "Request pending" });
});

test("pickPeopleMatch: the best community the viewer is NOT in; one they are in only if nothing else matches", () => {
  const m = (id: string, state: "none" | "active" | "pending" | "signed_out") => ({ id, state });
  assert.equal(pickPeopleMatch([m("colabo", "active"), m("kras-lab", "none"), m("other", "none")])?.id, "kras-lab");
  assert.equal(pickPeopleMatch([m("colabo", "active"), m("pend", "pending")])?.id, "pend", "a pending request is not membership");
  assert.equal(pickPeopleMatch([m("a", "signed_out"), m("b", "signed_out")])?.id, "a");
  assert.equal(pickPeopleMatch([m("colabo", "active"), m("also", "active")])?.id, "colabo", "all member: show the best, as 'You're a member'");
  assert.equal(pickPeopleMatch([]), null, "nothing matches: the card stays hidden");
});
