// Run with `npm test`. Parsing of the assistant's { reply, choices, action }.

import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanMessagesForSend,
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
