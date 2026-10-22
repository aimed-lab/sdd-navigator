// lib/server/promote/suggestKeyFacts.ts — asks the existing LLM helper (Groq, via
// groqCall.ts) to fill an item's three key facts from its own headline,
// standfirst and body. The prompt and the checks on the answer are in
// keyFactsSuggest.ts. Returns blanks, never throws, when the text is too thin;
// throws only for a service problem (rate limit / not configured).

import { groqComplete } from "./groqCall";
import {
  SUGGEST_SYSTEM,
  buildSuggestMessage,
  parseSuggestedFacts,
} from "./keyFactsSuggest";
import { defaultKeyFacts, type KeyFact, type ShowcaseType } from "./showcaseKinds";

export async function suggestKeyFacts(
  type: ShowcaseType,
  headline: string,
  standfirst: string,
  body: string
): Promise<KeyFact[]> {
  if (!`${headline}${standfirst}${body}`.trim()) return defaultKeyFacts(type);
  const content = await groqComplete({
    system: SUGGEST_SYSTEM,
    user: buildSuggestMessage(type, headline, standfirst, body),
    maxTokens: 600,
    temperature: 0.2,
    label: "suggest-key-facts",
  });
  return parseSuggestedFacts(type, content, `${headline}\n${standfirst}\n${body}`);
}

/** The same, for the generate routes: a failure just means no facts yet (the
 *  author can press "Suggest key facts" later). */
export async function suggestKeyFactsOrBlank(
  type: ShowcaseType,
  headline: string,
  standfirst: string,
  body: string
): Promise<KeyFact[]> {
  try {
    return await suggestKeyFacts(type, headline, standfirst, body);
  } catch (e) {
    console.error("suggestKeyFacts failed; leaving the key facts blank", e);
    return defaultKeyFacts(type);
  }
}
