// lib/server/promote/generatePosts.ts — Groq-powered LinkedIn post generation.
//
// Step 2 of the "Promote" feature. Takes the PaperMetadata that fetchPaper.ts
// resolves and produces FOUR distinct LinkedIn post variants in ONE Groq call
// (structured JSON — not four round-trips). Matches the existing Groq convention
// used by lib/server/extractInterests.ts and lib/server/proposal/engine.ts: a
// raw fetch() to the Groq chat-completions endpoint, model llama-3.3-70b-versatile,
// the GROQ_API_KEY env var, and tolerant JSON parsing of the response.
//
// generatePromoPosts THROWS on failure (missing key → ServerConfigError, Groq
// upstream/parse failure → Error) so the thin route can map it via errorResponse.

import type { PaperMetadata } from "@/lib/server/promote/fetchPaper";
import { groqComplete } from "./groqCall";
import { ServerConfigError } from "@/lib/server/supabaseServer";

export type PromoVariant = {
  tone: "plain-impact" | "peer-technical" | "narrative" | "milestone";
  hook: string;
  body: string;
  hashtags: string[];
  closingTag: string;
};

export type GeneratePostsResult = { variants: PromoVariant[] };

// Canonical tone order — the output is always returned in this order.
const TONES: PromoVariant["tone"][] = ["plain-impact", "peer-technical", "narrative", "milestone"];

const CREDIBILITY_HOST = "smartdrugdiscovery.org";

