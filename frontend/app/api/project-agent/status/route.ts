import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { saveProjectDigest } from "@/lib/server/projects";
import { saveWikiNotes, type WikiNoteProposal } from "@/lib/server/wikiNotes";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";

// Poll a project-agent job's progress/result. Proxies to the Python
// backend's GET /api/project-agent/status?job_id=<id>.
//
// job_id itself is an unguessable UUID minted by the backend and the poll
// result carries nothing more sensitive than what /start's own response
// already would (search results + proposed checklist text, no project
// internals beyond what the caller supplied to start the run) — so this
// route only requires a signed-in caller, not a re-check of project
// membership on every poll. The real membership gate is on /start, above.
//
// DIGEST PERSISTENCE happens HERE, server-side, the moment a run comes back
// done with a digest — never from a client POST (see saveProjectDigest's
// own docstring: "that's a write path we don't need"). `project_id` rides
// along as a query param (the client already knows it — it's the page
// it's on) purely so this route knows WHICH project's digest to save;
// membership itself is enforced by RLS on the upsert, not re-checked here
// with a getProject() call — a caller who forges a project_id they don't
// belong to simply gets a denied write (see saveProjectDigest), same as
// every other RLS-gated write in this codebase. Missing/invalid
// project_id, or a save failure, both degrade silently: the run's result
// still returns to the client either way — PERSISTENCE IS A CONVENIENCE,
// NOT A DEPENDENCY.

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to check the agent's progress." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("job_id") ?? "";
  const projectId = searchParams.get("project_id") ?? "";
  if (!jobId) {
    return NextResponse.json({ error: "Missing job_id." }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${EXPLORE_API_URL}/api/project-agent/status?job_id=${encodeURIComponent(jobId)}`,
      { headers: exploreBackendHeaders() }
    );
    const data = await res.json();

    if (projectId && data?.status === "done" && data?.result?.digest) {
      try {
        const saved = await saveProjectDigest(projectId, data.result.digest);
        if (saved.status !== "ok") {
          console.error("project-agent status: saveProjectDigest failed", saved.error);
        }
      } catch (e) {
        // Never let a persistence failure affect the response the client
        // is waiting on — the run already succeeded, digest saving is
        // purely a side effect of reporting it back.
        console.error("project-agent status: saveProjectDigest threw", e);
      }
    }

    // WIKI NOTES PERSISTENCE — same "here, server-side, the moment a run
    // comes back done" placement as the digest above, and the same
    // best-effort stance: never let a save failure affect the response the
    // client is waiting on.
    if (projectId && data?.status === "done" && Array.isArray(data?.result?.wiki_notes)) {
      try {
        const notes = data.result.wiki_notes as WikiNoteProposal[];
        const saved = await saveWikiNotes(projectId, notes);
        if (saved.status !== "ok") {
          console.error("project-agent status: saveWikiNotes failed", saved.error);
        }
      } catch (e) {
        console.error("project-agent status: saveWikiNotes threw", e);
      }
    }

    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("project-agent status proxy failed", e);
    return NextResponse.json(
      { status: "error", stage: null, result: null, error: "Couldn't reach the agent." },
      { status: 502 }
    );
  }
}
