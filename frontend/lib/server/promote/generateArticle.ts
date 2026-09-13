// lib/server/promote/generateArticle.ts — Groq-powered article + LinkedIn
// post generation.
//
// Step 2 of the "Promote" flow: takes the PaperMetadata that fetchPaper.ts
// resolves and produces, in ONE Groq call (structured JSON, same convention
// as generateExtras.ts: a raw fetch() to the Groq chat-completions endpoint
// via groqCall.ts, tolerant JSON parsing of the response):
//   - the article — a headline, a short standfirst, and a few plain-prose
//     sections, for the shareable page at /promote/[slug]
//   - the LinkedIn post that links to it — the thing this flow is actually
//     for. See LINKEDIN_POST_RULES below for its shape.
//
// The article is plain editorial prose: no hype, no hashtags, no "Excited to
// share…" energy, no closing credit line, third person throughout. The post
// is the opposite register on purpose — hook, contrast, concrete specifics,
// an explicit ask — because a summary doesn't travel and a post does.
//
// generatePromoArticle THROWS on failure (missing key -> ServerConfigError,
// Groq upstream/parse/shape failure -> Error) so the thin route can map it
// via errorResponse, exactly like generatePromoPosts did before it.

import type { PaperMetadata } from "@/lib/server/promote/fetchPaper";
import { groqComplete } from "./groqCall";
import { ServerConfigError } from "@/lib/server/supabaseServer";

export type ArticleDraft = {
  headline: string;
  standfirst: string;
  /** Plain-prose body, formatted as "## Section heading" lines separating
   *  paragraphs — a lightweight markdown the article page and the edit
   *  textarea both understand, without pulling in a markdown renderer for
   *  three fixed section headings. */
  articleBody: string;
  /** The LinkedIn post. Carries a literal "{{ARTICLE_LINK}}" placeholder
   *  where the article's URL goes — substituted at copy time (see
   *  ShareButtons.tsx) rather than baked in here, since the URL isn't known
   *  as a real, reachable page until the draft this generates has actually
   *  been created (see showcase.ts:createArticleEntry). */
  linkedinPost: string;
};

// The three sections every article is built from, in this fixed order. Fixed
// in code (not left to the model to name/order) so the article always reads
// the same shape regardless of paper.
const SECTION_HEADINGS = ["What we found", "Why it matters", "What comes next"] as const;

