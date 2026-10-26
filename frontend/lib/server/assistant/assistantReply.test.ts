// Run with `npm test`. Parsing of the assistant's { reply, choices, action }.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GREETING,
  STARTERS,
  COMMUNITY_TOPIC_QUESTION,
  afterDuplicateChoice,
  buildAssistantContext,
  isCommunityRequest,
  isCommunityTurn,
  joinSentences,
  communityDraftProblem,
  needsEarlyDuplicateCheck,
  newCommunityMessage,
  pageKey,
  parseCommunityDraft,
  assistantAvailableOn,
  cleanMessagesForSend,
  exploreQueryFromPath,
  isNearDuplicate,
  parseAssistantReply,
  restoreChat,
  serializeChat,
  similarity,
} from "./assistantReply.ts";

const ACTION = { type: "create_page", title: "EGFR in lung cancer", seed_input: "EGFR lung cancer", visibility: "team" };

test("parseAssistantReply: a plain reply", () => {
  assert.deepEqual(parseAssistantReply({ reply: "  Hello  " }), { reply: "Hello" });
});

test("parseAssistantReply: choices keep only valid visibilities, in the fixed order", () => {
  assert.deepEqual(parseAssistantReply({ reply: "Pick", choices: ["public", "nonsense", "private"] }), {
    reply: "Pick",
    choices: ["private", "public"],
  });
  assert.deepEqual(parseAssistantReply({ reply: "Pick", choices: ["nope"] }), { reply: "Pick" });
  assert.deepEqual(parseAssistantReply({ reply: "Pick", choices: "private" }), { reply: "Pick" });
});

test("parseAssistantReply: a valid action is kept and replaces choices", () => {
  const out = parseAssistantReply({ reply: "Confirm below.", choices: ["private"], action: ACTION });
  assert.deepEqual(out, { reply: "Confirm below.", action: ACTION });
});

test("parseAssistantReply: a malformed action is dropped, never half-trusted", () => {
  for (const bad of [
    { ...ACTION, visibility: "everyone" },
    { ...ACTION, title: "x" },
    { ...ACTION, seed_input: "" },
    { ...ACTION, type: "delete_page" },
    { ...ACTION, title: 5 },
    "create_page",
  ]) {
    const out = parseAssistantReply({ reply: "ok", action: bad });
    assert.equal(out?.action, undefined);
  }
});

test("parseAssistantReply: no usable reply -> null", () => {
  assert.equal(parseAssistantReply(null), null);
  assert.equal(parseAssistantReply({ reply: "   " }), null);
  assert.equal(parseAssistantReply({ choices: ["private"] }), null);
  assert.equal(parseAssistantReply([]), null);
});

test("cleanMessagesForSend: only user/assistant text, trimmed and capped at 20", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  const cleaned = cleanMessagesForSend([{ role: "system", content: "x" }, { role: "user", content: 4 }, ...many]);
  assert.equal(cleaned.length, 20);
  assert.equal(cleaned[19].content, "m29");
  assert.deepEqual(cleanMessagesForSend([{ role: "user", content: "  hi  " }]), [{ role: "user", content: "hi" }]);
  assert.deepEqual(cleanMessagesForSend("nope"), []);
});

test("near-duplicate: same words in another order or case match; related-but-different pages do not", () => {
  assert.equal(similarity("EGFR in lung cancer", "lung cancer EGFR"), 1);
  assert.ok(isNearDuplicate({ title: "EGFR inhibitors in lung cancer", seed: "x1 research" }, { title: "Lung cancer EGFR inhibitors", seed: "y2 other" }));
  assert.ok(isNearDuplicate({ title: "Mine", seed: "KRAS G12C pancreatic cancer" }, { title: "Other title", seed: "kras g12c pancreatic cancer" }));
  assert.ok(!isNearDuplicate({ title: "EGFR in lung cancer", seed: "EGFR lung cancer" }, { title: "EGFR in breast cancer", seed: "EGFR breast cancer" }));
  assert.ok(!isNearDuplicate({ title: "", seed: "" }, { title: "", seed: "" }));
});

