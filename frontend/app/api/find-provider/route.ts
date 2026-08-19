import { NextResponse } from "next/server";
import { getProject } from "@/lib/server/projects";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";
import type { FindProviderResponse } from "@/types/provider";

// Proxy for the Python backend's checklist "Find a service provider" action
// (see backend/explore-mcp/tools/find_provider.py and server.py's
// POST /api/find-provider). Same proxy pattern as /api/project-agent/start.
//
// ZERO LLM CALLS. The item's matched_capabilities were computed ONCE, at
// add/edit time (see lib/server/checklistClassify.ts), and are already
// sitting on the checklist row this route reads via getProject() below —
// this route never re-classifies, it only forwards those already-known
// terms to the backend's pure catalog search. That's what keeps a "Find a
// service provider" click as cheap as a plain search, not a second LLM
// round trip.
//
// AUTH/MEMBERSHIP: the backend has no notion of a Supabase session and never
// checks it, so THIS route is where membership actually gets enforced, via
// getProject()'s own RLS-backed "not_found covers both doesn't-exist and
// not-a-member" gate — same as every other project-scoped proxy in this app.
// The client sends only a projectId + itemId; the checklist item's actual
// label AND matched_capabilities are read server-side from the project the
// caller is verified to belong to, never trusted from the request body, so
// a forged request can't ask this route to search on behalf of a project
// the caller isn't on, or inject arbitrary capability terms.
//
// Resilience contract: mirrors the other proxies — never 500s the page. On
// any failure (backend down/slow, catalog down/slow) this returns
// { matched_capabilities: [], providers: [], count: 0, error: true } with
// HTTP 200, so the results section can render a clean fallback message
// instead of breaking the page.

export async function POST(req: Request) {
  let projectId = "";
  let itemId = "";
  try {
    const body = await req.json();
    if (body && typeof body.projectId === "string") projectId = body.projectId;
    if (body && typeof body.itemId === "string") itemId = body.itemId;
  } catch {
    // malformed body -> both stay empty, caught below
  }
  if (!projectId || !itemId) {
    return NextResponse.json({ error: "Missing project or checklist item." }, { status: 400 });
  }

  const result = await getProject(projectId);
  if (result.status !== "ok") {
    // Same non-distinction as every other read here: "doesn't exist" and
    // "exists but you're not a member" both read as 404 — a non-member
    // cannot reach the backend through this route either way.
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const item = result.project.checklist.find((i) => i.id === itemId);
  if (!item) {
    return NextResponse.json({ error: "Checklist item not found." }, { status: 404 });
  }

  // Nothing to search — the button shouldn't even be showing for an item
  // with no matched capabilities, but handle it defensively rather than
  // spend a catalog round trip proving what's already known.
  if (item.matched_capabilities.length === 0) {
    return NextResponse.json({
      item_text: item.label,
      matched_capabilities: [],
      providers: [],
      count: 0,
    });
  }

  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/find-provider`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ item_text: item.label, capabilities: item.matched_capabilities }),
    });
    if (!res.ok) throw new Error(`find-provider backend responded ${res.status}`);

    const data = (await res.json()) as FindProviderResponse;
    if (data.error) throw new Error(typeof data.error === "string" ? data.error : "backend error");

    return NextResponse.json({
      item_text: data.item_text ?? item.label,
      matched_capabilities: data.matched_capabilities ?? item.matched_capabilities,
      providers: data.providers ?? [],
      count: data.count ?? 0,
    });
  } catch {
    return NextResponse.json(
      {
        item_text: item.label,
        matched_capabilities: item.matched_capabilities,
        providers: [],
        count: 0,
        error: true,
      },
      { status: 200 }
    );
  }
}
