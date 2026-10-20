// lib/server/pages/pageViewHelpers.ts — pure helpers behind the /pages screens.
//
// No runtime imports (type-only imports are erased), so `npm test` runs
// pageViewHelpers.test.ts under node --test and client components may import
// this file freely.

import type { ExploreItem, ExploreSection } from "../../../types/explore";

// ── visibility ───────────────────────────────────────────────────────────────

export type PageVisibility = "private" | "team" | "public";

export const VISIBILITY_INFO: Record<PageVisibility, { label: string; line: string }> = {
  private: { label: "Private", line: "Only the owner can see this page." },
  team: { label: "Team", line: "The owner and the team members they invite can see this page." },
  public: { label: "Public", line: "Anyone with the link can see this page, signed in or not." },
};

export function isVisibility(v: unknown): v is PageVisibility {
  return v === "private" || v === "team" || v === "public";
}

/** Shown when someone tries to add the page owner to the team. */
export const OWNER_ALREADY = "You already own this page.";

/** Is this the page owner, among accounts the owner could be invited as?
 *  Ids are compared only against ids of the SAME kind: `resolvedId` is the
 *  auth.users id the email lookup returned and `ownerId` is pages.owner_id,
 *  which RLS forces to equal the owner's auth.uid(). One person can have more
 *  than one auth identity for the same email (a different id from the lookup),
 *  so the owner's verified email is compared too. */
export function isOwnerAccount(args: {
  resolvedId: string | null;
  email: string;
  ownerId: string;
  ownerEmail: string | null;
}): boolean {
  if (args.resolvedId && args.resolvedId === args.ownerId) return true;
  const email = args.email.trim().toLowerCase();
  const ownerEmail = (args.ownerEmail ?? "").trim().toLowerCase();
  return email !== "" && email === ownerEmail;
}

// ── dates ────────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-20" or an ISO timestamp -> "Oct 20" (plus the year when it is not
 *  `now`'s year). Parsed from the text, never through a local-time Date, so a
 *  date can't slip a day. Unparseable -> null. */
export function formatDay(value: string | null | undefined, now: Date = new Date()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  const day = Number(m[3]);
  return Number(m[1]) === now.getUTCFullYear() ? `${month} ${day}` : `${month} ${day}, ${m[1]}`;
}

// ── "What's new" ─────────────────────────────────────────────────────────────

export type UpdateRow = {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  url: string | null;
  occurred_on: string; // YYYY-MM-DD
  /** page_evidence row this update announced (null once that row is pruned). */
  evidence_id?: string | null;
  created_at?: string;
};

const KIND_NOUN: Record<string, [string, string]> = {
  paper: ["paper", "papers"],
  preprint: ["preprint", "preprints"],
  trial: ["clinical trial", "clinical trials"],
  approval: ["FDA approval", "FDA approvals"],
  compound: ["compound", "compounds"],
  dataset: ["dataset", "datasets"],
  target: ["target", "targets"],
  geneset: ["gene set", "gene sets"],
  grant: ["grant", "grants"],
  tool: ["tool", "tools"],
  news: ["news item", "news items"],
};

export function kindNoun(kind: string, count: number): string {
  const pair = KIND_NOUN[kind];
  if (pair) return count === 1 ? pair[0] : pair[1];
  return count === 1 ? kind : `${kind}s`;
}

/** "3 new papers, 1 new FDA approval" — kinds in a stable order. */
export function summarizeKinds(rows: Pick<UpdateRow, "kind">[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  const order = Object.keys(KIND_NOUN);
  const kinds = Array.from(counts.keys()).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return kinds.map((k) => `${counts.get(k)} new ${kindNoun(k, counts.get(k) ?? 0)}`).join(", ");
}

export type UpdateGroup = { date: string; label: string; headline: string; items: UpdateRow[] };

/** Updates grouped by occurred_on, newest day first (the input order inside a
 *  day is kept). */
export function groupUpdatesByDate(rows: UpdateRow[], now: Date = new Date()): UpdateGroup[] {
  const byDate = new Map<string, UpdateRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.occurred_on);
    if (list) list.push(r);
    else byDate.set(r.occurred_on, [r]);
  }
  return Array.from(byDate.keys())
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((date) => {
      const items = byDate.get(date) as UpdateRow[];
      const label = formatDay(date, now) ?? date;
      return { date, label, headline: `${label}: ${summarizeKinds(items)}`, items };
    });
}