test("chat snapshot: round-trips, and a corrupted or hostile one restores to nothing", () => {
  const snap = {
    messages: [
      { role: "user" as const, content: "I work on EGFR" },
      { role: "assistant" as const, content: "Found things" },
    ],
    choices: null,
    action: { ...ACTION, type: "create_page" as const, visibility: "team" as const },
  };
  assert.deepEqual(restoreChat(serializeChat(snap)), snap);
  assert.equal(restoreChat(null), null);
  assert.equal(restoreChat("{not json"), null);
  assert.equal(restoreChat(JSON.stringify({ messages: "x" })), null);
  // A stored action that no longer validates is dropped, the conversation stays.
  const tampered = JSON.stringify({ messages: snap.messages, action: { ...ACTION, visibility: "root" } });
  assert.deepEqual(restoreChat(tampered), { messages: snap.messages, choices: null, action: null });
});

// -- the greeting and its starter chips --

test("greeting text is exactly the agreed sentence", () => {
  assert.equal(GREETING, "Hi, I'm your SmartDrugDiscovery assistant. I can help you:");
});

test("starters: the six chips, in order, all live (Communities is a real option now)", () => {
  assert.deepEqual(
    STARTERS.map((s) => s.label),
    [
      "Find resources on a topic",
      "Create a wiki page for my research",
      "Show my pages",
      "Create a team",
      "Status of my projects",
      "Find or create a community",
    ]
  );
  assert.deepEqual(STARTERS.filter((s) => s.kind === "soon"), []);
});

test("starters: each live chip starts a flow or fills the input", () => {
  const byId = Object.fromEntries(STARTERS.map((s) => [s.id, s]));
  assert.equal(byId.find.kind, "fill");
  assert.match((byId.find as { text: string }).text, /^Find resources on /);
  assert.equal(byId.create.kind, "send");
  assert.match((byId.create as { text: string }).text, /wiki page/);
  assert.deepEqual({ kind: byId.mine.kind, href: (byId.mine as { href: string }).href }, { kind: "go", href: "/pages" });
  assert.equal(byId.team.kind, "send");
  assert.equal((byId.team as { text: string }).text, "Create a team");
  assert.equal(byId.communities.kind, "send");
  assert.match((byId.communities as { text: string }).text, /community/);
  assert.match(byId.find.hint ?? "", /papers, trials, FDA approvals, compounds, datasets, grants, tools/);
  assert.match(byId.create.hint ?? "", /private, team or public, keeps itself updated/);
});

test("the panel is offered on Explore, the /pages screens and a team's own page only", () => {
  for (const ok of ["/explore", "/explore/egfr", "/explore/podcast", "/pages", "/pages/egfr-abc12", "/teams/kras-club-a1b2c3"]) {
    assert.equal(assistantAvailableOn(ok), true, ok);
  }
  for (const no of ["/", "/projects", "/collaborate", "/pagesx", "/exploreme", "/teams", "/teams/new", "", null, undefined]) {
    assert.equal(assistantAvailableOn(no), false, String(no));
  }
});

test("exploreQueryFromPath: the Explore search text, decoded; nothing elsewhere", () => {
  assert.equal(exploreQueryFromPath("/explore/EGFR%20lung%20cancer"), "EGFR lung cancer");
  assert.equal(exploreQueryFromPath("/explore"), "");
  assert.equal(exploreQueryFromPath("/explore/podcast"), "");
  assert.equal(exploreQueryFromPath("/pages/egfr-abc12"), "");
  assert.equal(exploreQueryFromPath("/explore/%E0%A4%A"), "");
});

// -- query, related questions and numbered sources --

test("parseAssistantReply: carries the search query, related questions and sources", () => {
  const out = parseAssistantReply({
    reply: "Answer [1].",
    query: " EGFR lung cancer ",
    related: ["Which trials are recruiting?", "x", 5, "What drugs are approved?"],
    sources: [
      { n: 9, kind: "paper", title: " Paper A ", url: "https://x.org/a", detail: "Src" },
      { kind: "trial", title: "Trial B", url: "javascript:alert(1)" },
      { kind: "paper", title: "" },
    ],
  });
  assert.equal(out?.query, "EGFR lung cancer");
  assert.deepEqual(out?.related, ["Which trials are recruiting?", "What drugs are approved?"]);
  assert.deepEqual(out?.sources, [
    { n: 1, kind: "paper", title: "Paper A", url: "https://x.org/a", detail: "Src" },
    { n: 2, kind: "trial", title: "Trial B", url: null, detail: "" },
  ]);
});

