// lib/server/assistant/assistantBridge.ts — how a button elsewhere on the page
// (Explore's "New wiki page", "Save as wiki page", suggested
// follow-ups) hands a message to the assistant panel. The page dispatches a
// window event; the panel (components/explore/AssistantChat.tsx) listens, opens
// itself and either SENDS the message as the researcher's own turn or FILLS the
// input. Nothing is created here: a wiki page still goes through the panel's
// usual picker and confirm step.
//
// No runtime imports, so `npm test` covers parseAssistantRequest.

export const ASSISTANT_EVENT = "sdd:assistant";

export type AssistantRequest = { text: string; mode: "send" | "fill" };

const MAX_TEXT = 500;

/** A request from untrusted event data, or null when it is not usable. */
export function parseAssistantRequest(raw: unknown): AssistantRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return null;
  return { text, mode: r.mode === "fill" ? "fill" : "send" };
}

/** Opens the assistant panel and sends (or fills) `text`. Safe to call on the server (does nothing). */
export function openAssistant(request: AssistantRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ASSISTANT_EVENT, { detail: request }));
}

/** The message that starts the existing save flow for a topic. */
export function saveAsLivingPageMessage(topic: string): string {
  return `I'd like to create a wiki page on ${topic.trim().slice(0, 150)}`;
}

/** The message behind the dashed "New wiki page" card. */
export const START_LIVING_PAGE_MESSAGE = "I'd like to create a wiki page for my research.";
