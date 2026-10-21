// lib/server/assistant/assistantAnswer.ts — pure helpers behind the assistant
// panel's answers: which topic a message is about (so the main page can follow
// it), whether to show the page-type picker straight away, cleaning replies,
// a small markdown reader, result cards and follow-up chips.
//
// No runtime imports, so `npm test` covers it and the client panel may import
// it. Everything works from what the CURRENT backend already returns ({reply})
// plus a normal /api/explore response, so the panel needs no backend change.

import type { ExploreSection } from "@/types/explore";

// ── what is the message about? ───────────────────────────────────────────────

const PICK = /^(?:private|team|public)\b[\s.!]*$/i;
const CHITCHAT = /^(?:hi|hello|hey|thanks|thank you|thx|ok|okay|yes|no|yep|nope|sure|great|cool|good|bye)\b[\s!.?,]*$/i;
// "create a living page for my research": a page request with no topic yet.
const PAGE_REQUEST_NO_TOPIC =
  /^(?:(?:i(?:'d| would)? (?:like|want|need) to|i want to|can you|could you|please)\s+)?(?:create|make|build|start|set up)\s+(?:me\s+)?(?:a\s+|an\s+|my\s+)?(?:(?:new|living)\s+)*page(?:\s+for\s+(?:my|our)\s+research|\s+for\s+me)?[\s.!?]*$/i;

const LEAD = new RegExp(
  "^(?:(?:please|can you|could you|i'd like you to)\\s+)?" +
    "(?:(?:" +
    [
      "(?:create|make|build|start)\\s+(?:me\\s+)?(?:a\\s+|an\\s+)?(?:(?:new|living)\\s+)*page\\s+(?:on|about|for)",
      "what (?:is|are|has been) known about",
      "what do (?:we|you|i) know about",
      "can you (?:explain|tell me about)",
      "explain",
      "give me an overview of",
      "show me",
      "show",
      "find me",
      "find",
      "search for",
      "search",
      "look up",
      "look for",
      "open",
      "tell me about",
      "what(?:'s| is| are| about)",
      "who (?:is|are)",
      "how (?:does|do|is|are)",
      "i work on",
      "i study",
      "i research",
      "i'm (?:working on|researching)",
      "i am (?:working on|researching)",
      "my research (?:is|focuses on)(?: on| about)?",
      "(?:the )?(?:latest |recent )?(?:resources|papers|clinical trials|trials|datasets|grants|compounds)(?: on| about| for)?",
      "(?:known )?about",
      "(?:the|a|an)",
    ].join("|") +
    ")\\s+)+",
  "i"
);

/** The topic a user message is about, or null when it is not a search request
 *  (a page-type pick, small talk, or "create a page" with no topic yet). */
export function topicFromMessage(text: string): string | null {
  const t = (text ?? "").trim();
  if (t.length < 3 || PICK.test(t) || CHITCHAT.test(t) || PAGE_REQUEST_NO_TOPIC.test(t)) return null;
  const topic = t
    .replace(LEAD, "")
    .replace(/[\s?!.]+$/, "")
    .trim()
    .slice(0, 200);
  return topic.length >= 3 ? topic : null;
}

const SAYS_WORK = /\b(?:i work on|i study|i research|i'm (?:working on|researching)|i am (?:working on|researching)|my research (?:is|focuses))\b/i;
const ASKS_PAGE = /\b(?:(?:create|make|build|start|set up|want|need|like)\b[^.?!]{0,40}\bpage|(?:living|new) page)\b/i;

/** Show the Private / Team / Public picker right away? Only when the researcher
 *  says what they work on, or asks for a page, AND there is a topic to build it
 *  on. Ordinary questions never get it. */
export function wantsPickerNow(text: string): boolean {
  return (SAYS_WORK.test(text) || ASKS_PAGE.test(text)) && topicFromMessage(text) !== null;
}

// ── cleaning a reply ─────────────────────────────────────────────────────────

// "- Private: only you", "**Team** - you and people you invite", "1) Public: ..."
const CHOICE_LINE = /^\s*(?:[-*•]|\d+[.)])?\s*\**(?:private|team|public)\**\s*[:\-–—]/i;
const ASK_TYPE =
  /\b(?:private,?\s*team,?\s*(?:or|and)\s*public|which\s+(?:kind|type)\s+of\s+page(?:\s+do\s+you\s+want)?|what\s+(?:kind|type)\s+of\s+page)\b/i;

/** Removes "Which kind of page do you want?" and the Private / Team / Public
 *  lines from a reply, whatever the backend sends. The picker (or the Save
 *  action) carries that choice in the UI. */
export function stripChoiceText(reply: string): string {
  const kept: string[] = [];
  for (const line of (reply ?? "").split(/\r?\n/)) {
    if (CHOICE_LINE.test(line)) continue;
    if (ASK_TYPE.test(line)) {
      const rest = line
        .split(/(?<=[.?!])\s+/)
        .filter((x) => !ASK_TYPE.test(x))
        .join(" ");
      kept.push(rest);
    } else {
      kept.push(line);
    }
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── a small, safe markdown reader ────────────────────────────────────────────

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; v: string }
  | { t: "link"; v: string; href: string }
  | { t: "cite"; n: number };

export type Block =
  | { t: "p"; inlines: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] };

const SAFE_HREF = /^(?:https?:\/\/|\/(?!\/))/i;

function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\[(\d{1,2})\](?!\()|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>)]+[^\s<>).,;:!?])/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "bold", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "cite", n: Number(m[2]) });
    else if (m[3] !== undefined) {
      out.push(SAFE_HREF.test(m[4]) ? { t: "link", v: m[3], href: m[4] } : { t: "text", v: m[3] });
    } else out.push({ t: "link", v: m[5], href: m[5] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

/** Bold, short lists, links and paragraphs. Nothing else is interpreted, and a
 *  link is kept only when it is http(s) or a site path, so a reply cannot
 *  smuggle in a javascript: URL. Returns data, never HTML. */
export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: Inline[][] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", inlines: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = /^(?:[-*•])\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const kind = bullet ? "ul" : "ol";
      if (!list || list.t !== kind) {
        flushList();
        list = { t: kind, items: [] };
      }
      list.items.push(parseInline((bullet ?? numbered)![1]));
    } else if (line === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.replace(/^#{1,6}\s+/, ""));
    }
  }
  flushPara();
  flushList();
  return blocks;
}

