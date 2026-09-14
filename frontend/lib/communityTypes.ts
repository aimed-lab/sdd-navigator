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
  "explore",
  "announcements",
  "events",
  "who_can_help",
  "showcase",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export type SectionConfig = { key: SectionKey; enabled: boolean };

export const SECTION_LABEL: Record<SectionKey, string> = {
  projects: "Projects",
  members: "Members",
  resources: "Resources",
  explore: "Explore",
  announcements: "Announcements",
  events: "Events",
  who_can_help: "Who can help",
  // Promote articles (database/migrations/2026-09-13_promote_showcase_community.sql)
  // attached to this community — see app/communities/[slug]/page.tsx's
  // "showcase" case and lib/server/showcase.ts:listShowcaseByCommunity.
  showcase: "Showcase",
};

// What a NON-member sees before joining
// (database/migrations/2026-09-18_community_public_preview.sql) — the
// equivalent choice to SECTION_KEYS above, but for WHO can see it rather
// than WHAT appears for a member. Split out here for the same reason as
// everything else in this file: PublicPreviewEditor (a client component)
// needs PUBLIC_PREVIEW_LABEL as a value.
export const PUBLIC_PREVIEW_LEVELS = ["standard", "minimal"] as const;
export type PublicPreviewLevel = (typeof PUBLIC_PREVIEW_LEVELS)[number];

export const PUBLIC_PREVIEW_LABEL: Record<PublicPreviewLevel, string> = {
  standard: "Standard — name, purpose, member count, and a preview of the feed",
  minimal: "Minimal — name and purpose only",
};

/** SECTION_KEYS order, all enabled — what a NULL `communities.sections`
 *  resolves to (see resolveSections below). "Projects stays where it is
 *  when enabled": projects is first here, the same position it already
 *  renders in today, so a community that has never touched the Sections
 *  editor (sections IS NULL) shows it in exactly the same place it always
 *  has. */
// Resource types for the Resources section
// (database/migrations/2026-09-03_community_resources.sql). Split out here
// rather than living only in lib/server/communities.ts for the same reason
// as everything else in this file: a client component (ResourcesSection's
// type dropdown) needs COMMUNITY_RESOURCE_TYPES as a VALUE, and any
// non-type-only import from lib/server/communities.ts drags in
// supabaseServer.ts -> supabaseRoute.ts -> next/headers, which breaks the
// client bundle. lib/server/communities.ts imports these from here rather
// than redeclaring them, so there is exactly one list to keep in sync with
// the DB's CHECK constraint.
export type CommunityResourceType = "tool" | "paper" | "dataset" | "link" | "podcast" | "other";

export const COMMUNITY_RESOURCE_TYPES: CommunityResourceType[] = [
  "tool",
  "paper",
  "dataset",
  "link",
  "podcast",
  "other",
];

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

// ── Community-scoped Explore feed ───────────────────────────────────────────
//
// database/migrations/2026-09-06_community_feed.sql. Split out here for the
// same reason as everything else in this file: ExploreFeedEditor
// ("use client") needs these as VALUES for its checkboxes, and
// community_feed_items.kind must match ExploreItem.kind
// (frontend/types/explore.ts) exactly — "episode", not "podcast" — so a
// result from /api/explore-source can be stored with zero translation.
// EXPLORE_SOURCE_LABEL is where "episode" gets a human label ("Podcast")
// instead, matching the ten sources as the admin thinks of them.
export const EXPLORE_SOURCE_KEYS = [
  "paper",
  "dataset",
  "geneset",
  "compound",
  "target",
  "trial",
  "grant",
  "tool",
  "news",
  "episode",
] as const;

export type ExploreSourceKind = (typeof EXPLORE_SOURCE_KEYS)[number];

export const EXPLORE_SOURCE_LABEL: Record<ExploreSourceKind, string> = {
  paper: "Papers",
  dataset: "Datasets",
  geneset: "Gene sets",
  compound: "Compounds",
  target: "Targets",
  trial: "Trials",
  grant: "Grants",
  tool: "Tools",
  news: "News",
  episode: "Podcast",
};

/** Drop anything that isn't one of the ten known kinds — same "trust order
 *  and contents, drop what's unrecognized" posture as resolveSections,
 *  applied to a flat set rather than an ordered array (source selection has
 *  no order to preserve). */
export function resolveExploreSources(sources: string[] | null | undefined): ExploreSourceKind[] {
  if (!sources) return [];
  const known = new Set(EXPLORE_SOURCE_KEYS as readonly string[]);
  return sources.filter((s): s is ExploreSourceKind => known.has(s));
}
