// lib/server/wikiEvidence.ts — stage 2 of the project wiki: persists the
// full candidate pool a run retrieves (project_evidence_items) and which
// notes it's filed under (wiki_note_evidence), per
// database/migrations/2026-08-24_wiki_evidence.sql. Same split as
// wikiNotes.ts: the Python backend (tools/wiki_agent.py's file_evidence())
// decides the filing, this file is the only thing that writes it.
//
//   saveEvidence(projectId, filings, unfiled) — called from
//     app/api/project-agent/status/route.ts, right after saveWikiNotes(),
//     same "writes directly, no approval step" placement as everything
//     else in this run's persistence. Every candidate the search returned
//     this run gets upserted into project_evidence_items (deduped on the
//     item's own stable id, see the migration's DEDUP note) whether it was
//     filed under a note or not — an unfiled item is still written, just
//     with zero wiki_note_evidence rows pointing at it, never dropped.
//
//   getProjectWikiGraph(projectId) — the one read this feature needs, for
//     app/projects/[id]/wiki/page.tsx. Returns notes, their filed evidence
//     grouped by note, the unfiled pool, and ghost links (a [[Note Title]]
//     in some note's body that matches no real note) — everything the
//     graph view renders, in one shape, so the page component does no
//     Supabase calls of its own.

import { requireCurrentUser } from "@/lib/auth";
import type { WikiNoteType } from "@/lib/server/wikiNotes";

export type EvidenceItemInput = {
  item_id: string;
  kind: string;
  title: string;
  summary: string | null;
  url: string | null;
  source: string;
  date_iso: string | null;
  signal_metric: string | null;
  signal_value: number | null;
  signal_as_of: string | null;
};

export type EvidenceFiling = { item: EvidenceItemInput; shared_terms: string[] };

// Keyed by note SLUG, not id — see tools/wiki_agent.py's file_evidence()
// docstring for why: a note this same run created has no id yet when the
// Python side decides filing.
export type EvidenceFilingsBySlug = Record<string, EvidenceFiling[]>;

export type SaveEvidenceResult =
  | { status: "ok"; itemsUpserted: number; filingsSaved: number; slugsNotFound: string[] }
  | { status: "error"; error: string };

/** Upserts every distinct item this run retrieved (filed or not) into
 *  project_evidence_items, then files the ones the agent matched to a note
 *  into wiki_note_evidence. BEST-EFFORT BY DESIGN, same stance as
 *  saveWikiNotes/saveProjectDigest: the caller treats any non-"ok" result
 *  as "log it, still return the run's result to the client."
 *
 *  A filing whose target slug isn't found among the project's CURRENT
 *  notes (e.g. that note's own save failed earlier in this same request)
 *  is skipped for the wiki_note_evidence insert but the item itself is
 *  still upserted into project_evidence_items above — degraded, not lost;
 *  see `slugsNotFound` on the result. */
