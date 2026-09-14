// lib/server/promote/generateStructuredArticle.ts — Groq-powered article +
// post generation for every NON-PAPER type (talk/poster/award/tool/event/
// other), from five short answers instead of fetched metadata.
//
// WHY FIVE ANSWERS, NOT A FETCH: the model post that worked was hand-written
// — its shape, not its source data, is what made it travel. A GitHub URL
// fetch (still available as an OPTIONAL prefill, see fetchRepo.ts and
// SubmitFlow.tsx's own GitHub-prefill section) can hand back a description
// and a README, but it cannot hand back "three to five specific things in
// the person's own words" — that's the one element a summary can't
// manufacture, and it's exactly what STRUCTURED_QUESTIONS asks for directly
// instead of trying to extract it. See lib/showcaseTypes.ts's own header.
//
// THE BULLETS AND THE ASK LINE ARE ASSEMBLED IN CODE, NOT BY THE MODEL.
// The first version of this file asked Groq to assemble the whole LinkedIn
// post, including deciding what became a bullet — and it didn't reliably
// hold the line: it paraphrased SPECIFICS into a paragraph, then invented
// its OWN diamond bullets from CONTEXT and AUDIENCE ("Showcased AI
// integration across funding, literature, and networking" — exactly the
// generic restatement this form exists to prevent), and pasted AUDIENCE
// into the ask with its original capitalization ("hearing from Junior
// faculty..."). A formatting RULE in a prompt is a request; a structural
// guarantee is buildBulletLines()/buildAskLine() below never asking the
// model to produce a bullet or the ask at all. The model is only ever
// asked for PROSE FRAGMENTS (opening line, contrast line, whether to hedge
// and its wording, hashtags, and the article) — never for the finished
// LinkedIn post as one string — so there is no step where it could invent,
// drop, or reorder a bullet, or get the ask's grammar wrong.
//
// ONE PROMPT, NOT SIX: the five slots are the same for every type
// (oneLiner/contrast/specifics/context/audience) — only their WORDING
// differs per type in the FORM (STRUCTURED_QUESTIONS), and by the time
// someone has actually answered "what did people think before this, and
// what do they think now" for a talk, that type-specific framing is already
// baked into the text of their answer. `type` is passed here only to
// calibrate REGISTER (a talk is narrated differently than a tool launch),
// not to select a different rule set.
//
// Same JSON-mode Groq call convention as generateArticle.ts (raw fetch via
// groqCall.ts, tolerant JSON parsing — parseJson/asString/
// normalizeUnicodePunctuation are imported from there, not duplicated), and
// the same "throws on failure" contract so the route maps it via
// errorResponse.

import type { ShowcaseType, StructuredAnswers } from "@/lib/showcaseTypes";
import { groqComplete } from "./groqCall";
import { asString, normalizeUnicodePunctuation, parseJson } from "./generateArticle";

export type ArticleDraft = {
  headline: string;
  standfirst: string;
  articleBody: string;
  linkedinPost: string;
};

// Generic across every non-paper type on purpose — a talk, a tool, and an
// event all fit "what it is / why it matters / what's next" without
// straining, and one fixed set means this module doesn't need a heading
// matrix alongside its question matrix. Paper keeps its own three headings
// (generateArticle.ts) unchanged.
const SECTION_HEADINGS = ["What it is", "Why it matters", "What's next"] as const;

const TYPE_REGISTER: Record<Exclude<ShowcaseType, "paper">, string> = {
  tool: "a tool or piece of software the person built",
  talk: "a talk or conference presentation the person gave",
  poster: "a poster the person presented",
  award: "an award or milestone the person is sharing",
  event: "an event the person is announcing or ran",
  other: "something the person built or did that doesn't fit a more specific category",
};

// ── Deterministic assembly ──────────────────────────────────────────────────
// Everything below builds part of the LinkedIn post directly from the raw
// answers — no model call, no chance of the wrong thing becoming a bullet
// or the ask reading with a stray capital.

const MAX_BULLET_CHARS = 140;

/** Shorten a specific to fit one bullet WITHOUT paraphrasing it — cuts at
 *  the last word boundary before the limit and appends an ellipsis, same
 *  idea as a CSS line-clamp: less of the author's own words, never a
 *  different, shorter sentence describing them. Only ever called when the
 *  line is already over the limit. */
