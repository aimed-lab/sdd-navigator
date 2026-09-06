// lib/server/promote/generateArticle.ts — Groq-powered article generation.
//
// Replaces generatePosts.ts's four LinkedIn tone variants. Step 2 of the
// "Promote" feature: takes the PaperMetadata that fetchPaper.ts resolves and
// produces ONE article draft — a headline, a short standfirst, and a few
// plain-prose sections — in ONE Groq call (structured JSON, same convention
// as generateExtras.ts: a raw fetch() to the Groq chat-completions endpoint
// via groqCall.ts, tolerant JSON parsing of the response).
//
// This is NOT marketing copy and it is NOT a LinkedIn post: no hashtags, no
// "Excited to share…" energy, no closing credit line. Plain readable prose
// for a general research audience, written for the shareable article page at
// /promote/[slug], not for pasting anywhere.
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

const SYSTEM_PROMPT = `You are a science journalist writing a short, readable article for a general research audience (a smart non-specialist — a funder, another lab, a science-interested reader). This is plain editorial prose, NOT marketing copy: no hype, no hashtags, no "Excited to share", no calls to action, no invented urgency.

You will be given ONE paper's metadata (title, authors, journal, published date, abstract). Produce ONE article as valid JSON.

HARD RULES (these override everything else):
1. Use ONLY facts present in the provided metadata (title, authors, journal, abstract). NEVER invent statistics, percentages, quotes, funding, institutions, or claims that are not in the abstract. If a number or claim isn't in the text, do not state it.
2. Do NOT overstate. If the abstract hedges — e.g. "computational nomination", "hypothesis-generating", "requires experimental validation", "modest", "not statistically significant", "preliminary", "preprint" — the article MUST preserve that honesty. Never upgrade a computational prediction or preprint into a proven result or a clinical breakthrough.
3. The abstract text may contain leftover journal-citation or author-affiliation metadata. IGNORE any such non-scientific scaffolding; base the article only on the actual scientific findings.
4. Write in the third person about the researchers ("The team found…", "The authors report…") — this article is read by strangers, not the authors' own network.

STRUCTURE (always exactly these three sections, in this order):
- "whatWeFound": What the work actually found. Explain the finding and, briefly, how the researchers got there. 2-4 short paragraphs.
- "whyItMatters": Why this finding matters — the real-world or scientific significance, stated at the level of confidence the abstract itself supports. 1-3 short paragraphs.
- "whatComesNext": What comes next — the open questions, the validation still needed, or the direction the authors point to. If the abstract doesn't say, keep this brief and honest about that rather than inventing a roadmap. 1-2 short paragraphs.

FORMAT:
- "headline": one clear, specific, non-clickbait headline stating the actual finding (not a question, not "Scientists discover...").
- "standfirst": one or two plain sentences summarizing the article, the kind that would appear under a headline before the body — written for someone who may read nothing else.
- "whatWeFound", "whyItMatters", "whatComesNext": plain prose paragraphs, each paragraph separated by a blank line (a real double newline). No bullet points, no markdown, no headers inside these strings — the section heading is added separately.

Return ONLY valid JSON, no markdown, no commentary, in EXACTLY this shape:
{
  "headline": "…",
  "standfirst": "…",
  "whatWeFound": "…",
  "whyItMatters": "…",
  "whatComesNext": "…"
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

  const headline = asString(parsed?.headline);
  const standfirst = asString(parsed?.standfirst);
  const whatWeFound = asString(parsed?.whatWeFound);
  const whyItMatters = asString(parsed?.whyItMatters);
  const whatComesNext = asString(parsed?.whatComesNext);

  // Every field is required — a missing one means the generation didn't hold
  // up (matches generatePromoPosts's discipline: fail rather than ship a gap).
  if (!headline || !standfirst || !whatWeFound || !whyItMatters || !whatComesNext) {
    console.error("Missing/empty article field in Groq response:", content);
    throw new Error("AI response was incomplete. Please try again.");
  }

  const sections = [whatWeFound, whyItMatters, whatComesNext];
  const articleBody = SECTION_HEADINGS.map((h, i) => `## ${h}\n\n${sections[i]}`).join("\n\n");

  return { headline, standfirst, articleBody };
}
