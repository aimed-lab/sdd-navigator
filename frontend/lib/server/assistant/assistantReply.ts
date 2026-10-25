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

import type { AnswerExtras } from "./assistantAnswer.ts";
import { sanitizeExtras } from "./assistantAnswer.ts";

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** Joins sentences into one line with exactly one space between them, adding a
 *  full stop where a sentence has no ending punctuation of its own:
 *  joinSentences(["Researchers on neuro-oncology", "You'll be its admin."]) ->
 *  "Researchers on neuro-oncology. You'll be its admin." */
export function joinSentences(parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .map((p) => (/[.!?…]["')\]]*$/.test(p) ? p : p + "."))
    .join(" ");
}

export type CreatePageAction = {
  type: "create_page";
  title: string;
  seed_input: string;
  visibility: Visibility;
};

/** The assistant asks the app to look for existing communities on a topic. Nothing is created. */
export type FindCommunitiesAction = { type: "find_communities"; query: string };

/** A drafted community (name + one-line purpose). The researcher edits it and confirms. */
export type CreateCommunityAction = { type: "create_community"; name: string; purpose: string };

export type CommunityAction = FindCommunitiesAction | CreateCommunityAction;

/** A numbered source the answer's [n] refers to (backend `sources`). */
export type AnswerSource = { n: number; kind: string; title: string; url: string | null; detail: string };

export type AssistantReply = {
  reply: string;
  choices?: Visibility[];
  action?: CreatePageAction;
  /** A community step the assistant proposes (find existing ones, or a draft). */
  community?: CommunityAction;
  /** The search the assistant actually ran (absent/undefined: none, or an older backend). */
  query?: string | null;
  related?: string[];
  sources?: AnswerSource[];
};

export const MAX_MESSAGES = 20;
export const MAX_MESSAGE_CHARS = 2000;
// Same bounds POST /api/pages enforces on the topic and title.
export const MIN_SEED_CHARS = 3;
export const MAX_SEED_CHARS = 200;
export const MIN_TITLE_CHARS = 3;
export const MAX_TITLE_CHARS = 120;
// Community drafts (same bounds as the agent's create_community tool).
export const MIN_COMMUNITY_NAME_CHARS = 3;
export const MAX_COMMUNITY_NAME_CHARS = 80;
export const MIN_COMMUNITY_PURPOSE_CHARS = 3;
export const MAX_COMMUNITY_PURPOSE_CHARS = 300;

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

  if ("query" in json) {
    out.query = typeof json.query === "string" && json.query.trim() ? json.query.trim().slice(0, MAX_SEED_CHARS) : null;
  }
  if (Array.isArray(json.related)) {
    const related = json.related
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim())
      .filter((q) => q.length >= 5 && q.length <= 200)
      .slice(0, 3);
    if (related.length > 0) out.related = related;
  }
  if (Array.isArray(json.sources)) {
    const sources: AnswerSource[] = [];
    for (const x of json.sources.slice(0, 3)) {
      if (!isRecord(x) || typeof x.title !== "string" || !x.title.trim() || typeof x.kind !== "string") continue;
      const url = typeof x.url === "string" && /^https?:\/\//i.test(x.url) ? x.url : null;
      sources.push({
        n: sources.length + 1,
        kind: x.kind,
        title: x.title.trim().slice(0, 200),
        url,
        detail: typeof x.detail === "string" ? x.detail.trim().slice(0, 140) : "",
      });
    }
    if (sources.length > 0) out.sources = sources;
  }

  if (isRecord(json.action) && json.action.type === "find_communities") {
    const q = typeof json.action.query === "string" ? json.action.query.trim() : "";
    if (q.length >= MIN_SEED_CHARS && q.length <= MAX_SEED_CHARS) {
      out.community = { type: "find_communities", query: q };
      return out;
    }
  }

  if (isRecord(json.action) && json.action.type === "create_community") {
    const draft = parseCommunityDraft(json.action);
    if (draft) {
      out.community = draft;
      return out;
    }
  }

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

/** What the assistant asks when a community request names no topic. Keep in
 *  step with COMMUNITY_TOPIC_QUESTION in backend/explore-mcp/tools/assistant.py:
 *  the next message is then the answer, not a search. */
export const COMMUNITY_TOPIC_QUESTION = "What topic or research area is the community for?";

// Same pattern as the backend's is_community_request.
const COMMUNITY_REQUEST =
  /\b(?:create|find|join|start|make|set\s*up|build|looking\s+for|search\s+for|show\s+me|is\s+there|are\s+there)\b[^.?!]{0,40}\bcommunit(?:y|ies)\b|\b(?:a|an|new|existing)\s+(?:[\w-]+\s+){0,2}communit(?:y|ies)\s+(?:for|on|about|of|around)\b/i;

/** Is this message asking to find / create / join a community? */
export function isCommunityRequest(text: string): boolean {
  return COMMUNITY_REQUEST.test(text);
}

/** Is the turn about to be sent a community turn? True for a community request,
 *  and for the answer to "What topic ... is the community for?". Such a turn is
 *  never an Explore search: no panel search, no navigation, no source cards,
 *  quick facts, Save page or Related questions. */
export function isCommunityTurn(messages: ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return false;
  if (isCommunityRequest(last.content)) return true;
  const prior = messages.slice(0, -1).reverse().find((m) => m.role === "assistant");
  return prior?.content.trim() === COMMUNITY_TOPIC_QUESTION;
}

/** The context forwarded to the assistant backend. `communities_checked` must
 *  be passed through on every turn after the matches were shown: without it the
 *  backend would keep sending the researcher back to the check. */
export function buildAssistantContext(raw: unknown): {
  query?: string;
  page_created?: true;
  communities_checked?: true;
} {
  const ctx = isRecord(raw) ? raw : {};
  const query = typeof ctx.query === "string" ? ctx.query.trim().slice(0, MAX_SEED_CHARS) : "";
  return {
    ...(query ? { query } : {}),
    ...(ctx.page_created === true ? { page_created: true as const } : {}),
    ...(ctx.communities_checked === true ? { communities_checked: true as const } : {}),
  };
}

/** A community draft from untrusted data, or null when name/purpose are unusable. */
export function parseCommunityDraft(raw: unknown): CreateCommunityAction | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const purpose = typeof raw.purpose === "string" ? raw.purpose.trim() : "";
  if (name.length < MIN_COMMUNITY_NAME_CHARS || name.length > MAX_COMMUNITY_NAME_CHARS) return null;
  if (purpose.length < MIN_COMMUNITY_PURPOSE_CHARS || purpose.length > MAX_COMMUNITY_PURPOSE_CHARS) return null;
  return { type: "create_community", name, purpose };
}

/** What is wrong with an edited draft, or null when it can go to the confirm step. */
export function communityDraftProblem(name: string, purpose: string): string | null {
  const n = name.trim();
  const p = purpose.trim();
  if (n.length < MIN_COMMUNITY_NAME_CHARS) return "Give the community a name.";
  if (n.length > MAX_COMMUNITY_NAME_CHARS) return `Keep the name under ${MAX_COMMUNITY_NAME_CHARS} characters.`;
  if (p.length < MIN_COMMUNITY_PURPOSE_CHARS) return "Say in one line what it is for.";
  if (p.length > MAX_COMMUNITY_PURPOSE_CHARS) return `Keep the purpose under ${MAX_COMMUNITY_PURPOSE_CHARS} characters.`;
  return null;
}

/** The message sent when the researcher asks for a new community after seeing the matches. */
export function newCommunityMessage(topic: string): string {
  return `Create a new community on ${topic.trim().slice(0, MAX_SEED_CHARS)}`;
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

// ── the side panel: greeting chips and where the panel shows ─────────────────

export const GREETING = "Hi, I'm your SmartDrugDiscovery assistant. I can help you:";

/** What a starter chip does when clicked. `fill` puts a starter sentence in the
 *  input, `send` sends it as the first message, `go` opens a screen (the chat
 *  stays), `soon` is greyed out and does nothing. */
export type Starter =
  | { id: string; label: string; hint?: string; kind: "fill" | "send"; text: string }
  | { id: string; label: string; hint?: string; kind: "go"; href: string }
  | { id: string; label: string; hint?: string; kind: "soon" };

// Only things the assistant can really do (keep in step with _SYSTEM in
// backend/explore-mcp/tools/assistant.py).
export const STARTERS: Starter[] = [
  {
    id: "find",
    label: "Find resources on a topic",
    hint: "papers, trials, FDA approvals, compounds, datasets, grants, tools",
    kind: "fill",
    text: "Find resources on ",
  },
  {
    id: "create",
    label: "Create a wiki page for my research",
    hint: "private, team or public, keeps itself updated",
    kind: "send",
    text: "I'd like to create a wiki page for my research.",
  },
  { id: "mine", label: "Show my pages", kind: "go", href: "/pages" },
  {
    id: "communities",
    label: "Find or create a community",
    hint: "see what exists first, then join or start one",
    kind: "send",
    text: "I'd like to find or create a community.",
  },
];

/** The panel is offered on Explore and on the /pages screens only. */
export function assistantAvailableOn(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // A team page too: its "Make learning material" tile opens the assistant.
  if (pathname.startsWith("/teams/") && pathname !== "/teams/new") return true;
  return pathname === "/explore" || pathname.startsWith("/explore/") || pathname === "/pages" || pathname.startsWith("/pages/");
}

/** The Explore search text in the URL (/explore/<topic>), if any. */
export function exploreQueryFromPath(pathname: string | null | undefined): string {
  const m = /^\/explore\/([^/]+)$/.exec(pathname ?? "");
  if (!m || m[1] === "podcast") return "";
  try {
    return decodeURIComponent(m[1]).trim().slice(0, 200);
  } catch {
    return "";
  }
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

// ── the public-page check, now run as soon as Public is picked ────────────────

/** A page that will be public is checked against existing public pages as soon
 *  as it is proposed (before the confirm card); private and team pages never are. */
export function needsEarlyDuplicateCheck(action: Pick<CreatePageAction, "visibility">): boolean {
  return action.visibility === "public";
}

/** What a button on the "A public page on this already exists" card does. None
 *  of them creates anything: each leads to the usual confirm card.
 *    private -> the same page, but private (nothing public to duplicate);
 *    anyway  -> still public, and the check is not repeated for it. */
export function afterDuplicateChoice(
  action: CreatePageAction,
  choice: "private" | "anyway"
): { action: CreatePageAction; skipCheck: boolean } {
  return choice === "private"
    ? { action: { ...action, visibility: "private" }, skipCheck: true }
    : { action, skipCheck: true };
}

/** Identifies a proposed page, so a skipped check applies to that page only. */
export function pageKey(a: Pick<CreatePageAction, "title" | "seed_input" | "visibility">): string {
  return `${a.visibility}|${a.title.trim().toLowerCase()}|${a.seed_input.trim().toLowerCase()}`;
}

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
  /** A community draft waiting for the researcher (survives the sign-in round trip). */
  communityDraft?: CreateCommunityAction | null;
  /** The matches were shown in this chat (so a new community can be drafted). */
  communitiesChecked?: boolean;
  /** Source cards, quick facts and related questions under each answer, keyed
   *  by assistant message index. */
  extras?: Record<number, AnswerExtras>;
};

export const CHAT_STORAGE_KEY = "sdd.assistant.v1";

export function serializeChat(snapshot: ChatSnapshot): string {
  return JSON.stringify({
    messages: cleanMessagesForSend(snapshot.messages),
    choices: snapshot.choices,
    action: snapshot.action,
    ...(snapshot.communityDraft ? { communityDraft: snapshot.communityDraft } : {}),
    ...(snapshot.communitiesChecked ? { communitiesChecked: true } : {}),
    ...persistedExtras(snapshot),
  });
}

/** The extras to store. Only the last MAX_MESSAGES messages are kept, so the
 *  message indexes move down by however many were dropped from the front. */
function persistedExtras(snapshot: ChatSnapshot): { extras?: Record<number, AnswerExtras> } {
  if (!snapshot.extras) return {};
  const offset = Math.max(0, snapshot.messages.length - cleanMessagesForSend(snapshot.messages).length);
  const shifted: Record<number, AnswerExtras> = {};
  for (const [key, value] of Object.entries(snapshot.extras)) {
    const index = Number(key) - offset;
    if (index >= 0) shifted[index] = value;
  }
  return Object.keys(shifted).length > 0 ? { extras: shifted } : {};
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
    const draft = parseCommunityDraft(data.communityDraft);
    return {
      messages,
      choices: checked?.choices ?? null,
      action: checked?.action ?? null,
      ...(draft ? { communityDraft: draft } : {}),
      ...(data.communitiesChecked === true ? { communitiesChecked: true } : {}),
      ...restoredExtras(data.extras, messages.length),
    };
  } catch {
    return null;
  }
}

function restoredExtras(raw: unknown, messageCount: number): { extras?: Record<number, AnswerExtras> } {
  const all = sanitizeExtras(raw);
  const kept: Record<number, AnswerExtras> = {};
  for (const [key, value] of Object.entries(all)) if (Number(key) < messageCount) kept[Number(key)] = value;
  return Object.keys(kept).length > 0 ? { extras: kept } : {};
}
