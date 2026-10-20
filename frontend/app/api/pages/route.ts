import { NextResponse } from "next/server";
import { getPagesServiceRoleClient, newPageSlug, titleFromTopic } from "@/lib/server/pages/pagesDb";
import { savePageNotes, type PageNoteProposal } from "@/lib/server/pages/pageNotes";
import { savePageEvidence, type PageEvidenceFilingsBySlug, type PageEvidenceItemInput } from "@/lib/server/pages/pageEvidence";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";

// POST /api/pages — create a topic-seeded, no-login "living page": a bare
// topic string in, a page whose wiki notes + evidence have already been
// researched and written out.
//
// MODELED ON THE PROJECT AGENT FLOW, BUT SYNCHRONOUS AND UNAUTHENTICATED,
// PER THIS TASK'S OWN INSTRUCTION. The project flow
// (app/api/project-agent/start + .../status) is a start/poll pair because a
// signed-in researcher is sitting on a project page watching real progress
// on a 20-40s run. A bare "type a topic, get a page" flow has no such page
// to poll from yet — there's no pageId until this very request creates one —
// so this is written as ONE blocking request instead: create the `pages` row
// first, then run the same search -> wiki-note-writing -> evidence-filing
// pipeline in-process against the Python backend, then persist, then return.
// This can legitimately take a while (real search calls plus an LLM call);
// that's expected, see this feature's own task description.
//
// WHY A NEW PYTHON ROUTE (POST /api/page-agent on explore-mcp), NOT REUSING
// POST /api/project-agent: that route's own validation
// (_validate_project_agent_body) requires `name`, and run_project_agent_async
// reasons over project-shaped fields (target/indication/modality/stage,
// existing_checklist, saved_item_ids) a bare topic doesn't have — a project
// has a save/checklist REVIEW step this feature explicitly doesn't (there is
// no human review here; this route persists directly, see pageNotes.ts/
// pageEvidence.ts). Forcing a topic through the project shape would mean
// either sending garbage project fields or teaching that route to branch on
// "is this actually a page," neither of which is cleaner than the new,
// smaller route in backend/explore-mcp/tools/page_agent.py + server.py's
// POST /api/page-agent, which reuses the SAME underlying search
// (tools/explore.py's explore_async) and the SAME wiki-note-writing/
// evidence-filing functions (tools/wiki_agent.py) the project flow already
// uses — no duplicated agent/search/grounding logic, just a different, much
// smaller orchestration on top for a bare topic.
//
// NO AUTH REQUIRED: owner_id is always null (anonymous), visibility is
// always 'public' — this route is the one place in the codebase besides
// lib/auth.ts's deleteAccount() that reaches for a service-role Supabase
// client, because 2026-09-30_living_pages.sql deliberately offers no INSERT
// policy for a NULL-owner page (see that migration's own OWNERSHIP MODEL
// note) — there is no session to scope a normal request-scoped client to
// here at all.

const MIN_TOPIC_LEN = 3;
const MAX_TOPIC_LEN = 200;
const MAX_SLUG_ATTEMPTS = 3;

function validateTopic(raw: unknown): { ok: true; topic: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Missing required field: topic." };
  }
  const topic = raw.trim();
  if (topic.length < MIN_TOPIC_LEN || topic.length > MAX_TOPIC_LEN) {
    return {
      ok: false,
      error: `topic must be between ${MIN_TOPIC_LEN} and ${MAX_TOPIC_LEN} characters after trimming.`,
    };
  }
  return { ok: true, topic };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const topicField = body && typeof body === "object" ? (body as Record<string, unknown>).topic : undefined;
  const validated = validateTopic(topicField);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { topic } = validated;

  const db = getPagesServiceRoleClient();
  if (!db) {
    return NextResponse.json(
      { error: "Server misconfigured: pages feature has no service-role Supabase client." },
      { status: 500 }
    );
  }

  // Create the `pages` row first — a random-suffixed slug (see
  // pagesDb.ts's newPageSlug) makes a first-try collision rare, but two
  // requests seeding the exact same topic in the same instant is the
  // COMMON case this feature expects (no ownership to disambiguate slugs
  // by), so this retries with a fresh suffix on a 23505 rather than only
  // on some rarer failure.
  const title = titleFromTopic(topic);
  let pageId: string | null = null;
  let slug = "";
  let createError: string | null = null;

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    slug = newPageSlug(topic);
    const { data, error } = await db
      .from("pages")
      .insert({
        slug,
        title,
        seed_type: "topic",
        seed_input: topic,
        owner_id: null,
        visibility: "public",
      })
      .select("id, slug")
      .single();

    if (!error && data) {
      pageId = data.id as string;
      slug = data.slug as string;
      createError = null;
      break;
    }
    // 23505 = unique_violation on the slug index — retry with a new suffix.
    if (error && (error as { code?: string }).code === "23505") {
      createError = error.message;
      continue;
    }
    createError = error?.message ?? "unknown error creating page";
    break;
  }

  if (!pageId) {
    console.error("POST /api/pages: couldn't create page row", createError);
    return NextResponse.json({ error: "Couldn't create the page. Please try again." }, { status: 500 });
  }

  // Run the pipeline against the Python backend. Any failure here still
  // leaves a real `pages` row behind (an empty page, with no notes/evidence
  // yet) — that's an acceptable degraded outcome for this feature (the topic
  // was real, the research pass just failed), reported as an error to the
  // caller rather than silently returning a 200 with notes: 0 as if nothing
  // was even attempted.
  let agentResult: {
    wiki_notes?: PageNoteProposal[];
    evidence_filings?: PageEvidenceFilingsBySlug;
    unfiled_items?: PageEvidenceItemInput[];
    project_level_items?: PageEvidenceItemInput[];
    search_failed?: boolean;
    warnings?: string[];
    references?: { n: number; item_id: string; title: string }[];
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
    console.error("POST /api/pages: page-agent proxy failed", e);
    return NextResponse.json(
      { error: "Couldn't reach the research backend. The page was created but has no content yet." },
      { status: 502 }
    );
  }

  const notes = agentResult.wiki_notes ?? [];
  const savedNotes = await savePageNotes(pageId, notes);
  if (savedNotes.status !== "ok") {
    console.error("POST /api/pages: savePageNotes failed", savedNotes.error);
    return NextResponse.json({ error: savedNotes.error }, { status: 500 });
  }

  // Evidence-saving runs AFTER note-saving, same ordering constraint as the
  // project flow's own status route (see saveEvidence's filing step, which
  // resolves a filing's note slug to a real note id) — savePageNotes() above
  // already resolved every slug it touched, so this reuses that map directly
  // instead of re-reading page_notes back by page_id.
  const filings = agentResult.evidence_filings ?? {};
  const unfiledItems = [...(agentResult.unfiled_items ?? []), ...(agentResult.project_level_items ?? [])];
  const savedEvidence = await savePageEvidence(pageId, filings, unfiledItems, savedNotes.noteIdBySlug);
  if (savedEvidence.status !== "ok") {
    console.error("POST /api/pages: savePageEvidence failed", savedEvidence.error);
    return NextResponse.json({ error: savedEvidence.error }, { status: 500 });
  }

  return NextResponse.json({
    slug,
    pageId,
    notes: savedNotes.saved,
    evidence: savedEvidence.itemsUpserted,
    references: agentResult.references ?? [],
    citationCheck: agentResult.citation_report ?? null,
  });
}
