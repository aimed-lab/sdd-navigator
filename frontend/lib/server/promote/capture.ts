// lib/server/promote/capture.ts — Promote identity-capture writes (public).
//
// Step 3 of the "Promote" feature. After a researcher copies/opens their draft
// post, we OPTIONALLY capture their identity (ORCID / LinkedIn) tied to the paper
// into `promote_captures`. Unlike connections.ts (which is requireUser-scoped),
// this is intentionally PUBLIC: the subject is an external researcher, not the
// logged-in caller, and the table's RLS is "anyone can insert" — so we write with
// the anon server client, never the session client.

import { getAnonServerClient, ServerConfigError } from "../supabaseServer";

export type PromoteCaptureInput = {
  doi: string | null;
  pmid: string | null;
  paper_title: string | null;
  author_name: string | null;
  orcid: string | null;
  linkedin_url: string | null;
};

// Validate + normalize an untrusted body. Prototype-level: a basic non-empty
// check only (at least one identity field). Returns null when neither ORCID nor
// LinkedIn is supplied, so the route can answer 400 without touching the DB.
export function parseCaptureInput(body: unknown): PromoteCaptureInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const orcid = str(b.orcid);
  const linkedin_url = str(b.linkedinUrl ?? b.linkedin_url);
  if (!orcid && !linkedin_url) return null; // must have at least one identity handle

  return {
    doi: str(b.doi) || null,
    pmid: str(b.pmid) || null,
    paper_title: str(b.paperTitle ?? b.paper_title) || null,
    author_name: str(b.authorName ?? b.author_name) || null,
    orcid: orcid || null,
    linkedin_url: linkedin_url || null,
  };
}

// Insert one capture row via the anon client (public-insert RLS). Throws on any
// DB/config error so the route can map it through errorResponse.
export async function createPromoteCapture(input: PromoteCaptureInput): Promise<void> {
  const supabase = getAnonServerClient();
  if (!supabase) throw new ServerConfigError();

  const { error } = await supabase.from("promote_captures").insert({
    doi: input.doi,
    pmid: input.pmid,
    paper_title: input.paper_title,
    author_name: input.author_name,
    orcid: input.orcid,
    linkedin_url: input.linkedin_url,
  });
  if (error) throw error;
}