test("parseAssistantReply: query null means no search ran; an old backend has no query key at all", () => {
  assert.equal(parseAssistantReply({ reply: "Hi", query: null })?.query, null);
  assert.equal("query" in (parseAssistantReply({ reply: "Hi" }) ?? {}), false);
});

// ── communities ──────────────────────────────────────────────────────────────

test("parseAssistantReply: a find_communities action is kept; a bad one is dropped", () => {
  const ok = parseAssistantReply({ reply: "Checking.", action: { type: "find_communities", query: "KRAS pancreatic cancer" } });
  assert.deepEqual(ok?.community, { type: "find_communities", query: "KRAS pancreatic cancer" });
  assert.equal(ok?.action, undefined, "it is not a page action");
  assert.equal(parseAssistantReply({ reply: "x", action: { type: "find_communities", query: "ab" } })?.community, undefined);
  assert.equal(parseAssistantReply({ reply: "x", action: { type: "find_communities" } })?.community, undefined);
});

test("parseAssistantReply: a community draft is validated and trimmed", () => {
  const ok = parseAssistantReply({ reply: "Draft.", action: { type: "create_community", name: "  KRAS in PDAC ", purpose: " Work on KRAS. " } });
  assert.deepEqual(ok?.community, { type: "create_community", name: "KRAS in PDAC", purpose: "Work on KRAS." });
  for (const bad of [
    { type: "create_community", name: "KR", purpose: "fine purpose" },
    { type: "create_community", name: "Fine name", purpose: "" },
    { type: "create_community", name: "x".repeat(81), purpose: "fine purpose" },
    { type: "create_community", name: "Fine name", purpose: "y".repeat(301) },
    { type: "create_community", name: 5, purpose: "fine purpose" },
  ]) {
    assert.equal(parseAssistantReply({ reply: "x", action: bad })?.community, undefined, JSON.stringify(bad));
  }
});

test("community draft: edits are checked before the confirm step", () => {
  assert.equal(communityDraftProblem("KRAS in PDAC", "Researchers on KRAS."), null);
  assert.match(communityDraftProblem("  ", "Researchers on KRAS.") ?? "", /name/);
  assert.match(communityDraftProblem("KRAS in PDAC", " ") ?? "", /what it is for/);
  assert.match(communityDraftProblem("x".repeat(81), "fine") ?? "", /name/);
  assert.equal(parseCommunityDraft({ type: "create_community", name: "ab", purpose: "cd" }), null);
});

test("newCommunityMessage names the topic", () => {
  assert.equal(newCommunityMessage("  KRAS pancreatic cancer "), "Create a new community on KRAS pancreatic cancer");
});

test("a community draft survives the sign-in round trip in the chat snapshot", () => {
  const snap = {
    messages: [{ role: "user" as const, content: "Create a community on KRAS" }],
    choices: null,
    action: null,
    communityDraft: { type: "create_community" as const, name: "KRAS in PDAC", purpose: "Work on KRAS." },
  };
  assert.deepEqual(restoreChat(serializeChat(snap)), snap);
  const tampered = JSON.stringify({ messages: snap.messages, communityDraft: { type: "create_community", name: "x", purpose: "" } });
  assert.deepEqual(restoreChat(tampered), { messages: snap.messages, choices: null, action: null });
});

// ── public pages: the check runs as soon as Public is picked ─────────────────

const PAGE = { type: "create_page" as const, title: "KRAS in PDAC", seed_input: "KRAS pancreatic cancer", visibility: "public" as const };

test("only a public page is checked early", () => {
  assert.equal(needsEarlyDuplicateCheck(PAGE), true);
  assert.equal(needsEarlyDuplicateCheck({ ...PAGE, visibility: "private" }), false);
  assert.equal(needsEarlyDuplicateCheck({ ...PAGE, visibility: "team" }), false);
});

