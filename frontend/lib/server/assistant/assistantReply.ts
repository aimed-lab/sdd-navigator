// lib/server/assistant/assistantReply.ts — pure helpers for the Explore AI
// assistant: parsing what the backend returns, cleaning what we send, the
// near-duplicate check for public pages, and the sessionStorage snapshot.
//
// No runtime imports, so `npm test` covers it and client components may import
// it. The assistant only PROPOSES (backend/explore-mcp/tools/assistant.py):
// everything here treats the reply as untrusted data and validates it before
// the UI acts on it.

export type Visibility = "private" | "team" | "public";

export const VISIBILITIES: Visibility[] = ["private", "team", "public"];

export const CHOICE_INFO: Record<Visibility, { label: string; line: string }> = {
  private: { label: "Private", line: "Only you. Your own self-updating notebook." },
  team: { label: "Team", line: "You and the people you invite." },
  public: { label: "Public", line: "Anyone can find and follow it." },
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type CreatePageAction = {
  type: "create_page";
  title: string;
  seed_input: string;
  visibility: Visibility;
};

export type AssistantReply = {
  reply: string;
  choices?: Visibility[];
  action?: CreatePageAction;
};

export const MAX_MESSAGES = 20;
export const MAX_MESSAGE_CHARS = 2000;
// Same bounds POST /api/pages enforces on the topic and title.
export const MIN_SEED_CHARS = 3;
export const MAX_SEED_CHARS = 200;
export const MIN_TITLE_CHARS = 3;
export const MAX_TITLE_CHARS = 120;

export function isVisibility(v: unknown): v is Visibility {
  return v === "private" || v === "team" || v === "public";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validates the backend's { reply, choices?, action? }. Returns null when
 *  there is no usable reply. A malformed `choices` or `action` is dropped
 *  rather than trusted; when an action is present, choices are dropped (the
 *  user has already picked). */
export function parseAssistantReply(json: unknown): AssistantReply | null {
  if (!isRecord(json)) return null;
  const reply = typeof json.reply === "string" ? json.reply.trim() : "";
  if (!reply) return null;
  const out: AssistantReply = { reply };

  if (isRecord(json.action) && json.action.type === "create_page") {
    const title = typeof json.action.title === "string" ? json.action.title.trim() : "";
    const seed = typeof json.action.seed_input === "string" ? json.action.seed_input.trim() : "";
    const visibility = json.action.visibility;
    if (
      title.length >= MIN_TITLE_CHARS &&
      title.length <= MAX_TITLE_CHARS &&
      seed.length >= MIN_SEED_CHARS &&
      seed.length <= MAX_SEED_CHARS &&
      isVisibility(visibility)
    ) {
      out.action = { type: "create_page", title, seed_input: seed, visibility };
      return out;
    }
  }

  if (Array.isArray(json.choices)) {
    const choices = VISIBILITIES.filter((v) => (json.choices as unknown[]).includes(v));
    if (choices.length > 0) out.choices = choices;
  }
  return out;
}

/** The messages to send: last MAX_MESSAGES user/assistant turns, text only. */
export function cleanMessagesForSend(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (!isRecord(m)) continue;
    if ((m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") continue;
    const content = m.content.trim().slice(0, MAX_MESSAGE_CHARS);
    if (content) out.push({ role: m.role, content });
  }
  return out.slice(-MAX_MESSAGES);
}

// ── near-duplicate public pages ──────────────────────────────────────────────

const STOP = new Set(["a", "an", "and", "the", "of", "in", "on", "for", "to", "with", "by"]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t));
}

/** Word overlap (Jaccard) of two phrases, 0..1. */
export function similarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  A.forEach((t) => {
    if (B.has(t)) shared += 1;
  });
  return shared / (A.size + B.size - shared);
}

export const DUPLICATE_THRESHOLD = 0.8;

/** True when a proposed page is near-identical to an existing one: its title or
 *  its seed phrase matches the other's title or seed phrase. */
export function isNearDuplicate(
  proposed: { title: string; seed: string },
  existing: { title: string; seed: string }
): boolean {
  const pairs: [string, string][] = [
    [proposed.title, existing.title],
    [proposed.seed, existing.seed],
    [proposed.seed, existing.title],
    [proposed.title, existing.seed],
  ];
  return pairs.some(([x, y]) => similarity(x, y) >= DUPLICATE_THRESHOLD);
}

// ── sessionStorage snapshot (chat survives a sign-in round trip) ─────────────

export type ChatSnapshot = {
  messages: ChatMessage[];
  choices: Visibility[] | null;
  action: CreatePageAction | null;
};

export const CHAT_STORAGE_KEY = "sdd.assistant.v1";

export function serializeChat(snapshot: ChatSnapshot): string {
  return JSON.stringify({
    messages: cleanMessagesForSend(snapshot.messages),
    choices: snapshot.choices,
    action: snapshot.action,
  });
}

/** Parses a stored snapshot; anything malformed restores to nothing. */
export function restoreChat(raw: string | null): ChatSnapshot | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data)) return null;
    const messages = cleanMessagesForSend(data.messages);
    if (messages.length === 0) return null;
    // Reuse the reply validator so a stored action/choices are re-checked.
    const checked = parseAssistantReply({ reply: "x", choices: data.choices, action: data.action });
    return { messages, choices: checked?.choices ?? null, action: checked?.action ?? null };
  } catch {
    return null;
  }
}
