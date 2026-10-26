// lib/server/projectWorkspace/discussions.ts: the Discussions tab's database calls.
//
// Everything goes through the caller's own session, so row-level security is the
// gate (2026-10-31_project_announcements_discussions.sql): members read, start
// threads and reply; the author, a project lead or a site admin deletes. The
// checks here give clear messages; the rules live in the database. Plain text
// only, no attachments.

import { requireCurrentUser } from "@/lib/auth";
import { parseReply, parseThread, sortThreads } from "@/lib/server/projectWorkspace/colabofest";

export type Thread = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  last_activity_at: string;
  author_name: string | null;
  /** true when the viewer wrote it (the author id itself is not sent to the page) */
  is_mine: boolean;
  reply_count: number;
};

export type Reply = {
  id: string;
  body: string;
  created_at: string;
  author_name: string | null;
  is_mine: boolean;
};

export type ThreadWriteResult =
  | { status: "ok"; id?: string }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

const MAX_THREADS = 200;
const MAX_REPLIES = 500;

type Db = Awaited<ReturnType<typeof requireCurrentUser>>["db"];

async function namesOf(db: Db, projectId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const { data } = await db.rpc("project_member_names", { project_ids: [projectId] });
  for (const p of (data ?? []) as { user_id: string; name: string | null }[]) {
    if (p.name) names.set(p.user_id, p.name);
  }
  return names;
}

export async function listThreads(projectId: string, limit = MAX_THREADS): Promise<{ status: "ok"; threads: Thread[] } | { status: "error"; error: string }> {
  const { user, db } = await requireCurrentUser();
  const { data, error } = await db
    .from("project_threads")
    .select("id, author_id, title, body, created_at, last_activity_at")
    .eq("project_id", projectId)
    .order("last_activity_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listThreads failed", error);
    return { status: "error", error: "Couldn't load the discussions." };
  }
  const rows = (data ?? []) as { id: string; author_id: string; title: string; body: string; created_at: string; last_activity_at: string }[];

  const counts = new Map<string, number>();
  if (rows.length > 0) {
    const { data: replies } = await db
      .from("project_thread_replies")
      .select("thread_id")
      .eq("project_id", projectId)
      .in("thread_id", rows.map((r) => r.id))
      .limit(5000);
    for (const r of (replies ?? []) as { thread_id: string }[]) counts.set(r.thread_id, (counts.get(r.thread_id) ?? 0) + 1);
  }
  const names = await namesOf(db, projectId);

  return {
    status: "ok",
    threads: sortThreads(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        created_at: r.created_at,
        last_activity_at: r.last_activity_at,
        author_name: names.get(r.author_id) ?? null,
        is_mine: r.author_id === user.id,
        reply_count: counts.get(r.id) ?? 0,
      }))
    ),
  };
}

export async function getThread(
  projectId: string,
  threadId: string
): Promise<{ status: "ok"; thread: Thread; replies: Reply[] } | { status: "not_found" } | { status: "error"; error: string }> {
  const { user, db } = await requireCurrentUser();
  const { data: row, error } = await db
    .from("project_threads")
    .select("id, author_id, title, body, created_at, last_activity_at")
    .eq("id", threadId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    console.error("getThread failed", error);
    return { status: "error", error: "Couldn't load that discussion." };
  }
  if (!row) return { status: "not_found" };

  const { data: replyRows, error: replyErr } = await db
    .from("project_thread_replies")
    .select("id, author_id, body, created_at")
    .eq("thread_id", threadId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(MAX_REPLIES);
  if (replyErr) {
    console.error("getThread replies failed", replyErr);
    return { status: "error", error: "Couldn't load the replies." };
  }
  const replies = (replyRows ?? []) as { id: string; author_id: string; body: string; created_at: string }[];
  const names = await namesOf(db, projectId);

  return {
    status: "ok",
    thread: {
      id: row.id as string,
      title: row.title as string,
      body: row.body as string,
      created_at: row.created_at as string,
      last_activity_at: row.last_activity_at as string,
      author_name: names.get(row.author_id as string) ?? null,
      is_mine: row.author_id === user.id,
      reply_count: replies.length,
    },
    replies: replies.map((r) => ({
      id: r.id,
      body: r.body,
      created_at: r.created_at,
      author_name: names.get(r.author_id) ?? null,
      is_mine: r.author_id === user.id,
    })),
  };
}

export async function createThread(projectId: string, title: unknown, body: unknown): Promise<ThreadWriteResult> {
  const { user, db } = await requireCurrentUser();
  const parsed = parseThread(title, body);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  const id = globalThis.crypto.randomUUID();
  // No RETURNING: the page re-reads the list afterwards.
  const { error } = await db.from("project_threads").insert({
    id,
    project_id: projectId,
    author_id: user.id,
    title: parsed.title,
    body: parsed.body,
  });
  if (error) {
    if ((error as { code?: string }).code === "42501") {
      return { status: "forbidden", error: "Only members of this project can start a discussion." };
    }
    console.error("createThread failed", error);
    return { status: "error", error: "Couldn't start the discussion. Please try again." };
  }
  return { status: "ok", id };
}

export async function addReply(projectId: string, threadId: string, body: unknown): Promise<ThreadWriteResult> {
  const { user, db } = await requireCurrentUser();
  const parsed = parseReply(body);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  const { error } = await db.from("project_thread_replies").insert({
    id: globalThis.crypto.randomUUID(),
    thread_id: threadId,
    project_id: projectId,
    author_id: user.id,
    body: parsed.body,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return { status: "forbidden", error: "Only members of this project can reply." };
    if (code === "23503") return { status: "error", error: "That discussion no longer exists." };
    console.error("addReply failed", error);
    return { status: "error", error: "Couldn't post the reply. Please try again." };
  }
  return { status: "ok" };
}

export async function deleteThread(projectId: string, threadId: string): Promise<ThreadWriteResult> {
  const { db } = await requireCurrentUser();
  const { data, error } = await db
    .from("project_threads")
    .delete()
    .eq("id", threadId)
    .eq("project_id", projectId)
    .select("id");
  if (error) {
    console.error("deleteThread failed", error);
    return { status: "error", error: "Couldn't delete that discussion." };
  }
  if (!data || data.length === 0) {
    return { status: "forbidden", error: "Only the author, a project lead or a site admin can delete a discussion." };
  }
  return { status: "ok" };
}

export async function deleteReply(projectId: string, replyId: string): Promise<ThreadWriteResult> {
  const { db } = await requireCurrentUser();
  const { data, error } = await db
    .from("project_thread_replies")
    .delete()
    .eq("id", replyId)
    .eq("project_id", projectId)
    .select("id");
  if (error) {
    console.error("deleteReply failed", error);
    return { status: "error", error: "Couldn't delete that reply." };
  }
  if (!data || data.length === 0) {
    return { status: "forbidden", error: "Only the author, a project lead or a site admin can delete a reply." };
  }
  return { status: "ok" };
}