/** How many sources the page had when it was first built: the evidence rows
 *  no refresh update announced. (The first build writes no page_updates, and
 *  every refresh-added item gets one that points at its evidence row.) */
export function initialSourceCount(
  evidenceIds: string[],
  updates: Pick<UpdateRow, "evidence_id">[]
): number {
  const announced = new Set(updates.map((u) => u.evidence_id).filter((id): id is string => !!id));
  return evidenceIds.filter((id) => !announced.has(id)).length;
}

/** "Page created Oct 20 with 12 sources" — the single line that stands for the
 *  first build at the bottom of What's new. */
export function creationLine(
  createdAt: string | null | undefined,
  sources: number,
  now: Date = new Date()
): string {
  const day = formatDay(createdAt, now);
  const when = day ? `Page created ${day}` : "Page created";
  if (sources <= 0) return when;
  return `${when} with ${sources} ${sources === 1 ? "source" : "sources"}`;
}

// ── notes with numbered citations ────────────────────────────────────────────

export type BodyPart =
  | { type: "text"; text: string }
  | { type: "cite"; n: number; itemId: string | null }
  | { type: "notelink"; title: string; slug: string | null };

/** The citation number a page_note_evidence rationale carries
 *  ("Cited as [3]", written by tools/page_agent.py), or null. */
export function citationNumber(rationale: string | null | undefined): number | null {
  const m = /^Cited as \[(\d+)\]/.exec(rationale ?? "");
  return m ? Number(m[1]) : null;
}

/** Splits a note body into paragraphs of text, [n] citations and [[Note
 *  Title]] links. `citeMap` maps a citation number to an evidence item id for
 *  THIS note; a number it doesn't know stays plain text rather than linking to
 *  the wrong thing. `noteSlugByTitle` is keyed by lower-cased title. */
export function parseNoteBody(
  body: string,
  citeMap: Map<number, string>,
  noteSlugByTitle: Map<string, string>
): BodyPart[][] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const parts: BodyPart[] = [];
      const re = /\[\[([^\]]+)\]\]|\[(\d+)\]/g;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(paragraph))) {
        if (m.index > last) parts.push({ type: "text", text: paragraph.slice(last, m.index) });
        if (m[1] !== undefined) {
          const title = m[1].trim();
          parts.push({ type: "notelink", title, slug: noteSlugByTitle.get(title.toLowerCase()) ?? null });
        } else {
          const n = Number(m[2]);
          const itemId = citeMap.get(n) ?? null;
          if (itemId) parts.push({ type: "cite", n, itemId });
          else parts.push({ type: "text", text: m[0] });
        }
        last = m.index + m[0].length;
      }
      if (last < paragraph.length) parts.push({ type: "text", text: paragraph.slice(last) });
      return parts;
    });
}

// ── "All sources" ────────────────────────────────────────────────────────────

export type EvidenceRow = {
  id: string;
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

export function evidenceToItem(row: EvidenceRow): ExploreItem {
  return {
    id: row.item_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    url: row.url,
    source: row.source,
    date_iso: row.date_iso,
    signal:
      row.signal_metric && row.signal_value !== null
        ? { metric: row.signal_metric, value: row.signal_value, as_of: row.signal_as_of ?? "" }
        : null,
  };
}

// Papers first, then the order the Explore chips use.
export const KIND_ORDER = [
  "paper", "preprint", "dataset", "trial", "approval", "compound", "target",
  "geneset", "tool", "grant", "news",
];

/** page_evidence grouped by kind into Explore sections (so the existing
 *  Explore lists and tiles render them), in KIND_ORDER, unknown kinds last. */
export function groupEvidenceByKind(rows: EvidenceRow[]): ExploreSection[] {
  const byKind = new Map<string, ExploreItem[]>();
  for (const row of rows) {
    const list = byKind.get(row.kind);
    const item = evidenceToItem(row);
    if (list) list.push(item);
    else byKind.set(row.kind, [item]);
  }
  const rank = (k: string) => {
    const i = KIND_ORDER.indexOf(k);
    return i < 0 ? KIND_ORDER.length : i;
  };
  return Array.from(byKind.keys())
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((kind) => ({ tool: `page-${kind}`, kind, items: byKind.get(kind) as ExploreItem[] }));
}

// ── my pages ─────────────────────────────────────────────────────────────────

export const NEW_ITEMS_WINDOW_DAYS = 7;

export function newItemsCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - NEW_ITEMS_WINDOW_DAYS * 24 * 3600_000).toISOString();
}
