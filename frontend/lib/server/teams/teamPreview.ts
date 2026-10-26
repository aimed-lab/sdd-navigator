// lib/server/teams/teamPreview.ts — what a person who is NOT on a team may see
// of it, and the ?open= value that remembers what they clicked. Plain
// functions, no imports, so `npm test` covers them.
//
// The database function get_team_preview(slug) already returns only these
// fields; normalizePreview() is the second lock: it copies out the known
// fields and nothing else, so a field added to that function later (a URL, a
// slug, a name) cannot reach the page by accident.

export type PreviewKind = "pdf" | "slides" | "image" | "link" | "page";

export type PreviewItem = { id: string; title: string; kind: PreviewKind };

export type TeamPreview = {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  documents: PreviewItem[];
  pages: PreviewItem[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOC_KINDS = ["pdf", "slides", "image", "link"] as const;

function items(raw: unknown, page: boolean): PreviewItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PreviewItem[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || !UUID_RE.test(o.id)) continue;
    const title = typeof o.title === "string" ? o.title.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    if (!title) continue;
    const kind: PreviewKind = page
      ? "page"
      : (DOC_KINDS as readonly string[]).includes(o.kind as string)
        ? (o.kind as PreviewKind)
        : "link";
    out.push({ id: o.id.toLowerCase(), title, kind });
  }
  return out;
}

/** The preview from the database function's answer, keeping only the known
 *  fields. Null for no answer (an unknown slug, or a community). */
export function normalizePreview(raw: unknown): TeamPreview | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (typeof o.id !== "string" || !UUID_RE.test(o.id) || !name) return null;
  return {
    id: o.id.toLowerCase(),
    name,
    description: typeof o.description === "string" && o.description.trim() ? o.description : null,
    member_count: Math.max(0, Math.floor(Number(o.member_count) || 0)),
    documents: items(o.documents, false),
    pages: items(o.pages, true),
  };
}

// ── ?open=<kind>:<id> ───────────────────────────────────────────────────────

export const TILE_KEYS = ["document", "pages", "learn", "share"] as const;
export type TileKey = (typeof TILE_KEYS)[number];

export type OpenTarget =
  | { kind: "doc"; id: string }
  | { kind: "page"; id: string }
  | { kind: "tile"; id: TileKey };

/** The value to put in ?open= for something a visitor clicked. */
export function openParam(kind: OpenTarget["kind"], id: string): string {
  return `${kind}:${id}`;
}

/** Checks the shape only: a known kind, and a uuid (doc, page) or a known tile.
 *  Used before the visitor is on the team, so it can carry the value through
 *  sign-in. Anything else is null. */
export function parseOpenShape(raw: unknown): OpenTarget | null {
  if (typeof raw !== "string" || raw.length > 80) return null;
  const parts = raw.split(":");
  if (parts.length !== 2) return null;
  const [kind, id] = parts;
  if (kind === "tile") return (TILE_KEYS as readonly string[]).includes(id) ? { kind: "tile", id: id as TileKey } : null;
  if ((kind === "doc" || kind === "page") && UUID_RE.test(id)) return { kind, id: id.toLowerCase() };
  return null;
}

/** parseOpenShape, plus: a doc or page id must be one that belongs to THIS team. */
export function parseOpen(raw: unknown, team: { docIds: string[]; pageIds: string[] }): OpenTarget | null {
  const t = parseOpenShape(raw);
  if (!t) return null;
  if (t.kind === "doc") return team.docIds.some((d) => d.toLowerCase() === t.id) ? t : null;
  if (t.kind === "page") return team.pageIds.some((p) => p.toLowerCase() === t.id) ? t : null;
  return t;
}
