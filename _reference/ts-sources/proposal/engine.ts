// lib/server/proposal/engine.ts — the proposal orchestrator.
//
// Moved VERBATIM from app/api/generate-proposal/route.ts (Step 4a): parseInput,
// buildRecap, the prompt (PROPOSAL_SYSTEM_PROMPT + buildUserMessage), the Groq
// call + JSON parsing (runGeneration), and the phase-assembly loop — wrapped as
// generateProposal(). The route handler now just parses the request and calls
// these. generateProposal returns a discriminated result so the route can map
// failures to the SAME HTTP status codes as before (500 missing key, 502/500
// generation failure) without changing any generation behavior.

import type {
  ProposalInput,
  ProposalDocument,
  ProposalPhase,
  ProposalResearchItem,
  ProposalRecap,
} from "@/types/proposal";
import {
  fetchInternalProviders,
  collectGrounding,
  buildSparcGrounding,
  sanitizeSparcSelection,
  extractCapabilityHows,
  buildPhaseProviders,
} from "@/lib/server/proposal/grounding";
import { gatherResearch } from "@/lib/server/proposal/research";

// ── Prompt ────────────────────────────────────────────────────────────────────

const PROPOSAL_SYSTEM_PROMPT = `You are a drug-discovery program strategist at UAB SPARC. A researcher gives you a project described across the 7 sections of an RFA proposal. Produce a PHASED discovery plan that turns their project into a sequence of concrete phases.

Return ONLY valid JSON, no markdown, no explanation, in this exact shape:
{
  "title": "string — a concise proposal title",
  "summary": "string — one sentence summarising the strategy",
  "phases": [
    {
      "id": "string — slug like phase-1",
      "title": "string — e.g. Target Validation & Feasibility",
      "goal": "string — what this phase achieves",
      "outcomes": ["string — 1-2 concrete deliverables the researcher walks away with after this phase"],
      "estimated_duration": "string — e.g. 6-9 weeks",
      "sparc": { "relevant": boolean, "capabilities": ["..."], "tools": ["..."], "how": "string" }
    }
  ]
}

PHASES: Aim for 3 phases that follow the natural arc — typically (1) Target Validation & Feasibility, (2) AI-Enabled Design & Candidate Generation, (3) Validation Planning & Translational Path — but you MAY use 2 or 4 phases if the project clearly warrants it. Do NOT lock to exactly 3, and there is no special "final phase" treatment.

Each phase's "goal" must be specific to THIS researcher's target and rationale, not generic boilerplate.

OUTCOMES: Each phase's "outcomes" is 1-2 concrete DELIVERABLES the researcher walks away with after that phase — the tangible artifacts or decisions the phase produces (e.g. "a ranked shortlist of validated candidate molecules", "a go/no-go feasibility decision with supporting data", "an IND-enabling study plan"). Each outcome must follow LOGICALLY from that phase's goal and be specific to THIS target — never generic. Do NOT overstate: promise only what the phase's work actually produces (data, a validated shortlist, a plan, a decision), not clinical success or guaranteed efficacy. Outcomes are deliverables ONLY — never name providers, CROs, companies, tools, or papers in them.

You do NOT choose providers or papers — the system attaches real, verified providers and real research to each phase. Your ONLY provider-related job is the "sparc" field per phase (see the SPARC rules below). Never output company names, CROs, tools, or papers anywhere else in the JSON.`;

function buildUserMessage(input: ProposalInput): string {
  const chips = (input.support_chips ?? []).filter(Boolean).join(", ") || "None specified";
  return `Generate a phased discovery proposal for this project:

Title / Team: ${input.title_and_team}
Therapeutic target / what they have: ${input.therapeutic_target}
Scientific rationale: ${input.scientific_rationale}
Support needed from SPARC/providers: ${input.sparc_support_needed || "Not specified"}
Validation plan: ${input.validation_plan || "Not specified"}
Expected impact: ${input.expected_impact || "Not specified"}
Project readiness: ${input.project_readiness || "Not specified"}
Type of support requested (chips): ${chips}

Return only the JSON proposal document.`;
}

// ── Input parsing ─────────────────────────────────────────────────────────────

export function parseInput(body: Record<string, unknown>): ProposalInput | null {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const input: ProposalInput = {
    title_and_team: str(body.title_and_team),
    therapeutic_target: str(body.therapeutic_target),
    scientific_rationale: str(body.scientific_rationale),
    sparc_support_needed: str(body.sparc_support_needed),
    validation_plan: str(body.validation_plan),
    expected_impact: str(body.expected_impact),
    project_readiness: str(body.project_readiness),
    support_chips: Array.isArray(body.support_chips)
      ? body.support_chips.filter((c): c is string => typeof c === "string")
      : [],
  };
  // Core science fields are required; the rest are recommended but optional.
  if (!input.title_and_team || !input.therapeutic_target || !input.scientific_rationale) {
    return null;
  }
  return input;
}

