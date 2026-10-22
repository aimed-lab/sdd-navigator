// lib/server/promote/keyFactsSuggest.ts — the pure half of "Suggest key facts":
// the prompt sent to the LLM helper and the checks run on what comes back.
//
// The model sees ONLY the item's own headline, standfirst and body. Its answer
// is checked here before anyone sees it: a value over 90 characters is cut back
// to a whole clause or dropped (never trimmed with "..."), and a value that
// brings in a number, or a capitalised name, that is not in the item's own text
// is blanked. A blank is correct when the text does not support a fact.
//
// No imports beyond showcaseKinds, so `npm test` covers it.

import { MAX_FACT_CHARS, defaultKeyFacts, KEY_FACT_LABELS, type KeyFact, type ShowcaseType } from "./showcaseKinds.ts";

export const SUGGEST_SYSTEM = `You write the three short "key facts" shown under the headline of a research-news item. You are given the item's headline, standfirst and body, and three labels.

Rules:
- Use ONLY what the text says. Never add a number, a name, a place, a date or a claim that is not in the text.
- Plain words, a short phrase or one sentence, at most ${MAX_FACT_CHARS} characters each. No ellipsis.
- If the text does not support a label, use an empty string for it. A blank is better than a guess.
- Do not repeat the label in the value.

Return only a JSON object: {"facts": ["<value for label 1>", "<value for label 2>", "<value for label 3>"]}`;

/** The user message: the labels, then the item's own text. */
export function buildSuggestMessage(type: ShowcaseType, headline: string, standfirst: string, body: string): string {
  const labels = KEY_FACT_LABELS[type];
  return [
    `Labels:`,
    `1. ${labels[0]}`,
    `2. ${labels[1]}`,
    `3. ${labels[2]}`,
    ``,
    `HEADLINE: ${headline.trim()}`,
    `STANDFIRST: ${standfirst.trim()}`,
    `BODY:`,
    body.trim().slice(0, 12000),
    ``,
    `Return only the JSON object.`,
  ].join("\n");
}

/** A value of at most MAX_FACT_CHARS characters, or "" when it cannot be made
 *  to fit without losing its meaning. Over-long values are cut back to the last
 *  whole clause that fits; they are never ended with an ellipsis. */
export function fitFact(value: string): string {
  const v = value.replace(/\s+/g, " ").trim().replace(/^["“']+|["”']+$/g, "").trim();
  if (v.length <= MAX_FACT_CHARS) return v.replace(/\.{2,}$|…$/g, "").trim();
  const head = v.slice(0, MAX_FACT_CHARS + 1);
  let best = -1;
  for (const sep of [". ", "; ", " — ", " – ", ", ", " and ", " but ", " while "]) {
    const i = head.lastIndexOf(sep);
    if (i > best && i >= 25) best = i;
  }
  if (best < 0) return "";
  return head.slice(0, best).replace(/[\s,;:.–—-]+$/g, "").trim();
}

const NUMBER = /\d[\d,.]*\d|\d/g;
const NAME = /\b[A-Z][A-Za-z0-9-]{2,}\b/g;

/** True when a value mentions a number, or a capitalised name (not just its first
 *  word), that does not appear in the item's own text. */
export function unsupported(value: string, source: string): boolean {
  const hay = source.toLowerCase();
  for (const n of value.match(NUMBER) ?? []) {
    if (!hay.includes(n.replace(/[.,]+$/, "").toLowerCase())) return true;
  }
  const rest = value.replace(/^\S+\s*/, ""); // the first word is capitalised by grammar
  for (const w of rest.match(NAME) ?? []) {
    if (!hay.includes(w.toLowerCase())) return true;
  }
  return false;
}

/** The model's reply -> the type's three facts (blank where unsupported). */
export function parseSuggestedFacts(type: ShowcaseType, content: string, source: string): KeyFact[] {
  let list: unknown[] = [];
  try {
    const cleaned = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const obj = JSON.parse(cleaned) as { facts?: unknown };
    if (Array.isArray(obj?.facts)) list = obj.facts;
  } catch {
    /* an unreadable reply gives three blanks */
  }
  const values = [0, 1, 2].map((i) => {
    const raw = typeof list[i] === "string" ? (list[i] as string) : "";
    const fitted = fitFact(raw);
    return fitted && !unsupported(fitted, source) ? fitted : "";
  });
  return defaultKeyFacts(type, values);
}
