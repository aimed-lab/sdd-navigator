import { NextResponse } from "next/server";
import {
  DEFAULT_PAGE_VISIBILITY,
  getPagesServiceRoleClient,
  isPageVisibility,
  titleFromTopic,
} from "@/lib/server/pages/pagesDb";
import { createLivingPage } from "@/lib/server/pages/createPage";
import { getCurrentUser } from "@/lib/auth";
import { addPageToTeam } from "@/lib/server/teams/teams";
import { parseTeamId } from "@/lib/server/teams/teamRules";

// POST /api/pages — create a topic-seeded "wiki page": a bare topic string
// in, a page whose wiki notes + evidence have already been researched and
// written out. The creation itself is lib/server/pages/createPage.ts, shared
// with the external agent's create_page tool.
//
// SYNCHRONOUS, ONE REQUEST: there is no pageId until this request creates one,
// so there is nothing to poll. This can legitimately take a minute (real
// searches plus an LLM call).
//
// VISIBILITY: the body takes `visibility` ('private' | 'team' | 'public',
// default 'private'). The caller must be signed in (401 otherwise) and becomes
// the page's owner (owner_id = the session user, never a body field).
//
// TEAM: an optional `team_id` (a team the signed-in caller is on) curates the
// new page into that team ("Made by AI" on the team page). The page is created
// first and added second, with the caller's own session, so the database still
// decides whether they may add to that team. If adding fails the page is kept
// and the response says so (`team.added: false`).
//
// The `pages` row is inserted with the service-role client because an
// ownerless page has no session to scope to; see 2026-10-20_living_pages.sql.

// Researching and writing a page takes about a minute; give the platform room.
export const maxDuration = 300;

const MIN_TOPIC_LEN = 3;
const MAX_TOPIC_LEN = 200;

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
  // Only the assistant panel calls this, and the panel needs sign-in: no
  // session, no page (public or not), before anything is read or created.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to create a page." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const validated = validateTopic(fields.topic);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { topic } = validated;

  if (fields.visibility !== undefined && !isPageVisibility(fields.visibility)) {
    return NextResponse.json(
      { error: "visibility must be 'private', 'team' or 'public'." },
      { status: 400 }
    );
  }
  const visibility = isPageVisibility(fields.visibility) ? fields.visibility : DEFAULT_PAGE_VISIBILITY;

  const teamId = fields.team_id === undefined ? null : parseTeamId(fields.team_id);
  if (fields.team_id !== undefined && !teamId) {
    return NextResponse.json({ error: "team_id must be a team id." }, { status: 400 });
  }
  const db = getPagesServiceRoleClient();
  if (!db) {
    return NextResponse.json(
      { error: "Server misconfigured: pages feature has no service-role Supabase client." },
      { status: 500 }
    );
  }

  // The assistant proposes its own page title; use it when it is a sane length,
  // else derive one from the topic.
  const given = typeof fields.title === "string" ? fields.title.trim().replace(/\s+/g, " ") : "";
  const title = given.length >= 3 && given.length <= 120 ? given : titleFromTopic(topic);

  const result = await createLivingPage({
    insertDb: db,
    ownerId: user.id,
    title,
    topic,
    visibility,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  let team: { added: boolean; error?: string } | undefined;
  if (teamId) {
    try {
      const added = await addPageToTeam(teamId, result.pageId, "made");
      team = added.status === "ok" ? { added: true } : { added: false, error: added.error };
    } catch (e) {
      console.error("POST /api/pages: adding the page to the team failed", e);
      team = { added: false, error: "The page was made but could not be added to the team." };
    }
  }

  return NextResponse.json({
    ...(team ? { team } : {}),
    slug: result.slug,
    visibility: result.visibility,
    pageId: result.pageId,
    notes: result.notes,
    evidence: result.evidence,
    references: result.references,
    citationCheck: result.citationReport,
  });
}
