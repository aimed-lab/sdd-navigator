import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
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

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to check the agent's progress." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("job_id") ?? "";
  if (!jobId) {
    return NextResponse.json({ error: "Missing job_id." }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${EXPLORE_API_URL}/api/project-agent/status?job_id=${encodeURIComponent(jobId)}`,
      { headers: exploreBackendHeaders() }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("project-agent status proxy failed", e);
    return NextResponse.json(
      { status: "error", stage: null, result: null, error: "Couldn't reach the agent." },
      { status: 502 }
    );
  }
}
