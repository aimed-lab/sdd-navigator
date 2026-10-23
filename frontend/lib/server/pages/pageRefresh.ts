// lib/server/pages/pageRefresh.ts — the scheduled refresh of wiki pages
// (POST /api/pages/refresh calls runRefresh()).
//
// Every page with refresh_enabled keeps collecting new resources from all
// Explore sources, about once a day. Each run takes at most MAX_PAGES_PER_RUN
// pages that are due (never refreshed, or last refreshed more than
// STALE_AFTER_HOURS ago), oldest first; the hourly scheduler spreads the rest
// over the following runs.
//
// NO RUNTIME IMPORTS, ON PURPOSE: the decisions (which pages are due, what is
// new, what to file, what a failure does to the rest of the run) are plain
// functions over injected dependencies (RefreshDeps), so `npm test`
// (node --test, see pageRefresh.test.ts) runs them without Supabase or the
// Next.js `@/` alias. The route builds the real dependencies with
// makeSupabaseRefreshDeps(db, callBackend); `import type` is erased.
//
// NOTES ARE NEVER WRITTEN BY A REFRESH. RefreshDeps has no way to create,
// update or delete a page_notes row, so a note with is_human_edited = true
// (or any note) cannot be changed here. Notes are only READ, to decide which
// one a new item is evidence for; the link goes into page_note_evidence.
// Anything the backend thinks is missing comes back as a suggestion in the
// run summary and is not persisted.

import type { PageEvidenceItemInput } from "./pageEvidence";

export const STALE_AFTER_HOURS = 20;
export const MAX_PAGES_PER_RUN = 3;
// A page whose refresh failed is retried in about this many hours rather than
// on the very next hourly run (see markFailed in runRefresh).
export const FAILURE_RETRY_HOURS = 3;

const HOUR_MS = 60 * 60 * 1000;

export type RefreshPage = {
  id: string;
  slug: string;
  seed_input: string;
  refresh_enabled: boolean;
  last_refreshed_at: string | null;
};

export type RefreshNote = {
  id: string;
  slug: string;
  title: string;
  body: string;
  note_type: string;
  is_human_edited: boolean;
};

export type FilingsBySlug = Record<string, { item: PageEvidenceItemInput; rationale?: string; shared_terms?: string[] }[]>;

export type MissingNoteSuggestion = { term: string; count: number; item_ids: string[] };

/** What POST /api/page-refresh on explore-mcp returns. */
export type BackendRefreshResult = {
  new_items: PageEvidenceItemInput[];
  evidence_filings: FilingsBySlug;
  unfiled_items?: PageEvidenceItemInput[];
  project_level_items?: PageEvidenceItemInput[];
  missing_note_suggestions?: MissingNoteSuggestion[];
  warnings?: string[];
  search_failed?: boolean;
};

export type SaveResult = { itemsSaved: number; updatesSaved: number; filingsSaved: number };

export type RefreshDeps = {
  /** Pages due for a refresh at `cutoffIso`, oldest first, at most `limit`. */
  listStalePages(cutoffIso: string, limit: number): Promise<RefreshPage[]>;
  loadKnownItemIds(pageId: string): Promise<string[]>;
  /** READ-ONLY view of the page's notes. */
  loadNotes(pageId: string): Promise<RefreshNote[]>;
  callBackend(args: {
    topic: string;
    knownItemIds: string[];
    notes: Pick<RefreshNote, "slug" | "title" | "body">[];
  }): Promise<BackendRefreshResult>;
  /** Insert the new evidence, one page_updates row each (dated `today`), and
   *  the filings. Throws on a database error, after removing whatever this
   *  call had already inserted (all or nothing for the page's new items). */
  saveNewItems(args: {
    pageId: string;
    items: PageEvidenceItemInput[];
    filings: FilingsBySlug;
    notes: RefreshNote[];
    today: string;
  }): Promise<SaveResult>;
  markRefreshed(pageId: string, iso: string): Promise<void>;
};

export type PageRefreshOutcome = {
  pageId: string;
  slug: string;
  newItems: number;
  filings: number;
  missingNoteSuggestions: MissingNoteSuggestion[];
  warnings: string[];
};

export type RefreshSummary = {
  picked: number;
  refreshed: PageRefreshOutcome[];
  errors: { pageId: string; slug: string; error: string }[];
};

// ── pure decisions ───────────────────────────────────────────────────────────

/** ISO timestamp before which a page counts as stale. */
export function staleCutoffIso(now: Date): string {
  return new Date(now.getTime() - STALE_AFTER_HOURS * HOUR_MS).toISOString();
}

/** Up to `limit` pages that are refresh_enabled and never refreshed or last
 *  refreshed more than STALE_AFTER_HOURS ago. Never-refreshed first, then
 *  oldest first. */