export async function saveEvidence(
  projectId: string,
  filings: EvidenceFilingsBySlug,
  unfiled: EvidenceItemInput[]
): Promise<SaveEvidenceResult> {
  const { db } = await requireCurrentUser();

  // Every distinct item across filed + unfiled, deduped by item_id — an
  // item filed under two notes must only be upserted once.
  const byItemId = new Map<string, EvidenceItemInput>();
  for (const list of Object.values(filings)) {
    for (const { item } of list) byItemId.set(item.item_id, item);
  }
  for (const item of unfiled) byItemId.set(item.item_id, item);

  const rows = Array.from(byItemId.values()).map((item) => ({
    project_id: projectId,
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
    last_seen_at: new Date().toISOString(),
  }));

  let itemsUpserted = 0;
  if (rows.length > 0) {
    const { data, error } = await db
      .from("project_evidence_items")
      .upsert(rows, { onConflict: "project_id,item_id" })
      .select("id, item_id");
    if (error) {
      console.error("saveEvidence: upsert project_evidence_items failed", error);
      return { status: "error", error: "Couldn't save the run's evidence." };
    }
    itemsUpserted = data?.length ?? 0;
  }

  // Re-read ids for every upserted item (upsert's own return only carries
  // what was JUST written — re-selecting by (project_id, item_id) is the
  // simple way to get every id regardless of whether this call inserted or
  // updated it).
  const { data: idRows, error: idError } = await db
    .from("project_evidence_items")
    .select("id, item_id")
    .eq("project_id", projectId)
    .in("item_id", Array.from(byItemId.keys()));
  if (idError) {
    console.error("saveEvidence: re-read ids failed", idError);
    return { status: "error", error: "Couldn't file the run's evidence." };
  }
  const idByItemId = new Map<string, string>(
    (idRows ?? []).map((r: { id: string; item_id: string }) => [r.item_id, r.id])
  );

  const { data: noteRows, error: noteError } = await db
    .from("wiki_notes")
    .select("id, slug")
    .eq("project_id", projectId);
  if (noteError) {
    console.error("saveEvidence: read notes for filing failed", noteError);
    return { status: "error", error: "Couldn't file the run's evidence." };
  }
  const noteIdBySlug = new Map<string, string>(
    (noteRows ?? []).map((r: { id: string; slug: string }) => [r.slug, r.id])
  );

  const slugsNotFound: string[] = [];
  const filingRows: { note_id: string; evidence_item_id: string; rationale: string | null }[] = [];
  for (const [slug, list] of Object.entries(filings)) {
    const noteId = noteIdBySlug.get(slug);
    if (!noteId) {
      slugsNotFound.push(slug);
      continue;
    }
    for (const { item, shared_terms } of list) {
      const evidenceItemId = idByItemId.get(item.item_id);
      if (!evidenceItemId) continue;
      filingRows.push({
        note_id: noteId,
        evidence_item_id: evidenceItemId,
        rationale: shared_terms.length > 0 ? `Shares "${shared_terms.join('", "')}" with this note.` : null,
      });
    }
  }

  let filingsSaved = 0;
  if (filingRows.length > 0) {
    // upsert, not insert: re-filing the same (note, item) pair on a rerun
    // is a no-op, not a duplicate — the junction's own primary key already
    // guarantees that, upsert just avoids a 23505 on the obvious rerun case.
    const { error } = await db
      .from("wiki_note_evidence")
      .upsert(filingRows, { onConflict: "note_id,evidence_item_id" });
    if (error) {
      console.error("saveEvidence: upsert wiki_note_evidence failed", error);
      return { status: "error", error: "Couldn't file the run's evidence." };
    }
    filingsSaved = filingRows.length;
  }

  return { status: "ok", itemsUpserted, filingsSaved, slugsNotFound };
}

// ── read side: the graph view's one query ───────────────────────────────────

export type EvidenceItemRow = EvidenceItemInput & { id: string };

export type WikiGraphNote = {
  id: string;
  slug: string;
  title: string;
  note_type: WikiNoteType;
  body: string;
  is_human_edited: boolean;
  evidence: EvidenceItemRow[]; // this note's filed evidence, grouped by kind client-side
};

export type WikiGraphGhostLink = {
  // A [[Title]] referenced from some note's body that matches no real note
  // — rendered as a dashed "ghost" node (see this feature's own spec: "the
  // agent flagging something it thinks matters but found nothing on").
  title: string;
  referencedFrom: string[]; // slugs of the notes that link to it
};

export type WikiGraphResult =
  | {
      status: "ok";
      notes: WikiGraphNote[];
      unfiled: EvidenceItemRow[];
      projectLevel: EvidenceItemRow[];
      ghostLinks: WikiGraphGhostLink[];
      missingNoteSuggestions: MissingNoteSuggestion[];
    }
  | { status: "not_found" }
  | { status: "error"; error: string };

