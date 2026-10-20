// lib/server/pages/pageView.ts — reads for the /pages screens.
//
// Everything here goes through the caller's OWN Supabase session (getDb()), so
// RLS decides what is visible: a signed-in user sees their own pages and the
// team pages they belong to, a signed-out visitor sees public pages only. The
// functions never fall back to the service-role client. A page the viewer may
// not read is indistinguishable from one that doesn't exist (the caller turns
// both into a 404). `owner_id` is read to compute `isOwner` and is never
// returned (CLAUDE.md: owner ids don't ship to the client).

import { getDb, getCurrentUser } from "@/lib/auth";
import type { ActingContext } from "@/lib/server/pages/actingContext";
import {
  citationNumber,
  isVisibility,
  newItemsCutoffIso,
  type EvidenceRow,
  type PageVisibility,
  type UpdateRow,
} from "@/lib/server/pages/pageViewHelpers";

export type PageRole = "owner" | "editor" | "viewer" | null;

export type PageHeader = {
  id: string;
  slug: string;
  title: string;
  created_at: string | null;
  visibility: PageVisibility;
  refresh_enabled: boolean;
  last_refreshed_at: string | null;
};

export type PageNoteView = {
  id: string;
  slug: string;
  title: string;
  body: string;
  note_type: string;
  is_human_edited: boolean;
  editedByViewer: boolean;
  /** citation number -> page_evidence id, from this note's "Cited as [n]" filings */
  citations: Record<number, string>;
};

export type PageMemberView = {
  user_id: string;
  role: "editor" | "viewer";
  name: string | null;
  isViewer: boolean;
};

export type PageView = {
  page: PageHeader;
  viewer: { signedIn: boolean; isOwner: boolean; role: PageRole };
  notes: PageNoteView[];
  evidence: EvidenceRow[];
  updates: UpdateRow[];
  members: PageMemberView[];
};

export type PageViewResult = { status: "ok"; view: PageView } | { status: "not_found" } | { status: "error" };

const PAGE_SIZE = 1000; // PostgREST's default row cap per request
const MAX_ROWS = 5000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** All rows of a query, one PostgREST page at a time (capped). */
async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export async function getPageView(slug: string, ctx?: ActingContext): Promise<PageViewResult> {
  const db: Db | null = ctx ? ctx.db : await getDb();
  if (!db) return { status: "error" };
  const user = ctx ? ctx.user : await getCurrentUser();

  try {
    const { data: row, error } = await db
      .from("pages")
      .select("id, slug, title, owner_id, visibility, refresh_enabled, last_refreshed_at, created_at")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (!row || !isVisibility(row.visibility)) return { status: "not_found" };

    const isOwner = !!user && row.owner_id === user.id;
    const pageId = row.id as string;

    const [notes, evidence, links, updates, memberRows] = await Promise.all([
      selectAll<Record<string, unknown>>((a, z) =>
        db
          .from("page_notes")
          .select("id, slug, title, body, note_type, is_human_edited, updated_by, position, created_at")
          .eq("page_id", pageId)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true })
          .range(a, z)
      ),
      selectAll<EvidenceRow>((a, z) =>
        db
          .from("page_evidence")
          .select("id, item_id, kind, title, summary, url, source, date_iso, signal_metric, signal_value, signal_as_of")
          .eq("page_id", pageId)
          .order("first_seen_at", { ascending: false })
          .range(a, z)
      ),
      selectAll<{ note_id: string; evidence_item_id: string; rationale: string | null }>((a, z) =>
        db
          .from("page_note_evidence")
          .select("note_id, evidence_item_id, rationale")
          .eq("page_id", pageId)
          .range(a, z)
      ),
      selectAll<UpdateRow>((a, z) =>
        db
          .from("page_updates")
          .select("id, evidence_id, kind, title, summary, url, occurred_on, created_at")
          .eq("page_id", pageId)
          .order("occurred_on", { ascending: false })
          .order("created_at", { ascending: false })
          .range(a, z)
      ),
      selectAll<{ user_id: string; role: "editor" | "viewer" }>((a, z) =>
        db.from("page_members").select("user_id, role").eq("page_id", pageId).range(a, z)
      ),
    ]);

    // The viewer's own role. A member row only counts on a team page (the
    // database enforces that too), so on any other page it is shown as null.
    const myMember = user ? memberRows.find((m) => m.user_id === user.id) : undefined;
    const role: PageRole = isOwner
      ? "owner"
      : myMember && row.visibility === "team"
        ? myMember.role
        : null;

    // Citation numbers per note, from the "Cited as [n]" rationale the page
    // agent wrote when it filed each cited item.
    const citationsByNote = new Map<string, Record<number, string>>();
    for (const link of links) {
      const n = citationNumber(link.rationale);
      if (n === null) continue;
      const map = citationsByNote.get(link.note_id) ?? {};
      map[n] = link.evidence_item_id;
      citationsByNote.set(link.note_id, map);
    }

    // Display names: only what public.users' own RLS lets this viewer read
    // (a public profile); anyone else shows without a name.
    const names = new Map<string, string>();
    if (memberRows.length > 0) {
      const { data: people } = await db
        .from("users")
        .select("id, name")
        .in("id", memberRows.map((m) => m.user_id));
      for (const p of (people ?? []) as { id: string; name: string | null }[]) {
        if (p.name) names.set(p.id, p.name);
      }
    }

    return {
      status: "ok",
      view: {
        page: {
          id: pageId,
          slug: row.slug as string,
          title: row.title as string,
          created_at: (row.created_at as string | null) ?? null,
          visibility: row.visibility,
          refresh_enabled: !!row.refresh_enabled,
          last_refreshed_at: (row.last_refreshed_at as string | null) ?? null,
        },
        viewer: { signedIn: !!user, isOwner, role },
        notes: notes.map((n) => ({
          id: n.id as string,
          slug: n.slug as string,
          title: n.title as string,
          body: (n.body as string) ?? "",
          note_type: n.note_type as string,
          is_human_edited: !!n.is_human_edited,
          editedByViewer: !!n.is_human_edited && !!user && n.updated_by === user.id,
          citations: citationsByNote.get(n.id as string) ?? {},
        })),
        evidence,
        updates,
        members: memberRows.map((m) => ({
          user_id: m.user_id,
          role: m.role,
          name: names.get(m.user_id) ?? null,
          isViewer: !!user && m.user_id === user.id,
        })),
      },
    };
  } catch (e) {
    console.error("getPageView failed", e);
    return { status: "error" };
  }
}