// ── Abstract clean-up ─────────────────────────────────────────────────────────
//
// PubMed's efetch (retmode=text, the Crossref-fallback path in fetchPaper) returns
// the whole MEDLINE record — a numbered journal citation, the title, the author
// list and an "Author information:" affiliation block BEFORE the abstract, plus a
// "DOI:/PMID:" footer after it — which fetchPaper flattens into one line. Strip
// that scaffolding so only the scientific abstract reaches Groq. Conservative: it
// only fires when the MEDLINE citation signature is present, so a clean bioRxiv
// (primary case) or Crossref abstract passes through untouched.
export function stripAbstractScaffolding(abstract: string): string {
  let s = abstract.trim();

  // Only act when the MEDLINE citation signature is present, so a clean bioRxiv
  // (primary case) or Crossref abstract passes through completely untouched.
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

const SYSTEM_PROMPT = `You are a scientific communications specialist who writes LinkedIn posts that researchers use to announce their own papers. You write the way real scientists post on LinkedIn — credible, specific, and never clickbait.

You will be given ONE paper's metadata (title, authors, abstract, link). Produce EXACTLY 4 post variants, each a different tone, as valid JSON.

HARD RULES (these override everything else):
1. Use ONLY facts present in the provided metadata (title, authors, abstract). NEVER invent statistics, percentages, quotes, funding, institutions, or claims that are not in the abstract. If a number or claim isn't in the text, do not state it.
2. Do NOT overstate. If the abstract hedges — e.g. "computational nomination", "hypothesis-generating", "requires experimental validation", "modest", "not statistically significant", "preliminary", "preprint" — the posts MUST preserve that honesty. Never upgrade a computational prediction or preprint into a proven result or a clinical breakthrough.
3. Every variant's "body" MUST include the paper's exact link (the sourceUrl provided) written inline so it reads naturally as part of the post — not as a bare footnote.
4. Reference the paper's real co-authors by name where it fits naturally — especially in the "narrative" and "milestone" variants (e.g. "Grateful to work with <name>…" / "with <names>"). Only use names from the provided author list.
5. The abstract text may contain leftover journal-citation or author-affiliation metadata. IGNORE any such non-scientific scaffolding; base the posts only on the actual scientific findings.

THE 4 TONES:
- "plain-impact": Lead with the real-world why-this-matters in ONE plain-English sentence, zero jargon, accessible to any professional. Use short bullet points. Explain significance, not mechanism.
- "peer-technical": Lead with the actual finding or mechanism. KEEP field-specific vocabulary intact (this audience respects precision, not hype). Accurate, dense, no dumbing-down.
- "narrative": First-person research-journey framing ("We set out to understand…"). Personal and human, show the motivation and the arc. Tag co-authors naturally.
- "milestone": The SHORTEST and punchiest. "Excited to share…" energy, built for fast scanning and reshares, not explanation. A couple of tight lines, co-authors tagged.

FORMAT for every variant:
- "hook": one attention-grabbing opening line.
- "body": the main post text, 2-4 SHORT paragraphs or bullets (LinkedIn posts get skimmed — never a wall of text). Must contain the sourceUrl inline.
- "hashtags": 3-5 relevant hashtags, mixing general and field-specific (e.g. "#DrugDiscovery", "#PancreaticCancer", "#KRAS"). Each begins with "#".
(Do NOT write any closing/credit line — that is appended by the system, not you.)

Return ONLY valid JSON, no markdown, no commentary, in EXACTLY this shape:
{
  "variants": [
    { "tone": "plain-impact", "hook": "…", "body": "…", "hashtags": ["#…"] },
    { "tone": "peer-technical", "hook": "…", "body": "…", "hashtags": ["#…"] },
    { "tone": "narrative", "hook": "…", "body": "…", "hashtags": ["#…"] },
    { "tone": "milestone", "hook": "…", "body": "…", "hashtags": ["#…"] }
  ]
}`;

function buildUserMessage(paper: PaperMetadata): string {
  const authors = paper.authors.length ? paper.authors.join(", ") : "Not provided";
  const abstract = paper.abstract
    ? stripAbstractScaffolding(paper.abstract)
    : "No abstract available — write conservatively from the title and authors ONLY, and do not fabricate findings.";

  return `Generate the 4 LinkedIn post variants for this paper:

Title: ${paper.title}
Authors: ${authors}
Published: ${paper.publishedDate ?? "Not provided"}
Link (use this exact URL inline in every body): ${paper.sourceUrl}

Abstract:
${abstract}

Return only the JSON object with the 4 variants.`;
}

// ── Parsing / sanitizing ──────────────────────────────────────────────────────

// Tolerant parse of the model output into an object (matches engine.ts): strip
// markdown fences, fall back to the first {...} block. Returns null on failure.
function parseJson(content: string): Record<string, unknown> | null {
  // JSON mode returns bare JSON, but strip any stray ``` fences defensively, then
  // fall back to the first {...} block if the model wrapped it in prose.
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

// Normalize hashtags: keep strings, ensure a leading "#", drop empties/dupes, 3-5.
function sanitizeHashtags(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const tag = item.trim().replace(/\s+/g, "");
    if (!tag) continue;
    const withHash = tag.startsWith("#") ? tag : `#${tag}`;
    const key = withHash.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(withHash);
    if (out.length >= 5) break;
  }
  return out;
}

// Closing tags are FIXED per tone — never model-generated. Locking them in code
// keeps the credibility line deterministic and prevents the model from inventing
// unearned claims about the platform (e.g. "a leading platform for …").
const CLOSING_TAGS: Record<PromoVariant["tone"], string> = {
  "plain-impact": `Featured on ${CREDIBILITY_HOST}`,
  "peer-technical": `Featured on ${CREDIBILITY_HOST}`,
  narrative: `Proud to have this featured on ${CREDIBILITY_HOST}`,
  milestone: `Proud to have this featured on ${CREDIBILITY_HOST}`,
};

// ── Groq call ─────────────────────────────────────────────────────────────────

// Generate the 4 tone variants for one paper. Throws on any failure so the route
// maps it via errorResponse (ServerConfigError → 500 misconfig, Error → 500).
export async function generatePromoPosts(paper: PaperMetadata): Promise<PromoVariant[]> {
  if (!paper || !paper.title?.trim()) {
    throw new Error("A paper title is required to generate posts.");
  }

  // One call, with a single retry on rate limiting (see groqCall.ts).
  const content = await groqComplete({
    system: SYSTEM_PROMPT,
    user: buildUserMessage(paper),
    maxTokens: 4096,
    label: "generate-posts",
  });

  const parsed = parseJson(content);

  const rawVariants =
    parsed && Array.isArray(parsed.variants)
      ? (parsed.variants as Record<string, unknown>[])
      : Array.isArray(parsed)
        ? (parsed as unknown as Record<string, unknown>[])
        : null;

  if (!rawVariants) {
    console.error("Failed to parse promo posts from Groq response:", content);
    throw new Error("Failed to parse AI response. Please try again.");
  }

  // Index the model's variants by tone, then emit in canonical order so the
  // output is always the 4 expected tones in a stable sequence.
  const byTone = new Map<string, Record<string, unknown>>();
  for (const v of rawVariants) {
    const tone = asString(v?.tone).toLowerCase();
    if (tone) byTone.set(tone, v);
  }

  const variants: PromoVariant[] = [];
  for (const tone of TONES) {
    const v = byTone.get(tone);
    const hook = asString(v?.hook);
    const body = asString(v?.body);
    // A variant is only usable with both a hook and a body; a missing tone or an
    // empty one means the generation didn't hold up — fail rather than ship a gap.
    if (!v || !hook || !body) {
      console.error(`Missing/empty variant for tone "${tone}" in Groq response:`, content);
      throw new Error("AI response was incomplete. Please try again.");
    }
    variants.push({
      tone,
      hook,
      body,
      hashtags: sanitizeHashtags(v.hashtags),
      closingTag: CLOSING_TAGS[tone], // fixed per tone; never model-generated
    });
  }

  return variants;
}
