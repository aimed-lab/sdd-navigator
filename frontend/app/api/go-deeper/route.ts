import { NextResponse } from "next/server";
import { getProject } from "@/lib/server/projects";
import { getWikiNote, saveWikiNotes, type WikiNoteProposal, type WikiNoteType } from "@/lib/server/wikiNotes";
import { saveEvidence, type EvidenceFilingsBySlug, type EvidenceItemInput } from "@/lib/server/wikiEvidence";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";

// Proxy + PERSISTENCE for the researcher-triggered "Go deeper" action (see
// backend/explore-mcp/tools/go_deeper.py and server.py's POST
// /api/go-deeper). Unlike the other project-agent proxies, this route
// itself does the saving — there's no separate poll/status route, because
// a single-question search is small enough to finish within one request
// (see go_deeper.py's own reported wall-clock: single digits of seconds).
//
// REUSES saveWikiNotes()/saveEvidence() VERBATIM — the exact same
// persistence path a broad project-agent run already uses. This is what
// gives "Go deeper" the SAME guarantees for free, with no new code:
//   - never overwrites a human-edited note (saveWikiNotes' own guard —
//     if the note was hand-edited since the researcher clicked "Go
//     deeper", the body/title rewrite is silently skipped, exactly as it
//     already is for a broad run; evidence still files normally, since
//     that's a separate write that doesn't touch the note row)
//   - "update, not duplicate" — there is no create path here at all.
//     go_deeper.py always returns a proposal keyed by the SAME note id/
//     slug it was handed; saveWikiNotes' "action: update" branch is the
//     ONLY branch this route ever exercises.
//
// AUTH/MEMBERSHIP: same as every other project-scoped proxy — getProject()
// and getWikiNote() are both RLS-backed; a caller who isn't a member of
// the project this note belongs to gets not_found for both, never the row.

export async function POST(req: Request) {
  let projectId = "";
  let noteId = "";
  try {
    const body = await req.json();
    if (body && typeof body.projectId === "string") projectId = body.projectId;
    if (body && typeof body.noteId === "string") noteId = body.noteId;
  } catch {
    // malformed body -> both stay empty, caught below
  }
  if (!projectId || !noteId) {
    return NextResponse.json({ error: "Missing project or note." }, { status: 400 });
  }

  const projectResult = await getProject(projectId);
  if (projectResult.status !== "ok") {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const noteResult = await getWikiNote(projectId, noteId);
  if (noteResult.status !== "ok") {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }
  const note = noteResult.note;

  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/go-deeper`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        note: { id: note.id, slug: note.slug, title: note.title, body: note.body, note_type: note.note_type },
      }),
    });
    if (!res.ok) throw new Error(`go-deeper backend responded ${res.status}`);

    const data = (await res.json()) as {
      resolved?: boolean;
      note?: { slug: string; title: string; body: string; note_type: WikiNoteType } | null;
      evidence_filings?: EvidenceFilingsBySlug;
      unfiled_items?: EvidenceItemInput[];
      queries_tried?: { tool: string; query: string }[];
      // The SAME count go_deeper.py already wove into the note body's own
      // "searched N way(s)" narrative — see that module's own comment on
      // why this must NOT be re-derived from queries_tried.length here
      // (that's raw per-tool-call entries, a different, larger number).
      ways_searched?: number;
      tools_called?: string[];
      judgment_failed?: boolean;
      error?: string;
    };
    if (data.error) throw new Error(data.error);

    // judgment_failed=true means the search ran but the judgment call
    // itself broke — go_deeper.py deliberately returns note=null in that
    // case rather than guess. Nothing to persist; report it distinctly
    // from a genuine STILL NOTHING (which DOES have a note to save).
    if (data.judgment_failed || !data.note) {
      return NextResponse.json({
        resolved: false,
        judgmentFailed: true,
        queriesTried: data.queries_tried ?? [],
        waysSearched: data.ways_searched ?? data.queries_tried?.length ?? 0,
        toolsCalled: data.tools_called ?? [],
      });
    }

    // PERSIST — the same two calls a broad project-agent run's status
    // route already makes, reused verbatim. Order matters: notes before
    // evidence, since saveEvidence resolves a filing's note slug to a
    // real note id by reading wiki_notes back from the database.
    const proposal: WikiNoteProposal = {
      action: "update",
      note_id: note.id,
      slug: note.slug,
      title: data.note.title,
      note_type: data.note.note_type,
      body: data.note.body,
    };
    const savedNotes = await saveWikiNotes(projectId, [proposal]);
    if (savedNotes.status !== "ok") {
      console.error("go-deeper route: saveWikiNotes failed", savedNotes.error);
    }

    const savedEvidence = await saveEvidence(
      projectId,
      data.evidence_filings ?? {},
      data.unfiled_items ?? []
    );
    if (savedEvidence.status !== "ok") {
      console.error("go-deeper route: saveEvidence failed", savedEvidence.error);
    }

    const filedCount = Object.values(data.evidence_filings ?? {}).reduce((n, list) => n + list.length, 0);

    return NextResponse.json({
      resolved: data.resolved ?? false,
      judgmentFailed: false,
      // Whether the note row itself actually got the rewrite — false when
      // it was skipped by saveWikiNotes' human-edit guard, so the client
      // can say THAT plainly rather than claim an update that didn't land.
      noteUpdated: savedNotes.status === "ok" && savedNotes.saved > 0,
      skippedHumanEdited: savedNotes.status === "ok" && savedNotes.skippedHumanEdited > 0,
      filedCount,
      unfiledCount: (data.unfiled_items ?? []).length,
      queriesTried: data.queries_tried ?? [],
      waysSearched: data.ways_searched ?? data.queries_tried?.length ?? 0,
      toolsCalled: data.tools_called ?? [],
    });
  } catch (e) {
    console.error("go-deeper route failed", e);
    return NextResponse.json(
      { resolved: false, judgmentFailed: true, error: true, queriesTried: [], toolsCalled: [] },
      { status: 200 }
    );
  }
}