function buildRecap(input: ProposalInput): ProposalRecap {
  return {
    title: input.title_and_team,
    therapeutic_target: input.therapeutic_target,
    scientific_rationale: input.scientific_rationale,
    sparc_support_needed: input.sparc_support_needed,
    validation_plan: input.validation_plan,
    expected_impact: input.expected_impact,
    project_readiness: input.project_readiness,
    support_chips: input.support_chips ?? [],
  };
}

// ── Generation (extracted so it can run in parallel with research) ────────────

type GenerationResult =
  | { ok: true; parsed: Record<string, unknown> }
  | { ok: false; status: number; error: string };

async function runGeneration(
  systemPrompt: string,
  userMessage: string,
  groqKey: string,
): Promise<GenerationResult> {
  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!groqRes.ok) {
    const detail = await groqRes.text();
    console.error("Groq API error:", groqRes.status, detail);
    return { ok: false, status: 502, error: "AI service unavailable. Please try again." };
  }

  const groqData = await groqRes.json();
  const content: string = groqData.choices?.[0]?.message?.content ?? "";

  // Parse JSON — tolerant of markdown fences (carried forward from generate-roadmap).
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed) {
    console.error("Failed to parse Groq response:", content);
    return { ok: false, status: 500, error: "Failed to parse AI response. Please try again." };
  }
  return { ok: true, parsed };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export type GenerateResult =
  | { ok: true; document: ProposalDocument }
  | { ok: false; status: number; error: string };

// Full pipeline: SPARC grounding → LLM generation ‖ research gathering → assemble
// the phased document. Research now runs fully in-process (gatherResearch calls
// runDiscover / the keyword extractor directly), so no request origin is needed.
export async function generateProposal(
  input: ProposalInput,
): Promise<GenerateResult> {
  // Fetch SPARC first — its real capabilities/tools must be in hand BEFORE the
  // LLM call so we can inject them as grounding for the per-phase selection.
  const internalProviders = await fetchInternalProviders();
  const grounding = collectGrounding(internalProviders);

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return { ok: false, status: 500, error: "GROQ_API_KEY not configured" };
  }

  const systemPrompt =
    PROPOSAL_SYSTEM_PROMPT + buildSparcGrounding(grounding.capabilities, grounding.tools);

  // Run the main generation and the research gathering IN PARALLEL. The research
  // chain (extract terms → multi-term discover → precision filter) is far lighter
  // than the 4096-token generation, so it hides fully behind the LLM call and
  // adds no serial latency. gatherResearch never throws (returns empty pools).
  const [generation, research] = await Promise.all([
    runGeneration(systemPrompt, buildUserMessage(input), groqKey),
    gatherResearch(input),
  ]);

  if (!generation.ok) {
    return { ok: false, status: generation.status, error: generation.error };
  }
  const parsed = generation.parsed;

  // Distribute a balanced research mix per phase: up to 2 papers + 1 trial +
  // 1 funding opportunity, consumed sequentially so no phase repeats another's.
  // Honest — if a type's pool runs out, that phase just shows fewer; no padding.
  const PAPERS_PER_PHASE = 2;
  const TRIALS_PER_PHASE = 1;
  const GRANTS_PER_PHASE = 1;
  let pc = 0;
  let tc = 0;
  let gc = 0;

  const rawPhases = Array.isArray(parsed.phases) ? (parsed.phases as Record<string, unknown>[]) : [];
  const phases: ProposalPhase[] = rawPhases.map((p, i) => {
    const contribution = sanitizeSparcSelection(p.sparc, grounding.capabilities, grounding.tools);
    const capabilityHows = extractCapabilityHows(p.sparc, grounding.capabilities);
    const providers = buildPhaseProviders(contribution, internalProviders, capabilityHows);
    const papers: ProposalResearchItem[] = [
      ...research.papers.slice(pc, pc + PAPERS_PER_PHASE),
      ...research.trials.slice(tc, tc + TRIALS_PER_PHASE),
      ...research.grants.slice(gc, gc + GRANTS_PER_PHASE),
    ];
    pc += PAPERS_PER_PHASE;
    tc += TRIALS_PER_PHASE;
    gc += GRANTS_PER_PHASE;
    // Outcomes: 1-2 deliverables, kept only as non-empty strings, capped at 2.
    // These describe what the researcher walks away with — no providers/tools.
    const outcomes = Array.isArray(p.outcomes)
      ? p.outcomes
          .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
          .map((o) => o.trim())
          .slice(0, 2)
      : [];
    return {
      id: typeof p.id === "string" && p.id.trim() ? p.id.trim() : `phase-${i + 1}`,
      title: typeof p.title === "string" ? p.title : `Phase ${i + 1}`,
      goal: typeof p.goal === "string" ? p.goal : "",
      outcomes,
      estimated_duration: typeof p.estimated_duration === "string" ? p.estimated_duration : "",
      providers,
      papers,
    };
  });

  const document: ProposalDocument = {
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : input.title_and_team,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    recap: buildRecap(input),
    phases,
  };

  return { ok: true, document };
}
