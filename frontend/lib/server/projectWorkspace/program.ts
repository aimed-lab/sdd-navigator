// lib/server/projectWorkspace/program.ts — the ColaboFest 2026 program view.
//
// A lead or manager of at least one ColaboFest project sees every ColaboFest
// project they are a member of, one card each. Everything is read through the
// caller's own session, so row-level security decides what comes back (a member
// sees their own projects' rows and nobody else's); there are no service-role
// reads. The card is built by the pure buildProgramCard (status.ts).

import { getCurrentUser, getDb } from "@/lib/auth";
import { COLABOFEST_PROGRAM } from "@/lib/projectTypes";
import {
  buildProgramCard,
  canSeeProgram,
  type ProgramCard,
} from "@/lib/server/projectWorkspace/status";

type Row = Record<string, unknown>;

/** The viewer's lead/manager memberships joined with their project's challenge
 *  key. Empty when signed out. */
async function myStaffProjects(): Promise<{ db: NonNullable<Awaited<ReturnType<typeof getDb>>>; userId: string; rows: { project_id: string; role: string; program: string | null }[] } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const db = await getDb();
  if (!db) return null;
  const { data: mine, error } = await db
    .from("project_members")
    .select("project_id, role")
    .eq("user_id", user.id)
    .in("role", ["lead", "manager"]);
  if (error || !mine || mine.length === 0) return { db, userId: user.id, rows: [] };
  const { data: projects } = await db
    .from("projects")
    .select("id, program")
    .in("id", (mine as Row[]).map((m) => m.project_id as string));
  const key = new Map(((projects ?? []) as Row[]).map((p) => [p.id as string, (p.program as string | null) ?? null]));
  return {
    db,
    userId: user.id,
    rows: (mine as Row[]).map((m) => ({
      project_id: m.project_id as string,
      role: m.role as string,
      program: key.get(m.project_id as string) ?? null,
    })),
  };
}

/** May the viewer see the program page / get a link to it? */
export async function hasProgramAccess(): Promise<boolean> {
  const mine = await myStaffProjects();
  return !!mine && canSeeProgram(mine.rows);
}

export type ProgramResult = { status: "ok"; cards: ProgramCard[] } | { status: "no_access" } | { status: "error"; error: string };

export async function getColabofestProgram(now: Date = new Date()): Promise<ProgramResult> {
  const mine = await myStaffProjects();
  if (!mine || !canSeeProgram(mine.rows)) return { status: "no_access" };
  const { db } = mine;

  const { data: projects, error } = await db
    .from("projects")
    .select("id, name, created_at")
    .eq("program", COLABOFEST_PROGRAM)
    .order("name", { ascending: true });
  if (error) {
    console.error("getColabofestProgram: projects failed", error);
    return { status: "error", error: "Couldn't load the projects." };
  }
  const list = (projects ?? []) as Row[];
  if (list.length === 0) return { status: "ok", cards: [] };
  const ids = list.map((p) => p.id as string);

  const [members, items, updates] = await Promise.all([
    db.from("project_members").select("project_id").in("project_id", ids),
    db.from("checklist_items").select("project_id, status, list_key, due_date").in("project_id", ids),
    db.from("project_updates").select("project_id, kind, created_at, resolved_at").in("project_id", ids),
  ]);
  for (const r of [members, items, updates]) {
    if (r.error) {
      console.error("getColabofestProgram: query failed", r.error);
      return { status: "error", error: "Couldn't load the projects." };
    }
  }

  const by = <T extends Row>(rows: T[] | null) => {
    const m = new Map<string, T[]>();
    for (const r of rows ?? []) {
      const k = r.project_id as string;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  };
  const memberRows = by(members.data as Row[] | null);
  const itemRows = by(items.data as Row[] | null);
  const updateRows = by(updates.data as Row[] | null);

  return {
    status: "ok",
    cards: list.map((p) =>
      buildProgramCard({
        id: p.id as string,
        name: p.name as string,
        createdAt: (p.created_at as string | null) ?? null,
        teamSize: (memberRows.get(p.id as string) ?? []).length,
        items: (itemRows.get(p.id as string) ?? []).map((i) => ({
          status: i.status as string,
          list_key: i.list_key as string,
          due_date: (i.due_date as string | null) ?? null,
        })),
        updates: (updateRows.get(p.id as string) ?? []).map((u) => ({
          kind: u.kind as string,
          created_at: u.created_at as string,
          resolved_at: (u.resolved_at as string | null) ?? null,
        })),
        now,
      })
    ),
  };
}