// ── is a result about the topic? ─────────────────────────────────────────────

// Grammar and generic research words: they do not say WHAT the topic is.
const GENERIC = new Set([
  "the", "and", "for", "with", "from", "that", "this", "what", "are", "was", "were", "how", "does", "can", "you",
  "about", "known", "know", "tell", "explain", "show", "find", "latest", "recent", "new", "any", "has", "have",
  "study", "studies", "treatment", "treatments", "therapy", "therapies", "drug", "drugs", "role", "effect",
  "effects", "patients", "clinical", "trial", "trials", "inhibitor", "inhibitors", "resistance", "disease",
  "research", "paper", "papers", "resources", "side", "use", "using", "used",
]);

/** The words a result must mention at least one of (the gene, drug or disease
 *  of the query). Mirrors topic_terms() in backend/explore-mcp/tools/assistant.py. */
export function topicTerms(topic: string): string[] {
  const words = (topic.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? []).filter((w) => w.length >= 3);
  const specific = words.filter((w) => !GENERIC.has(w));
  return specific.length > 0 ? specific : words;
}

// FDA approvals and compounds are already searched BY the gene or disease, and
// their names ("RASONQUE (daraxonrasib)") rarely contain it, so the topic
// filter is not applied to them. It is for papers, preprints, datasets,
// trials, grants and tools.
const UNFILTERED_KINDS = new Set(["approval", "compound"]);

/** Is this item on topic? Approvals and compounds always are. */
export function onTopic(item: { title?: string | null; summary?: string | null }, kind: string, terms: string[]): boolean {
  return UNFILTERED_KINDS.has(kind) || mentionsTopic(item, terms);
}

/** Does the item's title or description mention a main topic term? */
export function mentionsTopic(item: { title?: string | null; summary?: string | null }, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = `${item.title ?? ""} ${item.summary ?? ""}`.toLowerCase();
  return terms.some((t) => hay.includes(t));
}

// ── result cards and follow-ups ──────────────────────────────────────────────

export type ResultCard = {
  id: string;
  kind: string;
  tag: string;
  /** Which --type-<tint>-bg / -fg colour pair to use. */
  tint: "paper" | "dataset" | "tool" | "news" | "podcast" | "community" | "other";
  title: string;
  detail: string;
  url: string | null;
};

const KINDS: Record<string, { tag: string; tint: ResultCard["tint"] }> = {
  approval: { tag: "FDA approved", tint: "news" },
  trial: { tag: "Trial", tint: "community" },
  paper: { tag: "Paper", tint: "paper" },
  compound: { tag: "Compound", tint: "dataset" },
  dataset: { tag: "Dataset", tint: "dataset" },
  grant: { tag: "Grant", tint: "podcast" },
  tool: { tag: "Tool", tint: "tool" },
  preprint: { tag: "Preprint", tint: "paper" },
};

// Order in which result kinds are offered as cards (a mix beats five papers).
// FDA approved first, then papers, then trials, then the rest.
const CARD_ORDER = ["approval", "paper", "trial", "preprint", "compound", "dataset", "grant", "tool"];

type Item = ExploreSection["items"][number];