function trimToWordBoundary(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > max * 0.4 ? cut.slice(0, lastSpace) : cut;
  return trimmed.trimEnd() + "…";
}

/** One "◆ " bullet per SPECIFICS line, in the order they were entered — no
 *  more, no fewer, never sourced from CONTEXT/AUDIENCE/anything else. This
 *  is the fix for "the specifics answer must become the diamond bullets,
 *  one bullet per line, in the author's own words. Nothing else may become
 *  a bullet." */
function buildBulletLines(specifics: string[]): string[] {
  return specifics.map((s) => `◆ ${trimToWordBoundary(s, MAX_BULLET_CHARS)}`);
}

/** True if the first word is either already lowercase or reads as an
 *  acronym/proper noun that would look wrong lowercased ("PhD", "NIH",
 *  "AI") — left untouched in either case. Otherwise the leading capital is
 *  lowered so AUDIENCE reads as the tail of a sentence ("hearing from
 *  junior faculty...") instead of a pasted fragment ("hearing from Junior
 *  faculty..."). */
function lowerFirstLetter(s: string): string {
  const t = s.trim();
  if (!t) return t;
  if (/^[a-z]/.test(t)) return t;
  if (/^[A-Z]{2,}/.test(t)) return t; // an acronym leading the sentence
  return t[0].toLowerCase() + t.slice(1);
}

/** Tags describing the FORMAT or PLATFORM something happened on/through,
 *  not the field, method, or institution it's about — "#Zoom" or
 *  "#Collaboration" reach nobody searching by research area; they describe
 *  how people met, not what the work is. Matched on the bare word so
 *  "#Zoom"/"zoom"/"#ZOOM" all hit regardless of the model's casing. Not
 *  exhaustive — a prompt-side rule (see HASHTAG rule above) is the first
 *  line of defense; this is the belt-and-suspenders backstop for the
 *  handful of platform/format words that show up often enough to be worth
 *  hardcoding, same reasoning as ensureHashtagPrefixes below. */
const HASHTAG_DENYLIST = new Set([
  "zoom", "webinar", "virtual", "online", "inperson", "hybrid",
  "livestream", "recording", "teams", "googlemeet", "slack",
  "meeting", "networking", "collaboration", "conference", "event",
  "talk", "presentation", "workshop", "seminar",
]);

/** Belt-and-suspenders for the two things left to the model on this one
 *  line: the prompt asks for a leading "#" on every token and asks it to
 *  never include a format/platform tag, but a prompt instruction is a
 *  request, not a guarantee (see this file's own header on why bullets/
 *  the ask moved out of model control entirely). This adds a missing "#"
 *  rather than shipping a bare word to LinkedIn (unclickable, wrong
 *  register) and drops anything on HASHTAG_DENYLIST outright — the line
 *  simply ends up shorter than 8-12 tags if several get filtered, which is
 *  fine; a short, on-topic line beats a padded, off-topic one. */
function sanitizeHashtags(line: string): string {
  return line
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => (tok.startsWith("#") ? tok : `#${tok}`))
    .filter((tok) => !HASHTAG_DENYLIST.has(tok.slice(1).toLowerCase()))
    .join(" ");
}

/** "I'd appreciate hearing from <audience>." — AUDIENCE joined with correct
 *  grammar (see lowerFirstLetter) and exactly one trailing period, never
 *  widened into a generic "the community" and never reworded by a model
 *  that might not hold the line on naming it verbatim. */
function buildAskLine(audience: string): string {
  const body = lowerFirstLetter(audience.trim()).replace(/[.!?]+$/, "");
  return `I'd appreciate hearing from ${body}.`;
}

