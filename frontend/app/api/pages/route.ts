import { NextResponse } from "next/server";
import {
  DEFAULT_PAGE_VISIBILITY,
  getPagesServiceRoleClient,
  isPageVisibility,
  titleFromTopic,
} from "@/lib/server/pages/pagesDb";
import { createLivingPage } from "@/lib/server/pages/createPage";
import { getCurrentUser } from "@/lib/auth";

// POST /api/pages — create a topic-seeded "living page": a bare topic string
// in, a page whose wiki notes + evidence have already been researched and
// written out. The creation itself is lib/server/pages/createPage.ts, shared
// with the external agent's create_page tool.
//
// SYNCHRONOUS, ONE REQUEST: there is no pageId until this request creates one,
// so there is nothing to poll. This can legitimately take a minute (real
// searches plus an LLM call).
//
// VISIBILITY: the body takes `visibility` ('private' | 'team' | 'public',
// default 'private'). A private or team page needs a signed-in caller, who
// becomes its owner (owner_id = the session user, never a body field). A
// public page may also be created with no session: owner_id is then null (a
// site-created topic page; the table's CHECK allows a null owner only when
// public). A signed-in caller creating a public page owns it.
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

  const user = await getCurrentUser();
  if (!user && visibility !== "public") {
    return NextResponse.json(
      { error: "Sign in to create a private or team page." },
      { status: 401 }
    );
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
    ownerId: user?.id ?? null,
    title,
    topic,
    visibility,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    slug: result.slug,
    visibility: result.visibility,
    pageId: result.pageId,
    notes: result.notes,
    evidence: result.evidence,
    references: result.references,
    citationCheck: result.citationReport,
  });
}
