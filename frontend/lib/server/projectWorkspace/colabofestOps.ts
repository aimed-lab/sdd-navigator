// lib/server/projectWorkspace/colabofestOps.ts: the small writes of the
// ColaboFest project home that are not announcements or discussions: the
// finalist flag (site admin only), a member's affiliation (a lead sets it) and
// "is the viewer a site admin". Through the caller's own session; the database
// (2026-10-31_colabofest_project_core.sql) is the real gate.

import { requireCurrentUser } from "@/lib/auth";
import { isAffiliation } from "@/lib/server/projectWorkspace/colabofest";

export type OpResult = { status: "ok" } | { status: "forbidden"; error: string } | { status: "error"; error: string };

type Db = Awaited<ReturnType<typeof requireCurrentUser>>["db"];

export async function viewerIsSiteAdmin(db: Db): Promise<boolean> {
  const { data, error } = await db.rpc("is_site_admin");
  if (error) {
    console.error("is_site_admin failed", error);
    return false;
  }
  return data === true;
}

/** Mark or unmark a project as a finalist. Site admins only: the function
 *  returns NULL for anybody else. */
export async function setFinalist(projectId: string, finalist: boolean): Promise<OpResult> {
  const { db } = await requireCurrentUser();
  const { data, error } = await db.rpc("set_project_finalist", { p_project_id: projectId, p_finalist: finalist });
  if (error) {
    console.error("setFinalist failed", error);
    return { status: "error", error: "Couldn't change that." };
  }
  if (data === null || data === undefined) {
    return { status: "forbidden", error: "Only a site admin can change the finalist flag." };
  }
  return { status: "ok" };
}

/** A lead sets a member's affiliation (or clears it with null). */
export async function setMemberAffiliation(projectId: string, memberId: string, affiliation: unknown): Promise<OpResult> {
  const { db } = await requireCurrentUser();
  const value = affiliation === null || affiliation === "" ? null : affiliation;
  if (value !== null && !isAffiliation(value)) return { status: "error", error: "Unknown affiliation." };
  const { data, error } = await db
    .from("project_members")
    .update({ affiliation: value })
    .eq("id", memberId)
    .eq("project_id", projectId)
    .select("id");
  if (error) {
    console.error("setMemberAffiliation failed", error);
    return { status: "error", error: "Couldn't change that." };
  }
  if (!data || data.length === 0) return { status: "forbidden", error: "Only a project lead can set an affiliation." };
  return { status: "ok" };
}
