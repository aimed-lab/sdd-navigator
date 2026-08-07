// lib/server/projectResources.ts — the project detail page's Resources
// section: shared saved_items scoped to a project (2026-08-09_saved_items_projects.sql).
//
// AUTH: goes through lib/auth.ts, never @supabase directly, same rule as
// every other lib/server/* module. RLS is the real gate — "saved_items_*"
// policies now permit SELECT/DELETE by any project member, and INSERT by
// any project member so long as user_id is their own. This file adds one
// friendly-error check beyond that (an explicit membership lookup before
// insert, so a non-member gets a clear message instead of decoding a raw
// 42501), same idiom as lib/server/projects.ts:addProjectMember().
//
// A SEPARATE MODULE from lib/server/projects.ts on purpose — that file is
// already large, and this concern (shared saved-item storage) is only
// loosely related to project membership/team/proposal logic.
//
// STORAGE SHAPE: item_data is JSONB with no schema of its own — this file
// stores the WHOLE ExploreItem in it (kind, title, summary, url, signal,
// raw, everything), not the narrower DiscoverItem shape
// lib/server/savedItems.ts's personal-save flow uses. That's fine: the
// column doesn't care, and Resources needs to hand full ExploreItem props
// straight to the same <ItemCard> Explore already uses — reusing the real
// card, not inventing a third shape for it to render.
//
// UNIQUENESS: fixed by 2026-08-11_saved_items_unique_fix.sql. saved_items
// no longer has a single table-wide UNIQUE (user_id, item_id) — that's
// replaced by two partial unique indexes, one scoped to project_id IS
// NULL (personal saves) and one to project_id IS NOT NULL, keyed on
// (user_id, item_id, project_id) (project saves). The same item_id can
// therefore be saved personally AND into any number of different
// projects by the same user, each as its own row; a 23505 can now only
// mean an actual re-save of the SAME item into the SAME scope, which
// isn't a real error path here — the caller already knows it's saved.

import { getDb, requireCurrentUser, type Db } from "@/lib/auth";
import type { ExploreItem } from "@/types/explore";

// Every kind ExploreItem can carry (types/explore.ts), in the order tiles
// are shown. A saved item's kind always gets a tile now — a save with no
// matching tile was the original bug (an episode counted toward "N saved"
// but rendered nowhere).
const TILE_KINDS = [
  "paper",
  "dataset",
  "tool",
  "trial",
  "grant",
  "news",
  "resource",
  "person",
  "episode",
] as const;
type TileKind = (typeof TILE_KINDS)[number];

const TILE_LABEL: Record<TileKind, string> = {
  paper: "Papers",
  dataset: "Datasets",
  tool: "Tools",
  trial: "Trials",
  grant: "Grants",
  news: "News",
  resource: "Resources",
  person: "People",
  episode: "Episodes",
};

export type ResourceTile = { kind: TileKind; label: string; count: number };

export type ProjectResources = {
  /** Every saved item for this project, any kind — what the status strip's
   *  "N resources saved" and the empty-state check both use. */
  total: number;
  /** Only kinds with at least one item, in TILE_KINDS order — "only
   *  render a tile for a kind that has at least one" per STRUCTURE.md. */
  tiles: ResourceTile[];
  /** The 3 most recently saved, any kind, newest first. Shown when no
   *  tile is selected. */
  recent: ExploreItem[];
  /** EVERY saved item, any kind, newest first — the full set `items`
   *  filters over in place when a tile is clicked, so picking a kind
   *  never needs a new fetch or a new page. */
  items: ExploreItem[];
};

export type ListProjectResourcesResult =
  | { status: "ok"; resources: ProjectResources }
  | { status: "error"; error: string };

export async function listProjectResources(projectId: string): Promise<ListProjectResourcesResult> {
  const db = await getDb();
  if (!db) return { status: "error", error: "Service not configured." };

  const { data, error } = await db
    .from("saved_items")
    .select("item_id, item_data, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("listProjectResources: query failed", error);
    return { status: "error", error: "Couldn't load saved resources." };
  }

  const rows = (data ?? []) as { item_id: string; item_data: ExploreItem; created_at: string }[];

  const countByKind = new Map<string, number>();
  for (const row of rows) {
    const kind = (row.item_data?.kind as string | undefined) ?? "unknown";
    countByKind.set(kind, (countByKind.get(kind) ?? 0) + 1);
  }

  const tiles: ResourceTile[] = TILE_KINDS.map((kind) => ({
    kind,
    label: TILE_LABEL[kind],
    count: countByKind.get(kind) ?? 0,
  })).filter((t) => t.count > 0);

  const items = rows.map((r) => r.item_data);
  const recent = items.slice(0, 3);

  return { status: "ok", resources: { total: rows.length, tiles, recent, items } };
}

// Internal only — a friendly membership check before insert, so a
// non-member gets { status: "forbidden" } instead of a raw 42501. RLS
// ("saved_items_insert_own") is the actual gate regardless of what this
// returns.
async function isCallerMember(db: Db, projectId: string, userId: string): Promise<boolean> {
  const { data } = await db
    .from("project_members")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

export type SaveToProjectResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

/** Save an Explore item into a project's shared Resources. Any member may
 *  call this — the item becomes visible to every member, not just the
 *  saver (that's the whole point; see saved_items_select_own's project
 *  branch). user_id is always the caller's own id: you save AS yourself,
 *  project-scoped or not, same rule lib/server/savedItems.ts already
 *  follows for personal saves. */
export async function saveToProject(projectId: string, item: ExploreItem): Promise<SaveToProjectResult> {
  const { user, db } = await requireCurrentUser();

  if (!(await isCallerMember(db, projectId, user.id))) {
    return { status: "forbidden", error: "You're not a member of this project." };
  }

  const { error } = await db.from("saved_items").insert({
    user_id: user.id,
    project_id: projectId,
    item_id: item.id,
    item_data: item,
  });

  if (error) {
    console.error("saveToProject: insert failed", error);
    return { status: "error", error: "Couldn't save that item." };
  }

  return { status: "ok" };
}

export type RemoveFromProjectResult = { status: "ok" } | { status: "error"; error: string };

/** Remove a saved item from a project. Any member may remove ANY member's
 *  save here — "saved_items_delete_own"'s project branch permits it
 *  deliberately (shared workspace, so a teammate can tidy up), not just
 *  the person who originally saved it. */
export async function removeFromProject(
  projectId: string,
  itemId: string
): Promise<RemoveFromProjectResult> {
  const { db } = await requireCurrentUser();

  const { error } = await db
    .from("saved_items")
    .delete()
    .eq("project_id", projectId)
    .eq("item_id", itemId);

  if (error) {
    console.error("removeFromProject: delete failed", error);
    return { status: "error", error: "Couldn't remove that item." };
  }
  return { status: "ok" };
}