const SYSTEM_PROMPT = `You are helping someone share {{REGISTER}}. You produce valid JSON with an ARTICLE (plain editorial prose, for a hosted page) and a few FRAGMENTS of a LinkedIn post — NOT the whole post. The bullets and the closing ask are assembled separately, by code, directly from the person's own answers; you never write them and must not include anything that looks like a bulleted list or an ask sentence in any field below.

You will be given FIVE short answers the person wrote themselves, in this order:
1. ONE_LINER — what it is, in one line.
2. CONTRAST — the before/now contrast (or, for some types, why it matters now).
3. SPECIFICS — three to five specific things, EACH IN THE PERSON'S OWN WORDS. These are NOT yours to use in the post fragments below — they become the post's bullets separately, verbatim. Use them only as background for the ARTICLE.
4. CONTEXT — stage, venue, or date, depending on what this is.
5. AUDIENCE — who they want to hear from. NOT yours to phrase into an ask — that is assembled separately, verbatim. Use it only as background for the ARTICLE.

HARD RULES (these override everything else):
1. Use ONLY what the five answers actually say. NEVER invent a feature, a command, a number, a venue, a date, or a claim that isn't in one of the five answers.
2. Do NOT write bullets, a bulleted list, or anything starting with "◆", "-", or "*" in openingLine, contrastLine, or hedgeLine. Those three fields are each ONE plain sentence or fragment, nothing else.
3. Do NOT write an ask sentence ("I'd appreciate...", "Feedback from...", "reach out if...") anywhere — the ask is assembled separately from AUDIENCE.
4. Judge whether hedgeLine is needed from CONTEXT alone. If CONTEXT reads as early, a prototype, a first attempt, not yet validated, or a first time doing something, hedgeLine MUST plainly say so (e.g. "This is early — I'd genuinely like to hear what breaks"). If CONTEXT reads as established, already delivered multiple times, published, or validated, return hedgeLine as an empty string "" — do not invent a hedge that isn't warranted.

── ARTICLE ──
Plain editorial prose describing what this actually is: what it is, why it matters, what's next. No hype, no hashtags, no "Excited to share", no invented urgency. This is the one place SPECIFICS may inform the prose (used as supporting detail, not restated as a list).

STRUCTURE (always exactly these three sections, in this order):
- "whatItIs": What this is, built from ONE_LINER and CONTEXT. 1-2 short paragraphs.
- "whyItMatters": Why it matters, built from CONTRAST and, if relevant, SPECIFICS. 1-3 short paragraphs.
- "whatsNext": What's next or how someone would engage with it, built from CONTEXT and AUDIENCE — if there's genuinely nothing to say here beyond what's already covered, keep this brief and honest rather than padding it. 1-2 short paragraphs.

FORMAT:
- "headline": one clear, specific headline stating what this actually is — not a question, not "Introducing...", not a restatement of a generic category name.
- "standfirst": one or two plain sentences under the headline, for someone who may read nothing else.
- "whatItIs"/"whyItMatters"/"whatsNext": plain prose paragraphs, each paragraph separated by a blank line (a real double newline). No bullet points, no markdown, no headers inside these strings — the section heading is added separately.

── LINKEDIN POST FRAGMENTS ──
First person, from the person's own point of view.
- "openingLine": the single most important line in the whole post, built from ONE_LINER alone: one line stating what this is, in plain language. It must stand completely alone and make sense with zero other context. Never open with a category label restated ("New tool!", "Check out my talk") or any preamble ("Excited to share", "Thrilled to announce"). Never mention CONTEXT here unless ONE_LINER itself needs it to make sense.
- "contrastLine": built from CONTRAST alone, tightened for length but not reworded away from what was actually written. May reference CONTEXT if CONTRAST doesn't make sense without it (e.g. a venue), but do not turn this into a second opening line.
- "hedgeLine": see HARD RULE 4 — either one honest sentence built from CONTEXT, or "".
- "hashtags": one line of 8-12 space-separated hashtags, EACH ONE STARTING WITH "#" (e.g. "#DrugDiscovery #AI", never "DrugDiscovery AI" with the "#" left off), ORDERED MOST SPECIFIC FIRST. Draw them from the RESEARCH AREA, the METHOD, and the INSTITUTION named in ONE_LINER/CONTEXT/AUDIENCE only. NEVER a tag describing the FORMAT or PLATFORM this happened on or through — no "#Zoom", "#Webinar", "#Virtual", "#Conference", "#Networking", "#Collaboration", or similar: those describe how people met, not what the work is about, and reach nobody searching by field.

CHARACTERS: plain ASCII only for punctuation. A plain hyphen-minus "-" (U+002D), never a non-breaking hyphen, en dash, or em dash.

Return ONLY valid JSON, no markdown, no commentary, in EXACTLY this shape:
{
  "headline": "…",
  "standfirst": "…",
  "whatItIs": "…",
  "whyItMatters": "…",
  "whatsNext": "…",
  "openingLine": "…",
  "contrastLine": "…",
  "hedgeLine": "…",
  "hashtags": "…"
}`;