function clip(text: string, n: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…";
}

function year(iso: string | null | undefined): string | null {
  const m = /^(\d{4})/.exec(iso ?? "");
  return m ? m[1] : null;
}

function raw(item: Item): Record<string, unknown> {
  return item.raw && typeof item.raw === "object" ? item.raw : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function cardDetail(item: Item): string {
  const r = raw(item);
  let parts: (string | null)[] = [];
  if (item.kind === "trial") {
    parts = [str(r.overall_status)?.replace(/_/g, " ").toLowerCase() ?? null, str(r.phase)];
  } else if (item.kind === "approval") {
    const d = str(r.approval_date);
    parts = [str(r.sponsor) ?? str(r.generic), d && /^\d{4}/.test(d) ? `approved ${d.slice(0, 4)}` : null];
  } else if (item.kind === "paper" || item.kind === "preprint") {
    parts = [item.source, year(item.date_iso)];
  }
  const line = parts.filter(Boolean).join(" · ");
  if (line) return clip(line, 110);
  if (item.summary) return clip(item.summary, 110);
  return clip([item.source, year(item.date_iso)].filter(Boolean).join(" · "), 110);
}

/** Up to `max` compact cards, one kind at a time, so a mixed set of results
 *  (a drug, its trial, a paper) shows instead of five papers. */
export function pickResultCards(
  sections: ExploreSection[] | null | undefined,
  max = 5,
  topic?: string
): ResultCard[] {
  const terms = topic ? topicTerms(topic) : [];
  const byKind = new Map<string, Item[]>();
  for (const s of sections ?? []) {
    const items = (s.items ?? []).filter(
      (i) => i && typeof i.title === "string" && i.title.trim() && onTopic(i, s.kind, terms)
    );
    if (items.length && KINDS[s.kind]) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), ...items]);
  }
  const cards: ResultCard[] = [];
  for (let round = 0; cards.length < max && round < max; round++) {
    for (const kind of CARD_ORDER) {
      const item = byKind.get(kind)?.[round];
      if (!item || cards.length >= max) continue;
      const k = KINDS[kind];
      cards.push({
        id: `${kind}:${item.id}`,
        kind,
        tag: k.tag,
        tint: k.tint,
        title: clip(item.title, 140),
        detail: cardDetail(item),
        url: typeof item.url === "string" && SAFE_HREF.test(item.url) ? item.url : null,
      });
    }
  }
  // Whatever order they were picked in, show FDA approved, papers, trials, rest.
  const rank = (c: ResultCard) => CARD_ORDER.indexOf(c.kind);
  return cards.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
}

/** How many results the search found in total. */
export function countResults(sections: ExploreSection[] | null | undefined): number {
  return (sections ?? []).reduce((n, s) => n + (Array.isArray(s.items) ? s.items.length : 0), 0);
}

export type FollowUp = { label: string; text: string };

const FOLLOW_UPS: { kind: string; label: string; ask: string }[] = [
  { kind: "trial", label: "Open trials", ask: "Show clinical trials on" },
  { kind: "approval", label: "Approved drugs", ask: "Show FDA approved drugs for" },
  { kind: "paper", label: "Recent papers", ask: "Show the most recent papers on" },
  { kind: "dataset", label: "Datasets", ask: "Show datasets on" },
  { kind: "grant", label: "Grants", ask: "Show grants on" },
  { kind: "compound", label: "Compounds", ask: "Show compounds for" },
];

/** Two or three follow-up chips, only for kinds the search actually found. */
export function followUpsFor(sections: ExploreSection[] | null | undefined, topic: string): FollowUp[] {
  const has = new Set((sections ?? []).filter((s) => (s.items ?? []).length > 0).map((s) => s.kind));
  const out = FOLLOW_UPS.filter((f) => has.has(f.kind))
    .slice(0, 3)
    .map((f) => ({ label: f.label, text: `${f.ask} ${topic}` }));
  if (out.length < 2) out.push({ label: "Key findings", text: `Summarize the key findings on ${topic}` });
  return out.slice(0, 3);
}

export const PROGRESS_SEARCH = ["Searching papers, trials, FDA approvals…", "Reading what came back…"];
export const PROGRESS_THINK = ["Thinking…"];

// ── the answer's source cards, count chips and quick facts ───────────────────

/** Backend sources (the ones the answer's [n] refers to) as cards. */
export function sourcesToCards(
  sources: { n: number; kind: string; title: string; url: string | null; detail: string }[] | undefined
): ResultCard[] {
  return (sources ?? []).map((x) => {
    const k = KINDS[x.kind] ?? { tag: x.kind, tint: "other" as const };
    return { id: `src:${x.n}`, kind: x.kind, tag: k.tag, tint: k.tint, title: clip(x.title, 100), detail: x.detail, url: x.url };
  });
}

