// Run with `npm test`. Parsing of the assistant's { reply, choices, action }.

import test from "node:test";
import assert from "node:assert/strict";
import {
  GREETING,
  STARTERS,
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

test("starters: the four chips, in order, and only Communities is greyed out", () => {
  assert.deepEqual(
    STARTERS.map((s) => s.label),
    [
      "Find resources on a topic",
      "Create a living page for my research",
      "Show my pages",
      "Communities (coming soon)",
    ]
  );
  assert.deepEqual(
    STARTERS.filter((s) => s.kind === "soon").map((s) => s.id),
    ["communities"]
  );
});

test("starters: each live chip starts a flow or fills the input", () => {
  const byId = Object.fromEntries(STARTERS.map((s) => [s.id, s]));
  assert.equal(byId.find.kind, "fill");
  assert.match((byId.find as { text: string }).text, /^Find resources on /);
  assert.equal(byId.create.kind, "send");
  assert.match((byId.create as { text: string }).text, /living page/);
  assert.deepEqual({ kind: byId.mine.kind, href: (byId.mine as { href: string }).href }, { kind: "go", href: "/pages" });
  assert.ok(!("text" in byId.communities) && !("href" in byId.communities), "the greyed chip does nothing");
  assert.match(byId.find.hint ?? "", /papers, trials, FDA approvals, compounds, datasets, grants, tools/);
  assert.match(byId.create.hint ?? "", /private, team or public, keeps itself updated/);
});

test("the panel is offered on Explore and the /pages screens only", () => {
  for (const ok of ["/explore", "/explore/egfr", "/explore/podcast", "/pages", "/pages/egfr-abc12"]) {
    assert.equal(assistantAvailableOn(ok), true, ok);
  }
  for (const no of ["/", "/projects", "/collaborate", "/pagesx", "/exploreme", "", null, undefined]) {
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
