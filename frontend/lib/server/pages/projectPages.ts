// lib/server/pages/projectPages.ts — wiki pages that belong to a project.
//
// Reads and the create go through the caller's OWN session (RLS decides who can
// see or add pages; see database/migrations/2026-10-26_project_wiki_pages.sql).
// A new project page is a team-visibility wiki page seeded from the title the
// user typed, then filled by the same generation code as every other page
// (createLivingPage); the daily refresh picks it up like any page.

import { requireCurrentUser } from "@/lib/auth";
import { createLivingPage } from "@/lib/server/pages/createPage";
import { parseWikiTitle, type ProjectPageRow } from "@/lib/server/projectWorkspace/workspace";

export type ProjectPage = ProjectPageRow & {
  visibility: string;
  last_refreshed_at: string | null;
};

export type ListProjectPagesResult =
  | { status: "ok"; pages: ProjectPage[] }
  | { status: "error"; error: string };

/** Every wiki page attached to the project that the caller may read. */
export async function listProjectPages(projectId: string): Promise<ListProjectPagesResult> {
  const { db } = await requireCurrentUser();
  const { data, error } = await db
    .from("pages")
    .select("id, slug, title, parent_page_id, visibility, last_refreshed_at, created_at")
    .eq("project_id", projectId);
  if (error) {
    console.error("listProjectPages failed", error);
    return { status: "error", error: "Couldn't load the wiki pages." };
  }
  return { status: "ok", pages: (data ?? []) as ProjectPage[] };
}

export type CreateProjectPageResult =
  | { status: "ok"; slug: string }
  | { status: "error"; error: string };

export async function createProjectPage(input: {
  projectId: string;
  title: unknown;
  parentPageId?: string | null;
}): Promise<CreateProjectPageResult> {
  const parsed = parseWikiTitle(input.title);
  if (!parsed.ok) return { status: "error", error: parsed.error };

  const { user, db } = await requireCurrentUser();

  // Members only (the database checks this again).
  const { data: member, error: memberErr } = await db
    .from("project_members")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("user_id", user.id)
    .limit(1);
  if (memberErr || !member || member.length === 0) {
    return { status: "error", error: "Only members of this project can add wiki pages." };
  }

  // A sub-page's parent must be a page of this same project.
  let parentPageId: string | undefined;
  if (input.parentPageId) {
    const { data: parent } = await db
      .from("pages")
      .select("id")
      .eq("id", input.parentPageId)
      .eq("project_id", input.projectId)
      .maybeSingle();
    if (!parent) return { status: "error", error: "That parent page isn't in this project." };
    parentPageId = parent.id as string;
  }

  const result = await createLivingPage({
    insertDb: db,
    ownerId: user.id,
    title: parsed.title,
    topic: parsed.title,
    visibility: "team",
    projectId: input.projectId,
    parentPageId,
  });
  if (!result.ok) return { status: "error", error: result.error };
  return { status: "ok", slug: result.slug };
}
