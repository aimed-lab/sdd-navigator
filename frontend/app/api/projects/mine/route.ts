import { NextResponse } from "next/server";
import { listMyProjects } from "@/lib/server/projects";

// GET /api/projects/mine -> { projects: { id, name }[] }
//
// Feeds SaveItemPicker.tsx's "Save to one of my projects" list. That
// component is a client component rendered from a page that must NOT pull
// lib/server/projects.ts in directly (it transitively imports next/headers),
// same fetch-on-open pattern as the nav's unseen-inbox badge and Explore's
// own CommunitiesResultsSection.
//
// Trimmed to {id, name} — the picker only ever needs enough to label a
// button, not member_count/deadline/challenge_key/proposal_submitted, which
// listMyProjects() computes for the full /projects page.

export const dynamic = "force-dynamic"; // depends on the session

export async function GET() {
  try {
    const result = await listMyProjects();
    const projects = result.status === "ok" ? result.projects.map((p) => ({ id: p.id, name: p.name })) : [];
    return NextResponse.json({ projects }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // A failing picker list must never break the picker itself — same
    // "never break the page over a widget" discipline as every other
    // fetch-on-mount route in this codebase.
    console.error("projects/mine failed", e);
    return NextResponse.json({ projects: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
