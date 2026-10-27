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

/** A team the page the assistant makes should be added to ("Make learning
 *  material" on a team page). */
export type AssistantTeam = {
  id: string;
  name: string;
  slug: string;
  /** false: the viewer is a member, not a lead. The assistant then never offers to make
   *  or add a wiki page for the team (the server refuses it as well). Undefined: no limit. */
  canCurate?: boolean;
};

// The team whose page is open. The team page registers it so the panel knows
// the team even when the message is typed by hand (not sent from the tile).
// A window global, not only an event: the page's effect can run before the
// panel's listener exists on a first load.
declare global {
  interface Window {
    __sddPageTeam?: AssistantTeam | null;
  }
}

export function setPageTeam(team: AssistantTeam | null): void {
  if (typeof window === "undefined") return;
  window.__sddPageTeam = team;
}

export function getPageTeam(): AssistantTeam | null {
  return typeof window === "undefined" ? null : (window.__sddPageTeam ?? null);
}

// On a team page for someone who is not on the team, the floating "Ask AI
// assistant" button asks for sign-in/join instead of opening the panel. The team
// page registers the function that does that.
declare global {
  interface Window {
    __sddAssistantGate?: (() => void) | null;
  }
}

export function setAssistantGate(gate: (() => void) | null): void {
  if (typeof window === "undefined") return;
  window.__sddAssistantGate = gate;
}

export function getAssistantGate(): (() => void) | null {
  return typeof window === "undefined" ? null : (window.__sddAssistantGate ?? null);
}

export type AssistantRequest = { text: string; mode: "send" | "fill" | "open"; team?: AssistantTeam };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseTeam(raw: unknown): AssistantTeam | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const t = raw as Record<string, unknown>;
  const name = typeof t.name === "string" ? t.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const slug = typeof t.slug === "string" && /^[a-z0-9-]{1,200}$/.test(t.slug) ? t.slug : "";
  if (typeof t.id !== "string" || !UUID_RE.test(t.id) || !name || !slug) return undefined;
  return { id: t.id.toLowerCase(), name, slug, ...(typeof t.canCurate === "boolean" ? { canCurate: t.canCurate } : {}) };
}

const MAX_TEXT = 500;

/** A request from untrusted event data, or null when it is not usable. */
export function parseAssistantRequest(raw: unknown): AssistantRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  // "open" just opens the panel (no text needed.
  if (r.mode === "open") return { text: "", mode: "open" };
  const text = typeof r.text === "string" ? r.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return null;
  const team = parseTeam(r.team);
  return { text, mode: r.mode === "fill" ? "fill" : "send", ...(team ? { team } : {}) };
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
