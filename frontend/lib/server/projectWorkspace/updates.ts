// lib/server/projectWorkspace/updates.ts — the Updates tab's database calls.
//
// Everything goes through the caller's own session, so row-level security is the
// gate (2026-10-27_project_updates.sql): members read, post as themselves and
// may not post announcements unless lead or manager; the author or a lead or
// manager deletes; only a lead or manager may resolve a help post. The role
// checks here are for clear messages; the rules live in the database.

import { requireCurrentUser } from "@/lib/auth";
import { canResolve, parseUpdatePost } from "@/lib/server/projectWorkspace/status";

export type ProjectUpdate = {
  id: string;
  kind: "update" | "announcement" | "help";
  body: string;
  created_at: string;
  resolved_at: string | null;
  author_name: string | null;
  /** true when the viewer wrote it (the author id itself is not sent to the page) */
  is_mine: boolean;
};

export type ListUpdatesResult =
  | { status: "ok"; updates: ProjectUpdate[] }
  | { status: "error"; error: string };

export type UpdateWriteResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

const MAX_ROWS = 300;

export async function listProjectUpdates(projectId: string): Promise<ListUpdatesResult> {
  const { user, db } = await requireCurrentUser();
  const { data, error } = await db
    .from("project_updates")
    .select("id, author_id, kind, body, resolved_at, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) {
    console.error("listProjectUpdates failed", error);
    return { status: "error", error: "Couldn't load the updates." };
  }
  const rows = (data ?? []) as {
    id: string;
    author_id: string;
    kind: ProjectUpdate["kind"];
    body: string;
    resolved_at: string | null;
    created_at: string;
  }[];

  const names = new Map<string, string>();
  const { data: people } = await db.rpc("project_member_names", { project_ids: [projectId] });
  for (const p of (people ?? []) as { user_id: string; name: string | null }[]) {
    if (p.name) names.set(p.user_id, p.name);
  }

  return {
    status: "ok",
    updates: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      body: r.body,
      created_at: r.created_at,
      resolved_at: r.resolved_at,
      author_name: names.get(r.author_id) ?? null,
      is_mine: r.author_id === user.id,
    })),
  };
}

async function myRole(db: Awaited<ReturnType<typeof requireCurrentUser>>["db"], projectId: string, userId: string) {
  const { data } = await db
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as string | undefined) ?? null;
}

export async function postProjectUpdate(projectId: string, kind: unknown, body: unknown): Promise<UpdateWriteResult> {
  const { user, db } = await requireCurrentUser();
  const role = await myRole(db, projectId, user.id);
  if (!role) return { status: "forbidden", error: "Only members of this project can post." };

  const parsed = parseUpdatePost(kind, body, role);
  if (!parsed.ok) return { status: "error", error: parsed.error };

  // No RETURNING: the page re-reads the list afterwards.
  const { error } = await db.from("project_updates").insert({
    id: globalThis.crypto.randomUUID(),
    project_id: projectId,
    author_id: user.id,
    kind: parsed.value.kind,
    body: parsed.value.body,
  });
  if (error) {
    if ((error as { code?: string }).code === "42501") {
      return { status: "forbidden", error: "You can't post that here." };
    }
    console.error("postProjectUpdate failed", error);
    return { status: "error", error: "Couldn't post that. Please try again." };
  }
  return { status: "ok" };
}

export async function deleteProjectUpdate(projectId: string, updateId: string): Promise<UpdateWriteResult> {
  const { db } = await requireCurrentUser();
  const { data, error } = await db
    .from("project_updates")
    .delete()
    .eq("id", updateId)
    .eq("project_id", projectId)
    .select("id");
  if (error) {
    console.error("deleteProjectUpdate failed", error);
    return { status: "error", error: "Couldn't delete that post." };
  }
  if (!data || data.length === 0) {
    return { status: "forbidden", error: "Only the author, a lead or a manager can delete a post." };
  }
  return { status: "ok" };
}

/** Mark a help post resolved (or reopen it). Lead or manager only. */
export async function setHelpResolved(projectId: string, updateId: string, resolved: boolean): Promise<UpdateWriteResult> {
  const { user, db } = await requireCurrentUser();
  const role = await myRole(db, projectId, user.id);
  if (!canResolve(role)) return { status: "forbidden", error: "Only a lead or manager can mark this resolved." };

  const { data, error } = await db
    .from("project_updates")
    .update({ resolved_at: resolved ? new Date().toISOString() : null })
    .eq("id", updateId)
    .eq("project_id", projectId)
    .eq("kind", "help")
    .select("id");
  if (error) {
    console.error("setHelpResolved failed", error);
    return { status: "error", error: "Couldn't update that post." };
  }
  if (!data || data.length === 0) return { status: "forbidden", error: "Only a lead or manager can mark this resolved." };
  return { status: "ok" };
}

/** Unresolved help posts of a project, newest first (Overview's "Needs help"
 *  banner). Best effort: an error is an empty list. */
export async function listOpenHelp(projectId: string): Promise<{ id: string; body: string; created_at: string }[]> {
  const { db } = await requireCurrentUser();
  const { data, error } = await db
    .from("project_updates")
    .select("id, body, created_at")
    .eq("project_id", projectId)
    .eq("kind", "help")
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("listOpenHelp failed", error);
    return [];
  }
  return (data ?? []) as { id: string; body: string; created_at: string }[];
}
