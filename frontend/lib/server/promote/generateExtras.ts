// lib/server/promote/generateExtras.ts — Groq-powered non-LinkedIn outputs.
//
// Companion to generatePosts.ts, added ALONGSIDE the 4 LinkedIn tone variants
// (it does not touch or replace them). Same one-Groq-call, structured-JSON
// (response_format: json_object) pattern, and the SAME grounding discipline:
// outputs are grounded strictly in the fetched PaperMetadata
// (title/authors/abstract/sourceUrl), preserve the abstract's hedging, never
// invent facts, and inline the real sourceUrl. Two outputs:
//   • fundingPitch — 150-200 word grant/funding-application paragraph
//   • laySummary   — 100-150 word plain-language paragraph
//
// generateExtraOutputs THROWS on failure (missing key → ServerConfigError, Groq
// upstream/parse/shape failure → Error) so the route maps it via errorResponse,
// exactly like generatePromoPosts.

import type { PaperMetadata } from "@/lib/server/promote/fetchPaper";
// Reuse the SAME abstract scaffolding stripper the tone generator uses, so both
// paths feed Groq the identical cleaned abstract. Imported (not duplicated) so
// generatePosts.ts stays untouched.
import { stripAbstractScaffolding } from "@/lib/server/promote/generatePosts";
import { ServerConfigError } from "@/lib/server/supabaseServer";

export type ExtraOutputsResult = {
  fundingPitch: string;
  laySummary: string;
};

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a scientific communications specialist. You will be given ONE paper's metadata (title, authors, abstract, link). Produce TWO text outputs from it, as valid JSON.

HARD RULES (these override everything else):
1. Use ONLY facts present in the provided metadata (title, authors, abstract). NEVER invent statistics, percentages, preliminary data, budgets, scope, funding, institutions, timelines, or any claim that is not in the abstract.
2. Do NOT overstate. If the abstract hedges — e.g. "computational nomination", "hypothesis-generating", "requires experimental validation", "modest", "not statistically significant", "preliminary", "preprint", "not yet validated" — BOTH outputs MUST preserve that honesty. Never upgrade a computational prediction or a preprint into a proven result or a clinical breakthrough.
3. Each output MUST reference the paper's exact link (the sourceUrl provided) EXACTLY ONCE, as a single natural closing reference at or near the END of the paragraph (e.g. "…their full findings are available at {sourceUrl}."). Do NOT repeat the link anywhere else, and do NOT scatter it inline at multiple points — one link, one time, per output.
4. The abstract text may contain leftover journal-citation or author-affiliation metadata. IGNORE any such non-scientific scaffolding; base the outputs only on the actual scientific findings.

THE TWO OUTPUTS:
- "fundingPitch": REQUIRED length 150-200 words, written as 9-12 full sentences — this is a hard requirement, not a suggestion. A pitch under 150 words is too short and unacceptable; one over 200 is too long. Framed as part of a grant/funding application. To reach the length HONESTLY (never padding, never inventing facts), name the SPECIFIC details from the abstract rather than staying generic, covering ALL FOUR of: (a) the clinical problem and why it matters; (b) the specific finding(s) — name the actual mechanisms/targets involved — and the specific data they were derived from; (c) the mechanistic detail that makes each finding notable and how the findings relate to each other; and (d) the specific further research the work proposes. This concreteness is what carries the pitch to 150-200 words. If a finding is computational or preliminary, present it as exactly that (e.g. a nomination or hypothesis to be validated), never as established. End with the single sourceUrl reference.
- "laySummary": REQUIRED length 100-150 words — aim for ~125 words; under 100 is too short, over 150 too long. Plain language for a NON-expert (a funding officer or a general science-interested reader). Explain what the disease is, what was found, and what it might lead to. Avoid jargon wherever possible; if a technical term is unavoidable, explain it in the SAME sentence. No hype, no invented facts, and preserve any uncertainty stated in the abstract. End with the single sourceUrl reference.

Return ONLY valid JSON, no markdown, no commentary, in EXACTLY this shape:
{
  "fundingPitch": "…",
  "laySummary": "…"
}`;

function buildUserMessage(paper: PaperMetadata): string {
  const authors = paper.authors.length ? paper.authors.join(", ") : "Not provided";
  const abstract = paper.abstract
    ? stripAbstractScaffolding(paper.abstract)
    : "No abstract available — write conservatively from the title and authors ONLY, and do not fabricate findings.";

  return `Generate the funding pitch and lay summary for this paper:

