// Section keys/labels/default order for a community page's configurable
// sections (database/migrations/2026-08-31_community_sections.sql). Split
// out from lib/server/communities.ts specifically so a client component
// (SectionsEditor) can import these as values without dragging in a
// server-only module — same reason lib/projectTypes.ts exists separately
// from lib/server/projects.ts.

export const SECTION_KEYS = [
  "projects",
  "members",
  "resources",
  "announcements",
  "events",
  "who_can_help",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export type SectionConfig = { key: SectionKey; enabled: boolean };

export const SECTION_LABEL: Record<SectionKey, string> = {
  projects: "Projects",
  members: "Members",
  resources: "Resources",
  announcements: "Announcements",
  events: "Events",
  who_can_help: "Who can help",
};

/** SECTION_KEYS order, all enabled — what a NULL `communities.sections`
 *  resolves to (see resolveSections below). "Projects stays where it is
 *  when enabled": projects is first here, the same position it already
 *  renders in today, so a community that has never touched the Sections
 *  editor (sections IS NULL) shows it in exactly the same place it always
 *  has. */
export const DEFAULT_SECTIONS: SectionConfig[] = SECTION_KEYS.map((key) => ({
  key,
  enabled: true,
}));

/** NULL (or an empty/malformed array) -> the full default order, every
 *  section enabled — "null means show everything", the no-regression
 *  guarantee for every community that predates this feature.
 *
 *  A non-null, non-empty array is trusted for ORDER and for every key it
 *  contains, but topped up with any SECTION_KEYS this file knows about
 *  that the saved array doesn't mention — enabled by default, appended at
 *  the end — so a section key shipped AFTER some admin already saved their
 *  order doesn't just silently vanish from their page; it shows up once,
 *  in the position they'd see it if they opened the Sections editor and
 *  saved again. Any key in the saved array that ISN'T in SECTION_KEYS any
 *  more (a section retired later) is dropped, not rendered. */
export function resolveSections(sections: SectionConfig[] | null | undefined): SectionConfig[] {
  if (!sections || sections.length === 0) return DEFAULT_SECTIONS;

  const known = sections.filter((s): s is SectionConfig =>
    (SECTION_KEYS as readonly string[]).includes(s.key)
  );
  const seen = new Set(known.map((s) => s.key));
  const missing = SECTION_KEYS.filter((k) => !seen.has(k)).map((key) => ({ key, enabled: true }));
  return [...known, ...missing];
}
