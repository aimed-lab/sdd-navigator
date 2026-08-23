import { NextResponse } from "next/server";
import { getProject } from "@/lib/server/projects";
import { listProjectResources } from "@/lib/server/projectResources";
import { listWikiNoteSummaries } from "@/lib/server/wikiNotes";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";

// Kick off a project-agent run in the Python backend (see
// backend/explore-mcp/tools/project_agent.py and server.py's
// /api/project-agent/start). Same proxy pattern as /api/explore.
//
// AUTH/MEMBERSHIP: the backend has no auth yet (a known open item — see
// CLAUDE.md) and never touches Supabase, so THIS route is where membership
// actually gets checked, via getProject()'s own RLS-backed "not_found covers
// both doesn't-exist and not-a-member" gate — same as every page read in this
// app. The client sends only a projectId; every field the agent reasons over
// (name, description, target, indication, modality, stage, existing
// checklist labels, AND the ids already saved to Resources) is read
// server-side from the project the caller is verified to belong to, never
// trusted from the request body. That also means a forged request can't ask
// the agent to reason about a project the caller isn't on, can't feed it
// fabricated goal text, and can't lie about what's already saved to make the
// agent re-propose things that would 23505 on accept.

export async function POST(req: Request) {
  let projectId = "";
  try {
    const body = await req.json();
    if (body && typeof body.projectId === "string") projectId = body.projectId;
  } catch {
    // malformed body -> projectId stays empty, caught below
  }
  if (!projectId) {
    return NextResponse.json({ error: "Missing project." }, { status: 400 });
  }

  const result = await getProject(projectId);
  if (result.status !== "ok") {
    // Same non-distinction as every other read here: "doesn't exist" and
    // "exists but you're not a member" both read as 404, never leaking which.
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const project = result.project;

  // The agent now runs on ColaboFest projects too — resources only, no
  // checklist. A ColaboFest project comes pre-filled with SPARC's own nine
  // readiness items, and proposing six more of ours on top is what Chen
  // meant by overwhelming it; resource discovery has no such conflict, so
  // it's no longer withheld. `challenge_key` is forwarded to the backend
  // below, which is what actually skips the checklist step (and its LLM
  // call) for a challenge project — see run_project_agent_async's docstring
  // in tools/project_agent.py. Nothing is gated here anymore; the backend
  // enforces the resources-only behavior regardless of what a forged
  // request claims, same as every other field on this route.

  // Already-saved resource ids, so the agent excludes them BEFORE its
  // relevance pass rather than re-proposing them only to have them fail as
  // duplicates on accept. Best-effort: a failed lookup here shouldn't block
  // the run, it just means the agent won't know what's already saved this
  // time (same "degrade, don't block" stance as everything else on this
  // page's reads).
  let savedItemIds: string[] = [];
  const resourcesResult = await listProjectResources(projectId);
  if (resourcesResult.status === "ok") {
    savedItemIds = resourcesResult.resources.items.map((item) => item.id);
  } else {
    console.error("project-agent start: listProjectResources failed", resourcesResult.error);
  }

  // The project wiki's own memory — every note it already has, so
  // tools/wiki_agent.py can decide update-vs-create and build its own
  // capped "what did we already conclude" context. Same "degrade, don't
  // block" stance as the resources lookup above: a failed read just means
  // this run starts with no wiki memory, not that the run fails to start.
  let existingWikiNotes: unknown[] = [];
  const wikiResult = await listWikiNoteSummaries(projectId);
  if (wikiResult.status === "ok") {
    existingWikiNotes = wikiResult.notes;
  } else {
    console.error("project-agent start: listWikiNoteSummaries failed", wikiResult.error);
  }

  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/project-agent/start`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        name: project.name,
        description: project.description,
        target: project.target,
        indication: project.indication,
        modality: project.modality,
        stage: project.stage,
        challenge_key: project.challenge_key,
        existing_checklist: project.checklist.map((c) => c.label),
        saved_item_ids: savedItemIds,
        existing_wiki_notes: existingWikiNotes,
      }),
    });
    if (!res.ok) throw new Error(`agent backend responded ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("project-agent start proxy failed", e);
    return NextResponse.json(
      { error: "Couldn't start the agent. Please try again." },
      { status: 502 }
    );
  }
}