const COUNT_KINDS: { kind: string; one: string; many: string }[] = [
  { kind: "paper", one: "paper", many: "papers" },
  { kind: "preprint", one: "preprint", many: "preprints" },
  { kind: "trial", one: "trial", many: "trials" },
  { kind: "approval", one: "FDA approval", many: "FDA approvals" },
  { kind: "compound", one: "compound", many: "compounds" },
  { kind: "dataset", one: "dataset", many: "datasets" },
  { kind: "grant", one: "grant", many: "grants" },
  { kind: "tool", one: "tool", many: "tools" },
];

/** "10 papers", "9 FDA approvals": the real count per kind, only kinds with results. */
export function countChips(sections: ExploreSection[] | null | undefined): { kind: string; text: string }[] {
  const counts = new Map<string, number>();
  for (const s of sections ?? []) counts.set(s.kind, (counts.get(s.kind) ?? 0) + (s.items ?? []).length);
  return COUNT_KINDS.flatMap((c) => {
    const n = counts.get(c.kind) ?? 0;
    return n > 0 ? [{ kind: c.kind, text: `${n} ${n === 1 ? c.one : c.many}` }] : [];
  });
}

export type FactRow = { kind: string; label: string; count: number; text: string };

function namesWithMore(names: string[], shown: number): string {
  const head = names.slice(0, shown).join(", ");
  return names.length > shown ? `${head} and ${names.length - shown} more` : head;
}

/** Up to three rows - Approved, Open trials, Compounds - only for kinds that
 *  have on-topic results. Recruiting trials come first. */
export function quickFacts(sections: ExploreSection[] | null | undefined, topic: string): FactRow[] {
  const terms = topicTerms(topic);
  const of = (kind: string): Item[] =>
    (sections ?? [])
      .filter((s) => s.kind === kind)
      .flatMap((s) => s.items ?? [])
      .filter((i) => i && typeof i.title === "string" && i.title.trim() && onTopic(i, kind, terms));
  const rows: FactRow[] = [];

  const approvals = of("approval");
  if (approvals.length > 0) {
    const names = [...new Set(approvals.map((i) => clip(str(raw(i).brand) ?? str(raw(i).generic) ?? i.title, 40)))];
    rows.push({ kind: "approval", label: "Approved", count: approvals.length, text: namesWithMore(names, 3) });
  }

  const trials = of("trial");
  if (trials.length > 0) {
    const recruiting = (t: Item) => String(raw(t).overall_status ?? "").toUpperCase() === "RECRUITING";
    const ordered = [...trials.filter(recruiting), ...trials.filter((t) => !recruiting(t))];
    rows.push({
      kind: "trial",
      label: "Open trials",
      count: trials.length,
      text: namesWithMore(ordered.map((t) => clip(t.title, 48)), 2),
    });
  }

  const compounds = of("compound");
  if (compounds.length > 0) {
    const names = [...new Set(compounds.map((i) => clip(i.title, 32)))];
    rows.push({ kind: "compound", label: "Compounds", count: compounds.length, text: namesWithMore(names, 3) });
  }
  return rows.slice(0, 3);
}

// ── panel width and page-type picks ──────────────────────────────────────────

export const PANEL_MIN = 380;
export const PANEL_MAX = 720;

/** The panel width kept between 380 and 720px, and never more than the window
 *  leaves room for (the page needs some space beside it). */
export function clampPanelWidth(width: number, windowWidth = 1440): number {
  const max = Math.max(PANEL_MIN, Math.min(PANEL_MAX, windowWidth - 280));
  const w = Number.isFinite(width) ? Math.round(width) : 500;
  return Math.min(max, Math.max(PANEL_MIN, w));
}

/** Is this message just a Private / Team / Public pick (not a new question)? */
export function isPagePick(text: string): boolean {
  return PICK.test((text ?? "").trim());
}

// ── what the panel does with a reply, whatever the backend sent or failed to ─

/** The search the main page should follow. The backend's own query wins; when it
 *  sends none (an older backend, or `null`) the message's own topic is used, so
 *  a topic question always moves the page. A page-type pick is never a search. */
export function resolveTopic(args: { content: string; backendQuery?: string | null }): string | null {
  if (isPagePick(args.content)) return null;
  const q = typeof args.backendQuery === "string" ? args.backendQuery.trim() : "";
  return q || topicFromMessage(args.content);
}

/** Show the Private / Team / Public picker straight away? Only when the
 *  researcher said what they work on or asked for a page, and nothing is being
 *  proposed. Nothing else decides it: not the backend's own `choices`, and not
 *  a failed or slow search. */
export function shouldShowPicker(content: string, hasAction: boolean): boolean {
  return !hasAction && wantsPickerNow(content);
}