export function pickStalePages(
  pages: RefreshPage[],
  now: Date,
  limit: number = MAX_PAGES_PER_RUN
): RefreshPage[] {
  const cutoff = now.getTime() - STALE_AFTER_HOURS * HOUR_MS;
  const due = pages.filter((p) => {
    if (!p.refresh_enabled) return false;
    if (p.last_refreshed_at === null) return true;
    const t = Date.parse(p.last_refreshed_at);
    return Number.isNaN(t) || t < cutoff;
  });
  const key = (p: RefreshPage) =>
    p.last_refreshed_at === null || Number.isNaN(Date.parse(p.last_refreshed_at))
      ? -Infinity
      : Date.parse(p.last_refreshed_at);
  return due.sort((a, b) => key(a) - key(b)).slice(0, Math.max(0, limit));
}

/** Items whose item_id the page does not hold yet, each id once. */
export function diffNewItems(
  candidates: PageEvidenceItemInput[],
  knownItemIds: Iterable<string>
): PageEvidenceItemInput[] {
  const seen = new Set(knownItemIds);
  const out: PageEvidenceItemInput[] = [];
  for (const item of candidates) {
    if (!item?.item_id || seen.has(item.item_id)) continue;
    seen.add(item.item_id);
    out.push(item);
  }
  return out;
}

/** Keeps only filings for notes that exist and items that are new. */
export function restrictFilings(
  filings: FilingsBySlug,
  newItems: PageEvidenceItemInput[],
  notes: Pick<RefreshNote, "slug">[]
): FilingsBySlug {
  const newIds = new Set(newItems.map((i) => i.item_id));
  const slugs = new Set(notes.map((n) => n.slug));
  const out: FilingsBySlug = {};
  for (const [slug, list] of Object.entries(filings ?? {})) {
    if (!slugs.has(slug)) continue;
    const kept = list.filter((f) => f?.item && newIds.has(f.item.item_id));
    if (kept.length > 0) out[slug] = kept;
  }
  return out;
}

export function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ── the run ──────────────────────────────────────────────────────────────────

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Refresh the pages that are due. One page failing is logged and recorded in
 *  `errors`; the others still run. A page counts as refreshed (and gets
 *  last_refreshed_at = now) even when nothing was new; a page that failed does
 *  NOT, it is pushed back FAILURE_RETRY_HOURS-ish instead so a page that
 *  fails every time cannot occupy the oldest-first slots forever. */
export async function runRefresh(
  deps: RefreshDeps,
  now: Date = new Date(),
  log: (msg: string, err?: unknown) => void = (msg, err) => console.error(msg, err)
): Promise<RefreshSummary> {
  const summary: RefreshSummary = { picked: 0, refreshed: [], errors: [] };

  let pages: RefreshPage[];
  try {
    pages = pickStalePages(await deps.listStalePages(staleCutoffIso(now), MAX_PAGES_PER_RUN), now);
  } catch (e) {
    log("pages refresh: couldn't list stale pages", e);
    summary.errors.push({ pageId: "", slug: "", error: `Couldn't list pages: ${errorText(e)}` });
    return summary;
  }
  summary.picked = pages.length;

  for (const page of pages) {
    try {
      const known = await deps.loadKnownItemIds(page.id);
      const notes = await deps.loadNotes(page.id);
      const result = await deps.callBackend({
        topic: page.seed_input,
        knownItemIds: known,
        notes: notes.map(({ slug, title, body }) => ({ slug, title, body })),
      });
      if (result.search_failed) {
        throw new Error(`search failed: ${(result.warnings ?? []).join(" ") || "no detail"}`);
      }

      const fresh = diffNewItems(result.new_items ?? [], known);
      let filingsSaved = 0;
      if (fresh.length > 0) {
        const saved = await deps.saveNewItems({
          pageId: page.id,
          items: fresh,
          filings: restrictFilings(result.evidence_filings ?? {}, fresh, notes),
          notes,
          today: todayUtc(now),
        });
        filingsSaved = saved.filingsSaved;
      }

      await deps.markRefreshed(page.id, now.toISOString());
      summary.refreshed.push({
        pageId: page.id,
        slug: page.slug,
        newItems: fresh.length,
        filings: filingsSaved,
        missingNoteSuggestions: fresh.length > 0 ? result.missing_note_suggestions ?? [] : [],
        warnings: result.warnings ?? [],
      });
    } catch (e) {
      log(`pages refresh: page ${page.slug} (${page.id}) failed`, e);
      summary.errors.push({ pageId: page.id, slug: page.slug, error: errorText(e) });
      try {
        const retryAt = new Date(now.getTime() - (STALE_AFTER_HOURS - FAILURE_RETRY_HOURS) * HOUR_MS);
        await deps.markRefreshed(page.id, retryAt.toISOString());
      } catch (e2) {
        log(`pages refresh: couldn't back off page ${page.slug}`, e2);
      }
    }
  }
  return summary;
}

// ── Supabase-backed dependencies ─────────────────────────────────────────────

// Structural type for the service-role client, so this file needs no import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const PAGE_SIZE = 1000; // PostgREST's default row cap per request

/** Undo saveNewItems after a later step failed: delete this run's filing
 *  links, timeline rows and evidence rows (in that order, since page_updates
 *  .evidence_id would otherwise just be nulled and leave the rows behind). The
 *  ids are the rows this run inserted; the caller only ever passes items the
 *  page did not hold. A failed delete is logged and does not hide the original
 *  error. */