const LINK_RE = /\[\[([^\]]+)\]\]/g;

export type MissingNoteSuggestion = { term: string; count: number; itemIds: string[] };

// Same stopword list and length/count thresholds as
// tools/wiki_agent.py's _GROUNDING_STOPWORDS / suggest_missing_notes — kept
// as a second copy here (not imported, there's no shared package between
// the Python backend and this Next app) so the READ path (this file, run
// whenever the graph page loads) can recompute the suggestion from
// whatever's in the database NOW, rather than depending on the ephemeral
// missing_note_suggestions field from the LAST agent run's response, which
// nothing persists and which a page load days after that run would never
// see otherwise.
const STOPWORDS = new Set([
  "this", "that", "with", "from", "into", "using", "study", "studies",
  "research", "project", "paper", "papers", "dataset", "datasets", "trial",
  "trials", "grant", "grants", "about", "which", "there", "their", "these",
  "those", "would", "could", "should", "based", "found", "relevant",
  "related", "results", "result", "information", "provides", "provide",
  "note", "notes", "concept", "entity", "question",
]);

function contentWords(text: string | null | undefined): Set<string> {
  const words = (text ?? "").toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  return new Set(words.filter((w) => !STOPWORDS.has(w)));
}

function computeMissingNoteSuggestions(
  unfiled: EvidenceItemRow[],
  minGroupSize = 3,
  topTerms = 3
): MissingNoteSuggestion[] {
  if (unfiled.length < minGroupSize) return [];
  const byTerm = new Map<string, string[]>();
  for (const item of unfiled) {
    const words = new Set([...contentWords(item.title), ...contentWords(item.summary)]);
    for (const w of words) {
      const list = byTerm.get(w) ?? [];
      list.push(item.item_id);
      byTerm.set(w, list);
    }
  }
  return Array.from(byTerm.entries())
    .map(([term, itemIds]) => ({ term, count: itemIds.length, itemIds }))
    .filter((s) => s.count >= minGroupSize)
    .sort((a, b) => b.count - a.count)
    .slice(0, topTerms);
}

// Same set and same reasoning as tools/wiki_agent.py's _PROJECT_LEVEL_KINDS
// — a grant or trial that matched no note is evidence FOR THE PROJECT, not
// a "maybe there's a missing concept" signal, so it's split out of the
// unfiled bucket by kind AFTER matching, never used to gate matching
// itself. A trial that DID match a note (e.g. a tranilast trial matching
// the Tranilast note) is already in that note's `evidence` list before
// this function ever runs — this only reclassifies what's left over.
const PROJECT_LEVEL_KINDS = new Set(["grant", "trial"]);

function splitUnfiled(unfiled: EvidenceItemRow[]): { unfiled: EvidenceItemRow[]; projectLevel: EvidenceItemRow[] } {
  const real: EvidenceItemRow[] = [];
  const projectLevel: EvidenceItemRow[] = [];
  for (const item of unfiled) {
    (PROJECT_LEVEL_KINDS.has(item.kind) ? projectLevel : real).push(item);
  }
  return { unfiled: real, projectLevel };
}

function normalizeTitle(title: string): string {
  return title
    .replace(/[‐-―]/g, "-")
    .replace(/[\s-]+/g, " ")
    .trim()
    .toLowerCase();
}

/** Everything app/projects/[id]/wiki/page.tsx needs, in one call. Same
 *  "not_found covers both doesn't-exist and not-a-member" contract as
 *  getProject() — RLS returns zero rows for a non-member's SELECT on
 *  wiki_notes exactly like it does for projects, so this can't tell the
 *  two apart either, deliberately. */