// ── Abstract clean-up ─────────────────────────────────────────────────────────
//
// PubMed's efetch (retmode=text, the Crossref-fallback path in fetchPaper) returns
// the whole MEDLINE record — a numbered journal citation, the title, the author
// list and an "Author information:" affiliation block BEFORE the abstract, plus a
// "DOI:/PMID:" footer after it — which fetchPaper flattens into one line. Strip
// that scaffolding so only the scientific abstract reaches Groq. Conservative: it
// only fires when the MEDLINE citation signature is present, so a clean bioRxiv
// (primary case) or Crossref abstract passes through untouched.
//
// (Kept here, not duplicated, so generateExtras.ts — which needs the exact
// same cleanup — can import it from this module.)
export function stripAbstractScaffolding(abstract: string): string {
  let s = abstract.trim();

  const looksLikeMedline =
    /^\s*\d+\.\s+\S.*?\bdoi:\s*10\./i.test(s) ||
    /Author information:/i.test(s) ||
    /\bPMID:\s*\d+/i.test(s);
  if (!looksLikeMedline) return s;

  // 1. Footer: from the trailing UPPERCASE "DOI:/PMID:/PMCID:" marker to the end.
  //    Case-SENSITIVE on purpose — the leading citation's lowercase "doi:" must
  //    NOT match here (matching it would delete the entire abstract body).
  s = s.replace(/\s*\b(?:DOI|PMID|PMCID):\s[\s\S]*$/, "");
  s = s.replace(/\s*(?:©|Copyright\s|Conflict of interest|This article is protected)[\s\S]*$/i, "");

  // 2. Leading numbered journal citation up to and incl. its DOI (+ optional Epub):
  //    "1. Nature. 2013 Aug 1;500(7460):54-8. doi: 10.1038/nature12373. "
  s = s.replace(/^\s*\d+\.\s+.*?\bdoi:\s*10\.\S+?\.\s*(?:Epub[^.]*\.\s*)?/i, "");

  // 3. "Comment in/on … doi: 10.x." cross-reference blocks that sit between the
  //    author block and the abstract.
  s = s.replace(/\bComment (?:in|on)\b[\s\S]*?\bdoi:\s*10\.\S+\.\s*/gi, "");

  // 4. Title + authors + "Author information:" affiliation list, up to the first
  //    long abstract sentence. Affiliations start with "(n)", so the lookahead
  //    naturally skips their boundaries and stops at the abstract prose (a capital
  //    letter beginning a 40+ char sentence).
  if (/Author information:/i.test(s)) {
    s = s.replace(/^[\s\S]*?Author information:\s*[\s\S]*?\.\s+(?=[A-Z][^.]{40,})/i, "");
  }

  return s.replace(/\s+/g, " ").trim();
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are helping a researcher share their own paper. You produce TWO things as valid JSON: an ARTICLE (plain editorial prose, for a hosted page) and a LINKEDIN POST (the thing that actually gets read and shared — the article is just the page it links to).

You will be given ONE paper's metadata (title, authors, journal, published date, abstract).

HARD RULES (these override everything else, for both the article and the post):
1. Use ONLY facts present in the provided metadata (title, authors, journal, abstract). NEVER invent statistics, percentages, quotes, funding, institutions, or claims that are not in the abstract. If a number or claim isn't in the text, do not state it.
2. Do NOT overstate. If the abstract hedges — e.g. "computational nomination", "hypothesis-generating", "requires experimental validation", "modest", "not statistically significant", "preliminary", "preprint" — both the article and the post MUST preserve that honesty. Never upgrade a computational prediction or preprint into a proven result or a clinical breakthrough.
3. The abstract text may contain leftover journal-citation or author-affiliation metadata. IGNORE any such non-scientific scaffolding; base everything only on the actual scientific findings.

── ARTICLE ──
Plain editorial prose, NOT marketing copy: no hype, no hashtags, no "Excited to share", no calls to action, no invented urgency. Write in the third person about the researchers ("The team found…", "The authors report…") — this page is read by strangers, not the authors' own network.

STRUCTURE (always exactly these three sections, in this order):
- "whatWeFound": What the work actually found. Explain the finding and, briefly, how the researchers got there. 2-4 short paragraphs.
- "whyItMatters": Why this finding matters — the real-world or scientific significance, stated at the level of confidence the abstract itself supports. 1-3 short paragraphs.
- "whatComesNext": What comes next — the open questions, the validation still needed, or the direction the authors point to. If the abstract doesn't say, keep this brief and honest about that rather than inventing a roadmap. 1-2 short paragraphs.

FORMAT:
- "headline": one clear, specific, non-clickbait headline stating the actual finding (not a question, not "Scientists discover...").
- "standfirst": one or two plain sentences summarizing the article, the kind that would appear under a headline before the body — written for someone who may read nothing else.
- "whatWeFound", "whyItMatters", "whatComesNext": plain prose paragraphs, each paragraph separated by a blank line (a real double newline). No bullet points, no markdown, no headers inside these strings — the section heading is added separately.

── LINKEDIN POST ──
First person, from the authors' own point of view ("We found…", "I'm sharing…") — the opposite register from the article. This is what a researcher's network actually reads; the article is only the page it links to. It must be SCANNABLE — short lines, white space, one idea at a time — not a compressed abstract with line breaks added. Build it from EXACTLY these blocks, IN THIS ORDER, with a BLANK LINE between every single block (including between consecutive bullets and the block before/after them — nothing may run on from the block before it):

1. THE OPENING LINE — the single most important line in the whole post. It must stand completely alone (nothing else may follow it on the same line, and it must make sense with zero other context) and lead with THE FINDING ITSELF or the problem it solves, in plain language — e.g. "We can now predict which KRAS-mutant tumors will respond to X before treatment starts." NEVER open with the paper's title, the compound/gene name plus paper type restated ("New paper on KRAS-mutant NSCLC" is exactly what NOT to write), or any preamble ("Excited to share", "Thrilled to announce", "Check out our new paper"). LinkedIn truncates everything after roughly two lines behind "see more" — this line is what decides whether anyone clicks that.
2. A contrast line: what researchers had to do before this work, versus what they can do because of it.
3. Three to five bullets, each ONE idea, roughly 6-12 words long — a fragment, not a sentence with clauses. If a finding needs more than about 12 words, split it into two separate bullets rather than writing one long one. Each bullet is its own line, starting with "◆ " (a diamond, not a hyphen — a hyphen reads as a code diff, not a post). Each bullet must be a concrete specific — an actual finding with its real number from the abstract, or a concrete detail a reader could act on — never a bullet that just restates the headline in other words; a summary doesn't travel, a specific does.
4. THE HUMILITY LINE — its own block, before the ask, REQUIRED (not optional) whenever the source is a preprint, a computational/in-silico/predicted result, or preclinical/early-stage work (anything not yet a validated clinical result) — say so in plain language ("This is preclinical/computational work — it hasn't been tested in patients yet" or equivalent for what the abstract actually supports). This is not a nicety: opening with "we can now inhibit…" or similar and never noting the work is preclinical overstates the claim to a research audience, and overstating costs credibility rather than earning reach. Only skip this block if the paper is a validated, non-preliminary result with nothing to hedge — never invent hedging that isn't there, but never drop a hedge the abstract actually supports either.
5. An explicit ask, in the shape "I'd appreciate feedback from researchers working in X, Y and Z" — derive X/Y/Z from the actual subfields this paper's abstract and journal touch, never a generic "the community" or "researchers everywhere".
6. The literal text "{{ARTICLE_LINK}}" on its own line — a placeholder, not a real URL; do not invent one.
7. One line of 8-12 space-separated hashtags, ORDERED MOST SPECIFIC FIRST — lead with the narrow tags that actually reach the right readers (the specific target, gene, or method named in the abstract, e.g. #KRASG12C), and put broad category tags (#DrugDiscovery, #Oncology) last. Never lead with a broad tag.

CHARACTERS: plain ASCII only for punctuation. A plain hyphen-minus "-" (U+002D), never a non-breaking hyphen, en dash, or em dash, including inside compound terms like "KRAS-mutant" — those paste incorrectly into LinkedIn's editor. Bullets use "◆", not "-", "*", or "•".

Return this as a single string field "linkedinPost" with real newlines (a blank line between every block listed above, matching what LinkedIn itself renders) — not JSON-escaped literal "\\n" text describing newlines, actual line breaks in the string value.

Return ONLY valid JSON, no markdown, no commentary, in EXACTLY this shape:
{
  "headline": "…",
  "standfirst": "…",
  "whatWeFound": "…",
  "whyItMatters": "…",
  "whatComesNext": "…",
  "linkedinPost": "…"
}`;

function buildUserMessage(paper: PaperMetadata): string {
  const authors = paper.authors.length ? paper.authors.join(", ") : "Not provided";
  const abstract = paper.abstract
    ? stripAbstractScaffolding(paper.abstract)
    : "No abstract available — write conservatively from the title and authors ONLY, and do not fabricate findings.";

  return `Generate the article for this paper:

Title: ${paper.title}
Authors: ${authors}
Journal: ${paper.journal ?? "Not provided (may be an unpublished preprint)"}
Published: ${paper.publishedDate ?? "Not provided"}

Abstract:
${abstract}

Return only the JSON object described in the system prompt.`;
}

// ── Parsing / sanitizing ──────────────────────────────────────────────────────

// Tolerant parse of the model output into an object (matches generateExtras.ts):
// strip markdown fences, fall back to the first {...} block. Returns null on
// failure.
function parseJson(content: string): Record<string, unknown> | null {
  const cleaned = content.replace(/```(?:json)?/gi, "").trim();
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const direct = tryParse(cleaned);
  if (direct) return direct;
  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? tryParse(match[0]) : null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// Groq models (this one included) sometimes emit a non-breaking hyphen
// (U+2011, visually identical to a plain "-" but a different code point) in
// compound terms like "KRAS‑mutant" — invisible in a chat UI, but it pastes
// oddly into other editors (including LinkedIn's) and doesn't match a plain
// "-" on search/copy. The prompt already asks for plain ASCII punctuation;
// this is the belt-and-suspenders normalization for when the model doesn't
// listen. Also folds the en/em dash a model might use for the same compound
// terms down to the same plain hyphen, and non-breaking spaces to normal
// ones (another Groq/unicode-punctuation habit) — never applied to the
// "◆ " bullet marker itself, which isn't touched by any of these patterns.
function normalizeUnicodePunctuation(s: string): string {
  return s
    .replace(/[\u2010-\u2015]/g, "-") // hyphen, non-breaking hyphen, figure/en/em dash, horizontal bar
    .replace(/\u00A0/g, " "); // non-breaking space
}

// ── Groq call ─────────────────────────────────────────────────────────────────

// Generate the article for one paper. Throws on any failure so the route
// maps it via errorResponse (ServerConfigError -> 500 misconfig, Error -> 500).
export async function generatePromoArticle(paper: PaperMetadata): Promise<ArticleDraft> {
  if (!paper || !paper.title?.trim()) {
    throw new Error("A paper title is required to generate an article.");
  }

  // One call, with a single retry on rate limiting (see groqCall.ts).
  const content = await groqComplete({
    system: SYSTEM_PROMPT,
    user: buildUserMessage(paper),
    maxTokens: 3072,
    label: "generate-article",
  });

  const parsed = parseJson(content);

  const headline = normalizeUnicodePunctuation(asString(parsed?.headline));
  const standfirst = normalizeUnicodePunctuation(asString(parsed?.standfirst));
  const whatWeFound = normalizeUnicodePunctuation(asString(parsed?.whatWeFound));
  const whyItMatters = normalizeUnicodePunctuation(asString(parsed?.whyItMatters));
  const whatComesNext = normalizeUnicodePunctuation(asString(parsed?.whatComesNext));
  const linkedinPost = normalizeUnicodePunctuation(asString(parsed?.linkedinPost));

  // Every field is required — a missing one means the generation didn't hold
  // up (matches generatePromoPosts's discipline: fail rather than ship a gap).
  if (!headline || !standfirst || !whatWeFound || !whyItMatters || !whatComesNext || !linkedinPost) {
    console.error("Missing/empty article field in Groq response:", content);
    throw new Error("AI response was incomplete. Please try again.");
  }

  const sections = [whatWeFound, whyItMatters, whatComesNext];
  const articleBody = SECTION_HEADINGS.map((h, i) => `## ${h}\n\n${sections[i]}`).join("\n\n");

  return { headline, standfirst, articleBody, linkedinPost };
}
