// Run with `npm test`. The message a page button hands to the assistant panel.

import test from "node:test";
import assert from "node:assert/strict";
import { START_LIVING_PAGE_MESSAGE, openAssistant, parseAssistantRequest, saveAsLivingPageMessage } from "./assistantBridge.ts";

test("parseAssistantRequest: send by default, fill when asked, junk refused", () => {
  assert.deepEqual(parseAssistantRequest({ text: "  What trials are open?  " }), { text: "What trials are open?", mode: "send" });
  assert.deepEqual(parseAssistantRequest({ text: "Find resources on ", mode: "fill" }), { text: "Find resources on", mode: "fill" });
  assert.deepEqual(parseAssistantRequest({ text: "x", mode: "weird" }), { text: "x", mode: "send" });
  for (const bad of [null, undefined, "text", 5, {}, { text: "" }, { text: "   " }, { text: 4 }]) {
    assert.equal(parseAssistantRequest(bad), null, String(bad));
  }
  assert.equal(parseAssistantRequest({ text: "y".repeat(900) })!.text.length, 500);
});

test("the save flow starts with a living-page request naming the topic", () => {
  assert.equal(saveAsLivingPageMessage("  KRAS in pancreatic cancer "), "I'd like to create a living page on KRAS in pancreatic cancer");
  assert.match(START_LIVING_PAGE_MESSAGE, /living page/);
});

test("openAssistant does nothing (and does not throw) without a window", () => {
  assert.doesNotThrow(() => openAssistant({ text: "hi", mode: "send" }));
});
