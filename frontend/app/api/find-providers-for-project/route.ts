import { NextResponse } from "next/server";
import { getProject } from "@/lib/server/projects";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";
import type { FindProvidersForProjectResponse } from "@/types/provider";

// Proxy for the Python backend's project-level "who can help with this
// project" lookup (see backend/explore-mcp/tools/find_provider.py's
// find_providers_for_project_async and server.py's
// POST /api/find-providers-for-project). Same proxy pattern as
// /api/find-provider, one level up: instead of one checklist item's
// capabilities, this forwards EVERY item's — id, label, and
// matched_capabilities, all already stored, all already classified.
//
// ZERO LLM CALLS, ZERO NEW CLASSIFICATION. Same reasoning as
// /api/find-provider's own comment: matched_capabilities was computed once
// per item, at add/edit time. This route only reads what's already on the
// project's checklist rows (via getProject()) and forwards it — the
// backend does one catalog search over the combined set, not one per item.
//
// AUTH/MEMBERSHIP: same as /api/find-provider — the backend has no notion
// of a Supabase session, so THIS route is where membership is enforced,
// via getProject()'s RLS-backed "not_found covers both doesn't-exist and
// not-a-member" gate. The client sends only a projectId; every checklist
// item's label and matched_capabilities are read server-side from the
// project the caller is verified to belong to, never trusted from the
// request body.
//
// Resilience contract: mirrors /api/find-provider. On any failure (backend
// down/slow, catalog down/slow) this returns
// { providers: [], items_with_capabilities: 0, total_items: 0, error: true }
// with HTTP 200 — so the section can distinguish "the catalog is
// unavailable" from "searched and found nothing" rather than showing the
// same empty state for both.

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
    // "exists but you're not a member" both read as 404.
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const checklistItems = result.project.checklist.map((item) => ({
    id: item.id,
    label: item.label,
    matched_capabilities: item.matched_capabilities,
  }));

  // Nothing to search — the section shouldn't even be fetching for a
  // project with no checklist items at all, but handle it defensively
  // rather than spend a round trip to the backend proving what's already
  // known.
  if (checklistItems.length === 0) {
    return NextResponse.json({ providers: [], items_with_capabilities: 0, total_items: 0 });
  }

  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/find-providers-for-project`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ checklist_items: checklistItems }),
    });
    if (!res.ok) throw new Error(`find-providers-for-project backend responded ${res.status}`);

    const data = (await res.json()) as FindProvidersForProjectResponse;
    if (data.error) throw new Error(typeof data.error === "string" ? data.error : "backend error");

    return NextResponse.json({
      providers: data.providers ?? [],
      items_with_capabilities: data.items_with_capabilities ?? 0,
      total_items: data.total_items ?? checklistItems.length,
    });
  } catch {
    return NextResponse.json(
      {
        providers: [],
        items_with_capabilities: 0,
        total_items: checklistItems.length,
        error: true,
      },
      { status: 200 }
    );
  }
}
