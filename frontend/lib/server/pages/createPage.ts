// lib/server/pages/createPage.ts — the one code path that creates a living page:
// the `pages` row, then the research run on the Python backend, then notes and
// evidence. Used by POST /api/pages (the website) and POST
// /api/agent/create_page (the external agent), so both behave identically.
//
// WHO WRITES WHAT:
//   * the `pages` row is inserted with `insertDb`. The website route passes the
//     service-role client (a signed-out visitor can make a public page, owner
//     NULL); the agent route passes a client bound to the RESEARCHER'S token,
//     so the pages INSERT policy (owner_id = auth.uid()) is what lets it in.
//   * notes and evidence are then written by pageNotes.ts / pageEvidence.ts,
//     which use the server-side service-role client, the same as the website
//     flow. `ownerId` always comes from a validated session or token, never
//     from a request body.
//
// The first build writes no page_updates (see pageEvidenceCore.ts).

import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";
import { savePageEvidence, type PageEvidenceFilingsBySlug, type PageEvidenceItemInput } from "@/lib/server/pages/pageEvidence";
import { savePageNotes, type PageNoteProposal } from "@/lib/server/pages/pageNotes";
import { newPageSlug, type PageVisibility } from "@/lib/server/pages/pagesDb";

const MAX_SLUG_ATTEMPTS = 3;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type CreatePageInput = {
  insertDb: Db;
  ownerId: string | null;
  title: string;
  topic: string;
  visibility: PageVisibility;
};

export type CreatePageResult =
  | {
      ok: true;
      pageId: string;
      slug: string;
      visibility: PageVisibility;
      notes: number;
      evidence: number;
      references: unknown[];
      citationReport: unknown;
    }
  | { ok: false; status: number; error: string };

export async function createLivingPage(input: CreatePageInput): Promise<CreatePageResult> {
  const { insertDb, ownerId, title, topic, visibility } = input;

  // A random-suffixed slug makes a first-try collision rare, but two requests
  // seeding the same topic at once is expected, so retry on a 23505.
  let pageId: string | null = null;
  let slug = "";
  let createError: string | null = null;
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    slug = newPageSlug(topic);
    const { data, error } = await insertDb
      .from("pages")
      .insert({ slug, title, seed_type: "topic", seed_input: topic, owner_id: ownerId, visibility })
      .select("id, slug")
      .single();
    if (!error && data) {
      pageId = data.id as string;
      slug = data.slug as string;
      createError = null;
      break;
    }
    if (error && (error as { code?: string }).code === "23505") {
      createError = error.message;
      continue;
    }
    createError = error?.message ?? "unknown error creating page";
    break;
  }
  if (!pageId) {
    console.error("createLivingPage: couldn't create page row", createError);
    return { ok: false, status: 500, error: "Couldn't create the page. Please try again." };
  }

  // A failure past this point leaves a real, empty page behind (the topic was
  // real, the research pass failed) and is reported, not hidden.
  let agentResult: {
    wiki_notes?: PageNoteProposal[];
    evidence_filings?: PageEvidenceFilingsBySlug;
    unfiled_items?: PageEvidenceItemInput[];
    project_level_items?: PageEvidenceItemInput[];
    references?: unknown[];
    citation_report?: unknown;
  };
  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/page-agent`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ topic }),
    });
    if (!res.ok) throw new Error(`agent backend responded ${res.status}`);
    agentResult = await res.json();
  } catch (e) {
    console.error("createLivingPage: page-agent proxy failed", e);
    return {
      ok: false,
      status: 502,
      error: "Couldn't reach the research backend. The page was created but has no content yet.",
    };
  }

  const savedNotes = await savePageNotes(pageId, agentResult.wiki_notes ?? []);
  if (savedNotes.status !== "ok") {
    console.error("createLivingPage: savePageNotes failed", savedNotes.error);
    return { ok: false, status: 500, error: savedNotes.error };
  }

  // Evidence after notes: filing resolves a note slug to the id savePageNotes
  // just resolved.
  const unfiled = [...(agentResult.unfiled_items ?? []), ...(agentResult.project_level_items ?? [])];
  const savedEvidence = await savePageEvidence(
    pageId,
    agentResult.evidence_filings ?? {},
    unfiled,
    savedNotes.noteIdBySlug
  );
  if (savedEvidence.status !== "ok") {
    console.error("createLivingPage: savePageEvidence failed", savedEvidence.error);
    return { ok: false, status: 500, error: savedEvidence.error };
  }

  return {
    ok: true,
    pageId,
    slug,
    visibility,
    notes: savedNotes.saved,
    evidence: savedEvidence.itemsUpserted,
    references: agentResult.references ?? [],
    citationReport: agentResult.citation_report ?? null,
  };
}