test("'Create private' turns the page private and skips a pointless check; it creates nothing itself", () => {
  const r = afterDuplicateChoice(PAGE, "private");
  assert.equal(r.action.visibility, "private");
  assert.equal(r.action.title, PAGE.title);
  assert.equal(r.skipCheck, true);
  assert.equal(PAGE.visibility, "public", "the original is untouched");
});

test("'Create anyway' keeps the page public and does not ask again", () => {
  const r = afterDuplicateChoice(PAGE, "anyway");
  assert.deepEqual(r.action, PAGE);
  assert.equal(r.skipCheck, true);
});

test("pageKey tells proposals apart, ignoring case and spacing", () => {
  assert.equal(pageKey(PAGE), pageKey({ ...PAGE, title: "  kras in pdac " }));
  assert.notEqual(pageKey(PAGE), pageKey({ ...PAGE, visibility: "private" }));
  assert.notEqual(pageKey(PAGE), pageKey({ ...PAGE, seed_input: "EGFR lung cancer" }));
});

// ── community turns are never searches ──────────────────────────────────────────

test("isCommunityRequest: community requests yes, ordinary science questions no", () => {
  for (const t of [
    "Create a community for neuro-oncology researchers at UAB",
    "I'd like to find or create a community.",
    "Create a new community on neuro-oncology",
    "Is there a community on KRAS?",
  ]) assert.equal(isCommunityRequest(t), true, t);
  for (const t of [
    "What are microbial communities in the gut?",
    "I need info on microbial communities",
    "Summarize the key findings on KRAS in pancreatic cancer",
    "Find resources on glioblastoma",
  ]) assert.equal(isCommunityRequest(t), false, t);
});

test("isCommunityTurn: the request, and the answer to the topic question, but not other turns", () => {
  const user = (content: string) => ({ role: "user" as const, content });
  const bot = (content: string) => ({ role: "assistant" as const, content });
  assert.equal(isCommunityTurn([user("Create a community for neuro-oncology researchers at UAB")]), true);
  assert.equal(isCommunityTurn([user("I'd like to find or create a community.")]), true);
  assert.equal(isCommunityTurn([user("Create a new community on neuro-oncology")]), true);
  // The answer to "What topic ... is the community for?" has no community word in it.
  assert.equal(
    isCommunityTurn([user("I'd like to find or create a community."), bot(COMMUNITY_TOPIC_QUESTION), user("neuro-oncology")]),
    true
  );
  // But the same plain message after a normal answer is a search.
  assert.equal(isCommunityTurn([user("hi"), bot("Tell me a topic."), user("neuro-oncology")]), false);
  assert.equal(isCommunityTurn([user("What is known about KRAS?")]), false);
  assert.equal(isCommunityTurn([]), false);
});

test("the topic question is the same sentence the backend asks", () => {
  const py = readFileSync(new URL("../../../../backend/explore-mcp/tools/assistant.py", import.meta.url), "utf8");
  assert.ok(py.includes(`COMMUNITY_TOPIC_QUESTION = "${COMMUNITY_TOPIC_QUESTION}"`));
});

test("buildAssistantContext: communities_checked is forwarded on every turn, exactly when true", () => {
  assert.deepEqual(buildAssistantContext({ communities_checked: true }), { communities_checked: true });
  assert.deepEqual(
    buildAssistantContext({ query: " KRAS ", page_created: true, communities_checked: true, junk: 1 }),
    { query: "KRAS", page_created: true, communities_checked: true }
  );
  for (const bad of ["true", 1, null, undefined, false]) {
    assert.deepEqual(buildAssistantContext({ communities_checked: bad }), {}, String(bad));
  }
  assert.deepEqual(buildAssistantContext(null), {});
  assert.deepEqual(buildAssistantContext("x"), {});
});

test("the flag survives across turns in the same chat: matches shown, then each later turn still sends it", () => {
  // The chat component keeps `communitiesChecked` in state until New chat and sends it
  // through buildAssistantContext (which the API route uses) on every turn.
  let checked = false;
  const sent: unknown[] = [];
  const turn = (text: string) => sent.push(buildAssistantContext({ ...(checked ? { communities_checked: true } : {}) }));
  turn("Create a community for neuro-oncology researchers at UAB"); // before the matches
  checked = true; // the match cards appeared
  turn("Create a new community on neuro-oncology");
  turn("Change the name");
  assert.deepEqual(sent, [{}, { communities_checked: true }, { communities_checked: true }]);
});