function buildUserMessage(answers: StructuredAnswers): string {
  const specifics = answers.specifics.map((s, i) => `${i + 1}. ${s}`).join("\n");

  return `ONE_LINER: ${answers.oneLiner.trim()}

CONTRAST: ${answers.contrast.trim()}

SPECIFICS (background for the article only — do not restate these as your own bullets or list):
${specifics}

CONTEXT: ${answers.context.trim()}

AUDIENCE: ${answers.audience.trim()}

Return only the JSON object described in the system prompt.`;
}

// Generate the article for one structured submission. Throws on any failure
// so the route maps it via errorResponse, same contract as
// generatePromoArticle.
export async function generateStructuredArticle(
  type: Exclude<ShowcaseType, "paper">,
  answers: StructuredAnswers
): Promise<ArticleDraft> {
  const specifics = answers.specifics.map((s) => s.trim()).filter(Boolean);
  if (!answers.oneLiner.trim() || specifics.length < 3) {
    throw new Error("Answer at least the one-liner and three specifics to generate a post.");
  }

  const system = SYSTEM_PROMPT.replace("{{REGISTER}}", TYPE_REGISTER[type]);

  const content = await groqComplete({
    system,
    user: buildUserMessage({ ...answers, specifics }),
    maxTokens: 3072,
    label: "generate-structured-article",
  });

  const parsed = parseJson(content);

  const headline = normalizeUnicodePunctuation(asString(parsed?.headline));
  const standfirst = normalizeUnicodePunctuation(asString(parsed?.standfirst));
  const whatItIs = normalizeUnicodePunctuation(asString(parsed?.whatItIs));
  const whyItMatters = normalizeUnicodePunctuation(asString(parsed?.whyItMatters));
  const whatsNext = normalizeUnicodePunctuation(asString(parsed?.whatsNext));
  const openingLine = normalizeUnicodePunctuation(asString(parsed?.openingLine));
  const contrastLine = normalizeUnicodePunctuation(asString(parsed?.contrastLine));
  // hedgeLine is allowed to be genuinely empty (no hedge warranted) — only
  // the OTHER fields are required below.
  const hedgeLine = normalizeUnicodePunctuation(asString(parsed?.hedgeLine));
  const hashtags = normalizeUnicodePunctuation(asString(parsed?.hashtags));

  // Every field except hedgeLine is required — same discipline as
  // generatePromoArticle: fail rather than ship a gap.
  if (!headline || !standfirst || !whatItIs || !whyItMatters || !whatsNext || !openingLine || !contrastLine || !hashtags) {
    console.error("Missing/empty article field in Groq response (structured path):", content);
    throw new Error("AI response was incomplete. Please try again.");
  }

  const sections = [whatItIs, whyItMatters, whatsNext];
  const articleBody = SECTION_HEADINGS.map((h, i) => `## ${h}\n\n${sections[i]}`).join("\n\n");

  // The LinkedIn post itself: model-written fragments for openingLine/
  // contrastLine/hedgeLine/hashtags, everything else assembled here from
  // the raw answers — see this file's own header on why. hedgeLine is
  // filtered out (not just left empty) so an absent hedge doesn't leave a
  // stray blank block in the middle of the post.
  const blocks = [
    openingLine,
    contrastLine,
    // Consecutive lines, NO blank line between bullets — they're one
    // block, not five. Blank lines only ever separate BLOCKS (see the
    // .join("\n\n") below), never lines within one.
    buildBulletLines(specifics).join("\n"),
    hedgeLine || null,
    buildAskLine(answers.audience),
    "{{ARTICLE_LINK}}",
    sanitizeHashtags(hashtags),
  ].filter((b): b is string => Boolean(b && b.trim()));

  const linkedinPost = blocks.join("\n\n");

  return { headline, standfirst, articleBody, linkedinPost };
}
