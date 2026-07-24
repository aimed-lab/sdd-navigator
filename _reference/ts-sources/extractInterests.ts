// lib/server/extractInterests.ts — shared interest-keyword extraction (Groq).
//
// The keyword-extraction logic used to live inline in
// app/api/extract-interests/route.ts. It is lifted here VERBATIM so it has TWO
// in-process consumers with no HTTP hop between them:
//   • /api/extract-interests    — the user-facing keyword generator (Discovery
//                                 "Personalize your feed" modal).
//   • lib/server/proposal/research.ts — the proposal research pipeline, which
//                                 previously fetched /api/extract-interests over
//                                 HTTP (the self-fetch we removed).
//
// extractInterestKeywords returns a discriminated result so the route can map
// failures to the SAME HTTP status codes as before (400 no input, 500 missing
// key, 502 AI failure/unparseable), while research.ts just degrades to [] on any
// non-ok result.

const EXTRACT_SYSTEM_PROMPT = `You extract concise, search-friendly research keywords for a biomedical drug-discovery literature feed.
Given a researcher's answers, return 3 to 5 short keyword phrases (each 1-4 words) that work well as search queries against PubMed, ClinicalTrials.gov, and patent databases.
Prefer SPECIFIC diseases, targets, proteins, pathways, techniques, or compound classes over generic words like "research", "biology", or "science".
Return ONLY a JSON array of strings. No prose, no markdown, no object, no keys.
Example: ["Alzheimer's disease","protein aggregation","PHGDH inhibitors","tau phosphorylation"]`;

// Best-effort parse of the model output into a clean string[]. Tolerates
// markdown fences and a stray leading/trailing sentence by falling back to the
// first [...] block. Returns [] on any failure so the caller can 502 cleanly.
export function parseKeywords(content: string): string[] {
  const tryParse = (s: string): string[] | null => {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? (v as unknown[]).filter((x) => typeof x === "string") as string[] : null;
    } catch {
      return null;
    }
  };

  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let arr = tryParse(cleaned);
  if (!arr) {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) arr = tryParse(match[0]);
  }
  if (!arr) return [];

  // Normalize: trim, drop empties, dedupe case-insensitively, cap at 5.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const kw = raw.trim().replace(/^["']|["']$/g, "").slice(0, 60);
    const key = kw.toLowerCase();
    if (!kw || seen.has(key)) continue;
    seen.add(key);
    out.push(kw);
    if (out.length >= 5) break;
  }
  return out;
}

export type ExtractInterestsInput = {
  field?: string;
  working?: string;
  topics?: string;
};

export type ExtractInterestsResult =
  | { ok: true; keywords: string[] }
  | { ok: false; status: number; error: string };

// Turn a researcher's free-text answers into 3-5 clean keyword phrases via Groq.
// Never throws — every failure path returns { ok: false } with the status code
// the route should surface.
export async function extractInterestKeywords(
  input: ExtractInterestsInput,
): Promise<ExtractInterestsResult> {
  const parts = [
    input.field?.trim() ? `Field / discipline: ${input.field.trim()}` : "",
    input.working?.trim() ? `Currently working on: ${input.working.trim()}` : "",
    input.topics?.trim() ? `Wants to follow: ${input.topics.trim()}` : "",
  ].filter(Boolean);

  if (parts.length === 0) {
    return { ok: false, status: 400, error: "Please answer at least one question." };
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return { ok: false, status: 500, error: "GROQ_API_KEY not configured" };
  }

  const userMessage = `Extract search keywords from this researcher's answers:
${parts.join("\n")}

Return only the JSON array of 3-5 keywords.`;

  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: EXTRACT_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 256,
    }),
  });

  if (!groqRes.ok) {
    const detail = await groqRes.text();
    console.error("Groq API error (extract-interests):", groqRes.status, detail);
    return { ok: false, status: 502, error: "AI service unavailable. Please try again." };
  }

  const groqData = await groqRes.json();
  const content: string = groqData.choices?.[0]?.message?.content ?? "";
  const keywords = parseKeywords(content);

  if (keywords.length === 0) {
    console.error("Failed to parse keywords from Groq response:", content);
    return {
      ok: false,
      status: 502,
      error: "Couldn't turn that into keywords. Try rephrasing your answers.",
    };
  }

  return { ok: true, keywords };
}
