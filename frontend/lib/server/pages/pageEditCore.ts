// lib/server/pages/pageEditCore.ts — the pure parts of editing a wiki page:
// checking what was typed for a section, picking its slug and position, the
// "Edited by" wording, the breadcrumb of a project page, and the date line of
// a page in a project's wiki list. No I/O, so `npm test` covers it and client
// components may import it.

import { formatDay } from "./pageViewHelpers.ts";

export const NOTE_TITLE_MAX = 120;
export const NOTE_BODY_MAX = 20000;

export type NoteInput = { title: string; body: string };

/** What was typed in the section editor, cleaned, or an error to show. */
export function parseNoteInput(
  title: unknown,
  body: unknown
): { ok: true; value: NoteInput } | { ok: false; error: string } {
  const t = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
  const b = typeof body === "string" ? body.replace(/\r\n/g, "\n").trim() : "";
  if (!t) return { ok: false, error: "Give the section a title." };
  if (t.length > NOTE_TITLE_MAX) return { ok: false, error: `Keep the title under ${NOTE_TITLE_MAX} characters.` };
  if (b.length > NOTE_BODY_MAX) return { ok: false, error: `The text is too long (${NOTE_BODY_MAX} characters at most).` };
  return { ok: true, value: { title: t, body: b } };
}

/** A slug for a new section, unique among the page's existing slugs. */
export function sectionSlug(title: string, existing: string[]): string {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "section";
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const s = `${base}-${i}`;
    if (!taken.has(s)) return s;
  }
  return `${base}-${Date.now()}`;
}

/** The position for a section added at the end. */
export function nextPosition(positions: number[]): number {
  return positions.length === 0 ? 0 : Math.max(...positions) + 1;
}

/** The line under a wiki page's title. Someone who cannot edit the page is not told
 *  to edit it, share it or ask the assistant to add to it. */
export function pageIntro(canEdit: boolean): string {
  return canEdit
    ? "This page updates itself with new research. Edit it, share it, or ask the assistant to add to it."
    : "This page updates itself with new research.";
}

/** "Edited by you" / "Edited by <name>" / "Edited by a person", or null when the
 *  section was never edited by a person. */
export function editedByLabel(a: { isHumanEdited: boolean; editedByViewer: boolean; name: string | null }): string | null {
  if (!a.isHumanEdited) return null;
  if (a.editedByViewer) return "Edited by you";
  return a.name ? `Edited by ${a.name}` : "Edited by a person";
}

// ── breadcrumb of a project page ─────────────────────────────────────────────

export type Crumb = { label: string; href: string };

/** The "<- project / Wiki" line above a project page. A sub-page shows
 *  "<- project / <parent page title>". Null for a page that is not in a project
 *  the viewer can see. */
export function pageCrumbs(args: {
  project: { id: string; name: string } | null;
  parent: { slug: string; title: string } | null;
}): Crumb[] | null {
  if (!args.project) return null;
  const wikiTab = `/projects/${args.project.id}?tab=wiki`;
  const first: Crumb = { label: args.project.name, href: wikiTab };
  if (args.parent) return [first, { label: args.parent.title, href: `/pages/${args.parent.slug}` }];
  return [first, { label: "Wiki", href: wikiTab }];
}

/** The date line in a project's wiki list. */
export function pageDateLine(
  lastRefreshedAt: string | null | undefined,
  createdAt: string | null | undefined,
  now: Date = new Date()
): string {
  const updated = formatDay(lastRefreshedAt, now);
  if (updated) return `Updated ${updated}`;
  const created = formatDay(createdAt, now);
  return created ? `Created ${created}` : "Not updated yet";
}
