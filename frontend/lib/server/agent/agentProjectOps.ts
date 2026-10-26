// lib/server/agent/agentProjectOps.ts — what the assistant can say about a
// researcher's projects: the list, and one project's status. Read-only, and read
// with the researcher's OWN database client (the token-bound or session one the
// caller passes in), so row-level security decides what comes back: a project the
// researcher is not on simply is not there. No service role.
//
// Imports are relative and pure on purpose so `npm test` can run it with a fake
// database client.

import { COLABOFEST_PROGRAM } from "../../projectTypes.ts";
import { buildProjectStatus, type StatusInput, todayIso } from "../projectWorkspace/status.ts";
import { projectLabel } from "../projectWorkspace/workspace.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type ProjectListItem = {
  id: string;
  name: string;
  /** "ColaboFest 2026" for a challenge project, else null. */
  label: string | null;
  challenge_key: string | null;
  /** projects.program: "colabofest_2026" for a project in the ColaboFest program. */
  program: string | null;
  my_role: string;
  team_size: number;
};

export type ProjectStatus = ReturnType<typeof buildProjectStatus> & { id: string };

export type ProjectOps = {
  list(db: Db, userId: string): Promise<ProjectListItem[]>;
  /** One project's status, or null when it does not exist or the researcher is not on it. */
  status(db: Db, projectId: string, now?: Date): Promise<ProjectStatus | null>;
};

type Row = Record<string, unknown>;

export const realProjectOps: ProjectOps = {
  async list(db, userId) {
    const { data: mine, error } = await db.from("project_members").select("project_id, role").eq("user_id", userId);
    if (error) throw error;
    const mineRows = (mine ?? []) as Row[];
    if (mineRows.length === 0) return [];
    const ids = mineRows.map((m) => m.project_id as string);

    const [projects, members] = await Promise.all([
      db.from("projects").select("id, name, challenge_key, program").in("id", ids).order("name", { ascending: true }),
      db.from("project_members").select("project_id").in("project_id", ids),
    ]);
    if (projects.error) throw projects.error;
    if (members.error) throw members.error;

    const sizes = new Map<string, number>();
    for (const m of (members.data ?? []) as Row[]) {
      const k = m.project_id as string;
      sizes.set(k, (sizes.get(k) ?? 0) + 1);
    }
    const role = new Map(mineRows.map((m) => [m.project_id as string, m.role as string]));
    return ((projects.data ?? []) as Row[]).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      label: projectLabel(((p.program ?? p.challenge_key) as string | null) ?? null),
      challenge_key: (p.challenge_key as string | null) ?? null,
      program: (p.program as string | null) ?? null,
      my_role: role.get(p.id as string) ?? "member",
      team_size: sizes.get(p.id as string) ?? 0,
    }));
  },

  async status(db, projectId, now = new Date()) {
    const { data: project, error } = await db
      .from("projects")
      .select("id, name, challenge_key, program, created_at")
      .eq("id", projectId)
      .maybeSingle();
    if (error) throw error;
    if (!project) return null;

    // The projects row is also readable by a member of the project's community.
    // project_members is readable only by the project's own members, so a row
    // here means the caller is on the project; none means they are not.
    const { data: onProject, error: onErr } = await db
      .from("project_members")
      .select("id")
      .eq("project_id", projectId)
      .limit(1);
    if (onErr) throw onErr;
    if (!onProject || onProject.length === 0) return null;

    const [items, updates, pages, names] = await Promise.all([
      db
        .from("checklist_items")
        .select("label, status, position, list_key, due_date, assignee_id")
        .eq("project_id", projectId),
      db
        .from("project_updates")
        .select("kind, body, created_at, resolved_at, author_id, id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(100),
      db.from("pages").select("title").eq("project_id", projectId).order("created_at", { ascending: true }).limit(50),
      db.rpc("project_member_names", { project_ids: [projectId] }),
    ]);
    for (const r of [items, updates, pages]) if (r.error) throw r.error;

    const nameOf = new Map<string, string>();
    for (const n of ((names.data ?? []) as Row[])) {
      if (n.name) nameOf.set(n.user_id as string, n.name as string);
    }

    const input: StatusInput = {
      name: project.name as string,
      isChallenge: !!project.challenge_key || !!project.program,
      createdAt: (project.created_at as string | null) ?? null,
      today: todayIso(now),
      now,
      items: ((items.data ?? []) as Row[]).map((i) => ({
        label: i.label as string,
        status: i.status as string,
        position: i.position as number,
        list_key: i.list_key as string,
        due_date: (i.due_date as string | null) ?? null,
        assignee_name: i.assignee_id ? nameOf.get(i.assignee_id as string) ?? null : null,
      })),
      updates: ((updates.data ?? []) as Row[]).map((u) => ({
        id: u.id as string,
        kind: u.kind as string,
        body: u.body as string,
        created_at: u.created_at as string,
        resolved_at: (u.resolved_at as string | null) ?? null,
        author_name: nameOf.get(u.author_id as string) ?? null,
      })),
      wikiTitles: ((pages.data ?? []) as Row[]).map((p) => p.title as string),
    };
    return { id: project.id as string, ...buildProjectStatus(input) };
  },
};

/** Status of every project the researcher is on (at most `max`), optionally only
 *  the ColaboFest ones. Used by the assistant's "status of my projects". */
export async function statusOfMyProjects(
  ops: ProjectOps,
  db: Db,
  userId: string,
  opts: { colabofestOnly?: boolean; max?: number; now?: Date } = {}
): Promise<{ projects: ProjectStatus[]; total: number }> {
  const all = await ops.list(db, userId);
  const picked = all.filter((p) => !opts.colabofestOnly || p.program === COLABOFEST_PROGRAM);
  const limited = picked.slice(0, opts.max ?? 8);
  const out: ProjectStatus[] = [];
  for (const p of limited) {
    const s = await ops.status(db, p.id, opts.now);
    if (s) out.push(s);
  }
  return { projects: out, total: picked.length };
}