// ── My pages ─────────────────────────────────────────────────────────────────

export type MyPageRow = PageHeader & { role: "owner" | "editor" | "viewer"; newItems: number };

export type MyPagesResult = { status: "ok"; pages: MyPageRow[] } | { status: "signed_out" } | { status: "error" };

/** Pages the signed-in user owns, plus team pages they are a member of, each
 *  with the number of timeline entries added in the last 7 days. */
export async function listMyPages(now: Date = new Date(), ctx?: ActingContext): Promise<MyPagesResult> {
  const user = ctx ? ctx.user : await getCurrentUser();
  if (!user) return { status: "signed_out" };
  const db: Db | null = ctx ? ctx.db : await getDb();
  if (!db) return { status: "error" };

  const columns = "id, slug, title, visibility, refresh_enabled, last_refreshed_at";
  try {
    const [ownedRes, memberRes] = await Promise.all([
      db.from("pages").select(columns).eq("owner_id", user.id),
      db.from("page_members").select("page_id, role").eq("user_id", user.id),
    ]);
    if (ownedRes.error) throw ownedRes.error;
    if (memberRes.error) throw memberRes.error;

    const roleById = new Map<string, "editor" | "viewer">(
      ((memberRes.data ?? []) as { page_id: string; role: "editor" | "viewer" }[]).map((m) => [m.page_id, m.role])
    );
    let memberPages: Record<string, unknown>[] = [];
    if (roleById.size > 0) {
      // Membership only counts on team pages.
      const { data, error } = await db
        .from("pages")
        .select(columns)
        .in("id", Array.from(roleById.keys()))
        .eq("visibility", "team");
      if (error) throw error;
      memberPages = (data ?? []) as Record<string, unknown>[];
    }

    const rows: MyPageRow[] = [
      ...((ownedRes.data ?? []) as Record<string, unknown>[]).map((p) => toRow(p, "owner")),
      ...memberPages
        .filter((p) => !(ownedRes.data ?? []).some((o: { id: string }) => o.id === p.id))
        .map((p) => toRow(p, roleById.get(p.id as string) ?? "viewer")),
    ].filter((r): r is MyPageRow => r !== null);

    if (rows.length > 0) {
      const { data: recent, error } = await db
        .from("page_updates")
        .select("page_id")
        .in("page_id", rows.map((r) => r.id))
        .gte("created_at", newItemsCutoffIso(now))
        .limit(10000);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const u of (recent ?? []) as { page_id: string }[]) {
        counts.set(u.page_id, (counts.get(u.page_id) ?? 0) + 1);
      }
      for (const r of rows) r.newItems = counts.get(r.id) ?? 0;
    }

    rows.sort((a, b) => (b.last_refreshed_at ?? "").localeCompare(a.last_refreshed_at ?? ""));
    return { status: "ok", pages: rows };
  } catch (e) {
    console.error("listMyPages failed", e);
    return { status: "error" };
  }
}

function toRow(p: Record<string, unknown>, role: MyPageRow["role"]): MyPageRow | null {
  if (!isVisibility(p.visibility)) return null;
  return {
    id: p.id as string,
    slug: p.slug as string,
    title: p.title as string,
    created_at: null,
    visibility: p.visibility,
    refresh_enabled: !!p.refresh_enabled,
    last_refreshed_at: (p.last_refreshed_at as string | null) ?? null,
    role,
    newItems: 0,
  };
}
