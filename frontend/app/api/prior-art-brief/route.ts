import { NextResponse } from "next/server";
import { getProject } from "@/lib/server/projects";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";

// POST /api/prior-art-brief — proxy to the Python backend's
// POST /api/prior-art-brief (see backend/explore-mcp/tools/prior_art_brief.py
// and server.py). Same proxy pattern as /api/project-agent/start.
//
// AVAILABLE ON EVERY PROJECT, INCLUDING COLABOFEST — unlike /api/project-agent
// (gated off ColaboFest because it PUSHES proposals into a workspace that
// already has nine readiness items), this is PULL-based: a member clicks
// "Generate," nothing is proposed unprompted, and it serves a published
// ColaboFest review criterion ("Rigor and innovation — differentiation from
// existing approaches") directly. Same reasoning as ProjectChatbot's own
// ColaboFest availability — see components/projects/ProjectChatbot.tsx.
//
// AUTH/MEMBERSHIP: the backend has no auth of its own yet and never touches
// Supabase, so THIS route is where membership is actually checked, via
// getProject()'s RLS-backed "not_found covers both doesn't-exist and
// not-a-member" gate — same as every other project-scoped route. The client
// sends only a projectId; every field the brief reasons over (name,
// description, target, indication, modality, stage) is read server-side from
// the project the caller is verified to belong to, never trusted from the
// request body.
//
// WRITES NOTHING — this route and the backend behind it only ever return a
// generated document. Persisting it belongs to the project wiki once that
// exists (see the brief generator's own module docstring); not blocked on
// here.

export const maxDuration = 60;

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

  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/prior-art-brief`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        name: project.name,
        description: project.description,
        target: project.target,
        indication: project.indication,
        modality: project.modality,
        stage: project.stage,
      }),
    });
    const data = await res.json();
    if (!res.ok || typeof data.markdown !== "string") {
      return NextResponse.json(
        { error: data.error || "Couldn't generate the brief right now." },
        { status: res.ok ? 502 : res.status }
      );
    }
    return NextResponse.json(data);
  } catch (e) {
    console.error("prior-art-brief proxy failed", e);
    return NextResponse.json({ error: "Couldn't reach the brief generator." }, { status: 502 });
  }
}