async function rollbackSavedItems(db: Db, pageId: string, evidenceIds: string[]): Promise<void> {
  if (evidenceIds.length === 0) return;
  const steps: [string, () => Promise<{ error: { message: string } | null }>][] = [
    ["page_note_evidence", () => db.from("page_note_evidence").delete().in("evidence_item_id", evidenceIds)],
    ["page_updates", () => db.from("page_updates").delete().eq("page_id", pageId).in("evidence_id", evidenceIds)],
    ["page_evidence", () => db.from("page_evidence").delete().eq("page_id", pageId).in("id", evidenceIds)],
  ];
  for (const [table, run] of steps) {
    try {
      const { error } = await run();
      if (error) console.error(`pages refresh: rollback of ${table} failed`, error);
    } catch (e) {
      console.error(`pages refresh: rollback of ${table} threw`, e);
    }
  }
}

export function makeSupabaseRefreshDeps(
  db: Db,
  callBackend: RefreshDeps["callBackend"]
): RefreshDeps {
  return {
    async listStalePages(cutoffIso, limit) {
      const { data, error } = await db
        .from("pages")
        .select("id, slug, seed_input, refresh_enabled, last_refreshed_at")
        .eq("refresh_enabled", true)
        .or(`last_refreshed_at.is.null,last_refreshed_at.lt.${cutoffIso}`)
        .order("last_refreshed_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as RefreshPage[];
    },

    async loadKnownItemIds(pageId) {
      const ids: string[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await db
          .from("page_evidence")
          .select("item_id")
          .eq("page_id", pageId)
          .order("item_id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as { item_id: string }[];
        for (const r of rows) ids.push(r.item_id);
        if (rows.length < PAGE_SIZE) break;
      }
      return ids;
    },

    async loadNotes(pageId) {
      const { data, error } = await db
        .from("page_notes")
        .select("id, slug, title, body, note_type, is_human_edited")
        .eq("page_id", pageId);
      if (error) throw new Error(error.message);
      return (data ?? []) as RefreshNote[];
    },

    callBackend,

    async saveNewItems({ pageId, items, filings, notes, today }) {
      const nowIso = new Date().toISOString();
      const { data: inserted, error } = await db
        .from("page_evidence")
        .upsert(
          items.map((item) => ({
            page_id: pageId,
            item_id: item.item_id,
            kind: item.kind,
            title: item.title,
            summary: item.summary,
            url: item.url,
            source: item.source,
            date_iso: item.date_iso,
            signal_metric: item.signal_metric,
            signal_value: item.signal_value,
            signal_as_of: item.signal_as_of,
            last_seen_at: nowIso,
          })),
          { onConflict: "page_id,item_id" }
        )
        .select("id, item_id");
      if (error) throw new Error(`page_evidence: ${error.message}`);
      const idByItemId = new Map<string, string>(
        ((inserted ?? []) as { id: string; item_id: string }[]).map((r) => [r.item_id, r.id])
      );

      // Everything below depends on the evidence rows just written. If any of
      // it fails, take those rows back out (see rollbackSavedItems) so the
      // items are not left behind as "known" without their timeline entries,
      // and the page is retried with the same items next time.
      const evidenceIds = Array.from(idByItemId.values());
      let filingRows: { note_id: string; evidence_item_id: string; rationale: string | null }[] = [];
      try {
        const { error: updatesError } = await db.from("page_updates").insert(
          items.map((item) => ({
            page_id: pageId,
            evidence_id: idByItemId.get(item.item_id) ?? null,
            kind: item.kind,
            title: item.title,
            summary: item.summary,
            url: item.url,
            occurred_on: today,
          }))
        );
        if (updatesError) throw new Error(`page_updates: ${updatesError.message}`);

        // Filing links only: page_note_evidence rows. No page_notes write.
        const noteIdBySlug = new Map(notes.map((n) => [n.slug, n.id]));
        filingRows = [];
        for (const [slug, list] of Object.entries(filings)) {
          const noteId = noteIdBySlug.get(slug);
          if (!noteId) continue;
          for (const { item, shared_terms, rationale } of list) {
            const evidenceItemId = idByItemId.get(item.item_id);
            if (!evidenceItemId) continue;
            filingRows.push({
              note_id: noteId,
              evidence_item_id: evidenceItemId,
              rationale:
                rationale ??
                (shared_terms && shared_terms.length > 0
                  ? `Shares "${shared_terms.join('", "')}" with this note.`
                  : null),
            });
          }
        }
        if (filingRows.length > 0) {
          const { error: filingError } = await db
            .from("page_note_evidence")
            .upsert(filingRows, { onConflict: "note_id,evidence_item_id" });
          if (filingError) throw new Error(`page_note_evidence: ${filingError.message}`);
        }
      } catch (e) {
        await rollbackSavedItems(db, pageId, evidenceIds);
        throw e;
      }

      return { itemsSaved: items.length, updatesSaved: items.length, filingsSaved: filingRows.length };
    },

    async markRefreshed(pageId, iso) {
      const { error } = await db.from("pages").update({ last_refreshed_at: iso }).eq("id", pageId);
      if (error) throw new Error(error.message);
    },
  };
}
