// lib/server/pages/pageAdmin.ts — owner-only changes to a living page: its
// visibility, whether it keeps itself updated, and deleting it. Adding and
// removing members is in pageMembers.ts.
//
// Uses the caller's own session (requireCurrentUser), so the "Pages: owner
// update" / "Pages: owner delete" RLS policies are the real gate; the explicit
// `.select()` after each write exists to tell "RLS matched no row" (not the
// owner) apart from success, and to return a clear { status: "forbidden" }.

import { requireCurrentUser } from "@/lib/auth";
import type { ActingContext } from "@/lib/server/pages/actingContext";
import { isVisibility, type PageVisibility } from "@/lib/server/pages/pageViewHelpers";

export type PageAdminResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

const NOT_OWNER = "Only the page owner can do that.";

export async function setPageVisibility(
  pageId: string,
  visibility: PageVisibility,
  ctx?: ActingContext
): Promise<PageAdminResult> {
  const { db } = ctx ?? (await requireCurrentUser());
  if (!isVisibility(visibility)) return { status: "error", error: "Visibility must be private, team or public." };

  const { data, error } = await db.from("pages").update({ visibility }).eq("id", pageId).select("id");
  if (error) {
    console.error("setPageVisibility failed", error);
    return { status: "error", error: "Couldn't change the visibility." };
  }
  if (!data || data.length === 0) return { status: "forbidden", error: NOT_OWNER };
  return { status: "ok" };
}

export async function setPageRefreshEnabled(
  pageId: string,
  enabled: boolean,
  ctx?: ActingContext
): Promise<PageAdminResult> {
  const { db } = ctx ?? (await requireCurrentUser());
  const { data, error } = await db
    .from("pages")
    .update({ refresh_enabled: !!enabled })
    .eq("id", pageId)
    .select("id");
  if (error) {
    console.error("setPageRefreshEnabled failed", error);
    return { status: "error", error: "Couldn't change that setting." };
  }
  if (!data || data.length === 0) return { status: "forbidden", error: NOT_OWNER };
  return { status: "ok" };
}

export async function deletePage(pageId: string, ctx?: ActingContext): Promise<PageAdminResult> {
  const { db } = ctx ?? (await requireCurrentUser());
  const { data, error } = await db.from("pages").delete().eq("id", pageId).select("id");
  if (error) {
    console.error("deletePage failed", error);
    return { status: "error", error: "Couldn't delete the page." };
  }
  if (!data || data.length === 0) return { status: "forbidden", error: NOT_OWNER };
  return { status: "ok" };
}