export async function getProjectWikiGraph(projectId: string): Promise<WikiGraphResult> {
  const { db } = await requireCurrentUser();

  const { data: noteRows, error: noteError } = await db
    .from("wiki_notes")
    .select("id, slug, title, body, note_type, is_human_edited")
    .eq("project_id", projectId);
  if (noteError) {
    console.error("getProjectWikiGraph: read notes failed", noteError);
    return { status: "error", error: "Couldn't load the project wiki." };
  }
  // A project that exists but the caller isn't a member of returns zero
  // rows here, same as an actually-nonexistent project id — RLS can't tell
  // those apart, so neither does this function. A project that's simply a
  // fresh member of but has never run the agent ALSO has zero notes; the
  // caller (the page) is the one that knows which is which by separately
  // confirming project membership via getProject() before rendering this,
  // exactly like every other project sub-page already does.
  const notes: { id: string; slug: string; title: string; body: string; note_type: WikiNoteType; is_human_edited: boolean }[] =
    noteRows ?? [];

  const { data: evidenceRows, error: evidenceError } = await db
    .from("project_evidence_items")
    .select("id, item_id, kind, title, summary, url, source, date_iso, signal_metric, signal_value, signal_as_of")
    .eq("project_id", projectId);
  if (evidenceError) {
    console.error("getProjectWikiGraph: read evidence items failed", evidenceError);
    return { status: "error", error: "Couldn't load the project wiki's evidence." };
  }
  const allItems: EvidenceItemRow[] = evidenceRows ?? [];
  const itemById = new Map(allItems.map((i) => [i.id, i]));

  const { data: filingRows, error: filingError } = await db
    .from("wiki_note_evidence")
    .select("note_id, evidence_item_id")
    .eq("project_id", projectId);
  if (filingError) {
    console.error("getProjectWikiGraph: read filings failed", filingError);
    return { status: "error", error: "Couldn't load the project wiki's evidence." };
  }
  const filedItemIds = new Set<string>();
  const evidenceByNoteId = new Map<string, EvidenceItemRow[]>();
  for (const row of filingRows ?? []) {
    const item = itemById.get(row.evidence_item_id);
    if (!item) continue;
    filedItemIds.add(item.id);
    const list = evidenceByNoteId.get(row.note_id) ?? [];
    list.push(item);
    evidenceByNoteId.set(row.note_id, list);
  }

  const unfiledAll = allItems.filter((i) => !filedItemIds.has(i.id));
  const { unfiled, projectLevel } = splitUnfiled(unfiledAll);

  // Ghost links: every [[Title]] in every note's body that matches no
  // existing note title (same normalizeTitle folding as wiki_agent.py's
  // _normalize_title, so a rename between hyphen styles doesn't spuriously
  // ghost). Deduped by normalized title; referencedFrom lists every note
  // (by slug) that links to it, since more than one note can flag the same
  // gap.
  const titleSet = new Set(notes.map((n) => normalizeTitle(n.title)));
  const ghostMap = new Map<string, WikiGraphGhostLink>();
  for (const note of notes) {
    const seenInThisNote = new Set<string>();
    for (const match of note.body.matchAll(LINK_RE)) {
      const linkedTitle = match[1].trim();
      const key = normalizeTitle(linkedTitle);
      if (titleSet.has(key) || seenInThisNote.has(key)) continue;
      seenInThisNote.add(key);
      const existing = ghostMap.get(key);
      if (existing) {
        existing.referencedFrom.push(note.slug);
      } else {
        ghostMap.set(key, { title: linkedTitle, referencedFrom: [note.slug] });
      }
    }
  }

  return {
    status: "ok",
    notes: notes.map((n) => ({ ...n, evidence: evidenceByNoteId.get(n.id) ?? [] })),
    unfiled,
    projectLevel,
    ghostLinks: Array.from(ghostMap.values()),
    // Computed over the REAL unfiled pool only — projectLevel (grant/trial
    // administrative boilerplate) is never a missing-note signal, see
    // splitUnfiled's own comment.
    missingNoteSuggestions: computeMissingNoteSuggestions(unfiled),
  };
}