Title: ${paper.title}
Authors: ${authors}
Published: ${paper.publishedDate ?? "Not provided"}
Link (use this exact URL inline in BOTH outputs): ${paper.sourceUrl}

Abstract:
${abstract}

Return only the JSON object with fundingPitch and laySummary.`;
}

// ── Parsing (mirrors generatePosts.ts; kept local so that file stays untouched) ─

// Tolerant parse of the model output into an object: strip stray ``` fences, fall
// back to the first {...} block if the model wrapped it in prose. Returns null on
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

// ── Post-generation safeguard: exactly one sourceUrl per output ────────────────
//
// The prompt asks for the link exactly once, but we do NOT rely on the prompt
// alone (same discipline as generatePosts.ts pinning its closing tags in code).
// This keeps the FIRST occurrence of the sourceUrl and strips every later one —
// absorbing a common lead-in connector that would otherwise be orphaned ("… as
// detailed at", "… available at", " at", " via") — then tidies the resulting
// whitespace/punctuation. Pure string manipulation, no extra model call, so the
// "repeated URL" bug cannot recur even if a future generation drifts.
export function enforceSingleUrl(text: string, url: string): string {
  if (!text || !url) return text;

  const first = text.indexOf(url);
  if (first === -1) return text; // model omitted it entirely — nothing to dedupe

  const head = text.slice(0, first + url.length);
  let tail = text.slice(first + url.length);

  // A trailing connector phrase sitting immediately before a to-be-removed URL,
  // e.g. "…, as detailed at ", "… available at ", " at ", " via ". Anchored to
  // the END of the text preceding the URL so only that connector is absorbed.
  const connector =
    /(?:,\s*)?(?:\b(?:as\s+)?(?:detailed|outlined|available|accessible|seen|found|described|reported|presented)\s+)?\b(?:at|via|visit|see)\b\s*$/i;

  let idx = tail.indexOf(url);
  while (idx !== -1) {
    const before = tail.slice(0, idx);
    const m = before.match(connector);
    const stripStart = m ? idx - m[0].length : idx;
    tail = tail.slice(0, stripStart) + tail.slice(idx + url.length);
    idx = tail.indexOf(url);
  }

  return (head + tail)
    .replace(/\s+([.,;:])/g, "$1")   // space before punctuation
    .replace(/,\s*\./g, ".")          // ", ." → "."
    .replace(/([.,;:])\1+/g, "$1")    // doubled punctuation
    .replace(/\s{2,}/g, " ")           // collapse runs of spaces
    .trim();
}

// ── Groq call ─────────────────────────────────────────────────────────────────

// Generate the funding pitch + lay summary for one paper. Throws on any failure so
// the route maps it via errorResponse (ServerConfigError → 500 misconfig, Error → 500).
export async function generateExtraOutputs(paper: PaperMetadata): Promise<ExtraOutputsResult> {
  if (!paper || !paper.title?.trim()) {
    throw new Error("A paper title is required to generate outputs.");
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    throw new ServerConfigError("GROQ_API_KEY not configured");
  }

  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(paper) },
      ],
      temperature: 0.7,
      max_tokens: 2048,
      // Both outputs are prose paragraphs; JSON mode forces the model to escape
      // the inner newlines as \n so JSON.parse never rejects the response (same
      // reasoning as generatePosts.ts).
      response_format: { type: "json_object" },
    }),
  });

  if (!groqRes.ok) {
    const detail = await groqRes.text();
    console.error("Groq API error (generate-extras):", groqRes.status, detail);
    throw new Error("AI service unavailable. Please try again.");
  }

  const groqData = await groqRes.json();
  const content: string = groqData.choices?.[0]?.message?.content ?? "";
  const parsed = parseJson(content);

  // Collapse any repeated sourceUrl down to a single occurrence in code, so the
  // guarantee doesn't depend on the model obeying the prompt every time.
  const fundingPitch = enforceSingleUrl(asString(parsed?.fundingPitch), paper.sourceUrl);
  const laySummary = enforceSingleUrl(asString(parsed?.laySummary), paper.sourceUrl);

  // Both must be present and non-empty; a missing one means the generation didn't
  // hold up — fail rather than ship a gap (matches generatePromoPosts).
  if (!fundingPitch || !laySummary) {
    console.error("Missing/empty extra outputs in Groq response:", content);
    throw new Error("AI response was incomplete. Please try again.");
  }

  return { fundingPitch, laySummary };
}