test("the chat snapshot keeps communitiesChecked across a reload / sign-in", () => {
  const snap = {
    messages: [{ role: "user" as const, content: "Create a community on KRAS" }],
    choices: null,
    action: null,
    communitiesChecked: true,
  };
  assert.deepEqual(restoreChat(serializeChat(snap)), snap);
  assert.equal(restoreChat(JSON.stringify({ messages: snap.messages, communitiesChecked: "yes" }))?.communitiesChecked, undefined);
});

// ── sentences, and answers that survive a reload ─────────────────────────────────

test("joinSentences: one space between sentences, a full stop added where one is missing", () => {
  assert.equal(joinSentences(["Researchers on neuro-oncology", "You'll be its admin."]), "Researchers on neuro-oncology. You'll be its admin.");
  assert.equal(joinSentences(["Already ends.", "Next one!"]), "Already ends. Next one!");
  assert.equal(joinSentences(["  spaced  ", "", null, undefined, "tail"]), "spaced. tail.");
  assert.equal(joinSentences(['He said "stop?"', "Then left"]), 'He said "stop?" Then left.');
  assert.equal(joinSentences([]), "");
  assert.ok(!/\.[A-Za-z]/.test(joinSentences(["For neuro-oncology.", "You'll be admin"])), "never a full stop jammed against a word");
});

const EXTRAS = {
  query: "KRAS pancreatic cancer",
  chips: [{ kind: "paper", text: "12 papers" }],
  cards: [{ id: "p1", kind: "paper", tag: "Paper", tint: "paper" as const, title: "KRAS in PDAC", detail: "2025", url: "https://example.org/p1" }],
  total: 40,
  facts: [{ kind: "approval", label: "Approved", count: 2, text: "Drug A, Drug B" }],
  related: ["What trials are open for KRAS?"],
  offerSave: false,
};
const MSGS = [
  { role: "user" as const, content: "KRAS in pancreatic cancer" },
  { role: "assistant" as const, content: "Here is what I found." },
];

test("a reload brings back the source cards, quick facts and related questions", () => {
  const snap = { messages: MSGS, choices: null, action: null, extras: { 1: EXTRAS } };
  assert.deepEqual(restoreChat(serializeChat(snap)), snap);
});

test("stored answer extras are untrusted: malformed pieces are dropped, a javascript: link too", () => {
  const raw = JSON.stringify({
    messages: MSGS,
    extras: {
      1: { ...EXTRAS, cards: [{ ...EXTRAS.cards[0], url: "javascript:alert(1)" }, { id: 5 }, EXTRAS.cards[0]], facts: [{ nope: 1 }, EXTRAS.facts[0]] },
      9: EXTRAS, // no such message
      x: EXTRAS,
      0: { query: "" },
    },
  });
  const restored = restoreChat(raw)!;
  assert.deepEqual(Object.keys(restored.extras ?? {}), ["1"]);
  assert.deepEqual(restored.extras![1].cards, [EXTRAS.cards[0]]);
  assert.deepEqual(restored.extras![1].facts, EXTRAS.facts);
});

test("extras follow their message when old messages fall off the front of the stored chat", () => {
  const many = Array.from({ length: 23 }, (_, i) => ({ role: i % 2 === 0 ? ("user" as const) : ("assistant" as const), content: `m${i}` }));
  const snap = { messages: many, choices: null, action: null, extras: { 21: EXTRAS } };
  const restored = restoreChat(serializeChat(snap))!;
  assert.equal(restored.messages.length, 20);
  assert.equal(restored.messages[18].content, "m21");
  assert.deepEqual(Object.keys(restored.extras ?? {}), ["18"]);
  // an answer that fell off the front is simply not kept
  assert.equal(restoreChat(serializeChat({ ...snap, extras: { 1: EXTRAS } }))!.extras, undefined);
});

test("a chat with no extras stores and restores none", () => {
  const snap = { messages: MSGS, choices: null, action: null };
  assert.equal("extras" in restoreChat(serializeChat(snap))!, false);
});
