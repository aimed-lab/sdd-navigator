// lib/server/proposal/grounding.ts — ⚠️ THE SPARC GROUNDING UNIT.
//
// Moved VERBATIM from app/api/generate-proposal/route.ts (Step 4a). This whole
// cluster is the "the LLM can never invent providers" guarantee — the bodies
// below are copied byte-for-byte, not reimplemented:
//   fetchInternalProviders, collectGrounding, buildSparcGrounding,
//   sanitizeSparcSelection, costSymbol, extractCapabilityHows, buildPhaseProviders
//
// sanitizeSparcSelection re-validates the model's selection verbatim against the
// real DB arrays; buildPhaseProviders builds cards ONLY from real DB rows. Do not
// "clean up" any of this.

import type { InternalProvider, SparcStepContribution } from "@/types/navigator";
import type { ProposalProvider } from "@/types/proposal";

// ── SPARC providers (DB) ──────────────────────────────────────────────────────

// Read the real internal providers (SPARC) from the `providers` table. Public-
// read RLS → anon key is fine. Fully isolated in try/catch: any failure returns
// [] and never blocks generation. NOTE: the live table has no description/
// website cols — `speciality` holds the description, `contact` holds the URL.
// SPARC is modelled as multiple rows (one per service area), so this returns an
// array and grounding spans ALL rows (not just the first).
export async function fetchInternalProviders(): Promise<InternalProvider[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  try {
    const res = await fetch(
      `${url}/rest/v1/providers?type=eq.internal` +
        `&select=name,speciality,capabilities,tools,estimated_cost,estimated_timeline,is_free,contact`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// Union of every capability / tool across all internal provider rows. This is
// the ONLY vocabulary the LLM may draw SPARC selections from, and the set
// sanitizeSparcSelection re-validates against.
export function collectGrounding(providers: InternalProvider[]) {
  const caps = new Set<string>();
  const tools = new Set<string>();
  for (const p of providers) {
    for (const c of p.capabilities ?? []) if (c) caps.add(c);
    for (const t of p.tools ?? []) if (t) tools.add(t);
  }
  return { capabilities: [...caps], tools: [...tools] };
}

// ── SPARC grounding (carried forward from generate-roadmap) ───────────────────

// Build the grounding addendum injected into the prompt so the LLM can decide,
// per phase, WHICH of SPARC's real capabilities/tools apply. The lists below are
// the ONLY values the model may use — reinforced server-side by
// sanitizeSparcSelection(), which drops anything not present verbatim.
export function buildSparcGrounding(caps: string[], tools: string[]): string {
  if (caps.length === 0 && tools.length === 0) return "";
  return `

UAB SPARC — INTERNAL PROVIDER (grounded data — DO NOT INVENT):
SPARC is UAB's real internal drug-discovery support center. These are its ONLY real capabilities and tools:
Capabilities: ${caps.join("; ")}
Tools: ${tools.join("; ")}

For EACH object in the "phases" array, add a "sparc" field selecting which of SPARC's capabilities/tools genuinely help at THAT phase:
  "sparc": { "relevant": boolean, "capabilities": ["subset of the capabilities above"], "tools": ["subset of the tools above"], "capability_how": { "<exact capability string>": "1-2 sentences on how THIS capability specifically helps this target at this phase" }, "how": "one short fallback sentence for the phase overall" }

HARD RULES for the "sparc" field:
- You may ONLY copy capability/tool strings VERBATIM from the two lists above. NEVER invent, rename, paraphrase, abbreviate, or add new capabilities, tools, or providers.
- Pick only the subset genuinely relevant to that specific phase. Different phases MUST get different selections — choose what actually applies to each.
- "capability_how" MUST contain one entry for EVERY capability you list in "capabilities", keyed by the EXACT capability string (verbatim from the list above).
- Each capability's sentence must be SPECIFIC to what THAT capability actually does for this target, and DISTINCT from the others. NEVER reuse the same sentence (or a near-identical one) for two capabilities — a researcher may want each service independently, so the text must let them tell the services apart. Example: for "Pathway & gene-set enrichment analysis" describe how enrichment situates this target in its pathway/gene-set context; for "Protein-interaction network analysis" describe how interactome mapping reveals this target's binding partners — clearly different sentences.
- If SPARC genuinely does not help at a phase, set "relevant": false with empty "capabilities"/"tools" arrays, empty "capability_how", and an empty "how". Do not force a fit.
- Do NOT output any other providers, CROs, companies, tools, or papers anywhere in the JSON — those are added by the system, not by you.`;
}

// Re-validate the LLM-selected SPARC subset against the REAL DB arrays. Any
// capability/tool not present verbatim (case-insensitive) is dropped — the hard
// guarantee that the model cannot invent tools/capabilities. Identical in spirit
// to generate-roadmap's sanitizeSparc, but validates against the union of all
// SPARC rows rather than a single row.
export function sanitizeSparcSelection(
  raw: unknown,
  allowedCaps: string[],
  allowedTools: string[],
): SparcStepContribution {
  const r = (raw ?? {}) as Record<string, unknown>;

  const pick = (value: unknown, allowed: string[]): string[] => {
    if (!Array.isArray(value)) return [];
    const canonical = new Map(allowed.map((a) => [a.toLowerCase().trim(), a]));
    const out: string[] = [];
    for (const v of value) {
      if (typeof v !== "string") continue;
      const hit = canonical.get(v.toLowerCase().trim());
      if (hit && !out.includes(hit)) out.push(hit);
    }
    return out;
  };

  const capabilities = pick(r.capabilities, allowedCaps);
  const tools = pick(r.tools, allowedTools);
  const how = typeof r.how === "string" ? r.how.trim() : "";
  // Relevant only if the model said so AND at least one grounded item survived.
  const relevant = r.relevant === true && (capabilities.length > 0 || tools.length > 0);

  return { relevant, capabilities, tools, how: relevant ? how : "" };
}

// Derive a $–$$$$ symbol from a raw DB cost string, or null when absent. Buckets
// are absolute-dollar based on the first numeric value found — derived from real
// data, never fabricated.
export function costSymbol(cost: string | null | undefined): string | null {
  if (!cost) return null;
  const m = cost.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  if (!(n > 0)) return null;
  if (n < 1500) return "$";
  if (n < 3000) return "$$";
  if (n < 10000) return "$$$";
  return "$$$$";
}

// Extract the model's PER-CAPABILITY "how" explanations, validated against the
// real grounded capabilities (keys must match a real capability verbatim, so the
// model can't attach text to an invented service). Keyed by lowercased capability.
// Kept separate from sanitizeSparcSelection so that grounding guard stays untouched.
export function extractCapabilityHows(rawSparc: unknown, allowedCaps: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const r = (rawSparc ?? {}) as Record<string, unknown>;
  const ch = r.capability_how;
  if (!ch || typeof ch !== "object" || Array.isArray(ch)) return out;
  const canonical = new Map(allowedCaps.map((a) => [a.toLowerCase().trim(), a]));
  for (const [key, value] of Object.entries(ch as Record<string, unknown>)) {
    if (typeof value !== "string" || !value.trim()) continue;
    const hit = canonical.get(key.toLowerCase().trim());
    if (hit) out.set(hit.toLowerCase(), value.trim());
  }
  return out;
}

// Map a phase's VALIDATED SPARC selection back to the real DB rows, producing
// Verified provider cards. A row is included only if it actually owns at least
// one of the surviving capabilities — so providers are built entirely from DB
// rows, never from LLM free text. Returns [] when nothing matches.
//
// Each card's "how" is the explanation for THAT row's own capability (from the
// per-capability map), so two different SPARC services in one phase get distinct,
// service-specific text — never the same phase-level blurb copied across cards.
export function buildPhaseProviders(
  contribution: SparcStepContribution,
  providers: InternalProvider[],
  capabilityHows: Map<string, string>,
): ProposalProvider[] {
  if (!contribution.relevant) return [];
  const selectedCaps = new Set(contribution.capabilities.map((c) => c.toLowerCase()));
  const selectedTools = new Set(contribution.tools.map((t) => t.toLowerCase()));

  const cards: ProposalProvider[] = [];
  for (const row of providers) {
    const rowCaps = (row.capabilities ?? []).filter((c) => selectedCaps.has(c.toLowerCase()));
    if (rowCaps.length === 0) continue; // this SPARC service isn't relevant to this phase
    const rowTools = (row.tools ?? []).filter((t) => selectedTools.has(t.toLowerCase()));
    // Capability-specific "how": join this row's own capabilities' sentences
    // (deduped). Fall back to the phase-level "how" only if none were provided.
    const rowHows = [...new Set(rowCaps.map((c) => capabilityHows.get(c.toLowerCase())).filter(Boolean))] as string[];
    const how = rowHows.length > 0 ? rowHows.join(" ") : contribution.how;
    cards.push({
      name: row.name,
      verified: true,
      speciality: row.speciality,
      capabilities: rowCaps,
      tools: rowTools,
      how,
      estimated_cost: row.estimated_cost,
      cost_symbol: costSymbol(row.estimated_cost),
      estimated_timeline: row.estimated_timeline,
      is_free: row.is_free ?? false,
      contact: row.contact,
    });
  }
  return cards;
}
