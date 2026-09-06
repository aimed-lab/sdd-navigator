// lib/showcaseTypes.ts — Promote showcase types + constants, shared by server
// and client.
//
// Dependency-free by design, same reason as lib/collabTypes.ts: client
// components need the VALUE constants (SHOWCASE_TYPES for the filter chips and
// the submit form's select), and importing those from lib/server/showcase.ts
// would drag its transitive `next/headers` dependency into the client bundle.
// Type-only imports get erased; value imports do not.
//
// Rule: anything a "use client" component imports as a VALUE belongs here.

// These are the six choices the /promote/submit flow opens with (see
// components/promote/SubmitFlow.tsx) — "what are you showcasing?" — and
// double as the Type field in the editor and the gallery's filter chips.
// "paper" is the one choice that goes through DOI/PubMed generation; every
// other choice is written by hand. Replaced the old
// case_study/paper/white_paper/achievement set (kept below, read-only, for
// rows created before this picker existed).
export const SHOWCASE_TYPES = ["paper", "talk", "poster", "award", "tool", "other"] as const;
export type ShowcaseType = (typeof SHOWCASE_TYPES)[number];

/** Human labels for the type chips / select. */
export const SHOWCASE_TYPE_LABEL: Record<ShowcaseType, string> = {
  paper: "Paper",
  talk: "Conference or talk",
  poster: "Poster",
  award: "Award or milestone",
  tool: "Tool or software",
  other: "Something else",
};

/** Labels for `type` values a row may still carry from before this picker
 *  replaced the old four-category set — never offered as a choice anymore,
 *  only read so an old gallery card still shows a real label instead of the
 *  raw column value. See ShowcaseCard.tsx. */
export const LEGACY_SHOWCASE_TYPE_LABEL: Record<string, string> = {
  case_study: "Case study",
  white_paper: "White paper",
  achievement: "Achievement",
};

/** Material Symbols icon name per type — used ONLY for the gallery card's
 *  no-image placeholder (ShowcaseCard.tsx). Not a decision the picker made
 *  before (there was one, in the now-removed category cards); kept here as
 *  the single source since the card is the only place it matters now. */
export const SHOWCASE_TYPE_ICON: Record<ShowcaseType, string> = {
  paper: "science",
  talk: "podium",
  poster: "image",
  award: "emoji_events",
  tool: "build",
  other: "auto_awesome",
};

/** Fallback icon for a legacy `type` value with no entry above. */
export const DEFAULT_SHOWCASE_TYPE_ICON = "auto_awesome";

/** Background/text pairing per type for the gallery card's GENERATED COVER
 *  (ShowcaseCard.tsx) — the solid tinted panel an entry gets when it has no
 *  image of its own. Built entirely from tokens already in
 *  tailwind.config.ts (no new colours): the three hue families the palette
 *  actually has (primary/green, secondary/blue-grey, tertiary/blue), kept
 *  muted via low opacity rather than the saturated base colour, since
 *  several of these sit side by side in one grid. Six categories only
 *  really give three distinguishable hues here — the background icon
 *  (SHOWCASE_TYPE_ICON) carries the rest of the distinction, same as a real
 *  photo would. Every category uses the EXACT SAME cover structure — only
 *  bg/text change — so the six don't read as six different components. */
export const SHOWCASE_TYPE_COVER: Record<ShowcaseType, { bg: string; text: string }> = {
  paper: { bg: "bg-primary/10", text: "text-primary" },
  talk: { bg: "bg-secondary/10", text: "text-secondary" },
  poster: { bg: "bg-tertiary/10", text: "text-tertiary" },
  award: { bg: "bg-primary/20", text: "text-primary" },
  tool: { bg: "bg-secondary-container/60", text: "text-on-secondary-container" },
  other: { bg: "bg-surface-container-high", text: "text-on-surface-variant" },
};

/** Cover tint for a legacy `type` value with no entry above — neutral, same
 *  as `other`. */
export const DEFAULT_SHOWCASE_TYPE_COVER = {
  bg: "bg-surface-container-high",
  text: "text-on-surface-variant",
};

export type ShowcaseOwner = {
  id: string;
  name: string | null;
  affiliation: string | null;
};

export type ShowcaseEntry = {
  id: string;
  type: ShowcaseType;
  title: string;
  description: string;
  authors: string;
  link: string | null;
  image_url: string | null;
  tags: string[];
  created_at: string;
  owner: ShowcaseOwner | null;
  /** Only ever populated for type="paper" — shown in small caps above the
   *  headline on a generated cover (ShowcaseCard.tsx) when known. */
  journal: string | null;
  /** Computed server-side (session user vs. the row's owner_id) — owner_id
   *  itself is never sent to the browser, just this yes/no. The client uses
   *  it only to decide whether to SHOW the delete affordance; the actual
   *  gate is the promote_showcase_delete_own RLS policy, enforced again in
   *  Postgres regardless of what this flag says. */
  is_owner: boolean;
  /** Non-null only for an entry created through the unified /promote/submit
   *  flow — it has a hosted article at /promote/[slug]. Older/legacy rows
   *  (created before that flow existed) have neither, and the gallery card
   *  falls back to `title`/`link` for those. */
  slug: string | null;
  headline: string;
  standfirst: string;
  /** Needed only for estimateReadMinutes on the card — never rendered
   *  directly there (the full body is the article page's job). */
  articleBody: string;
  publishedAt: string | null;
  /** The card's actual image, already resolved server-side, per request, to
   *  a real URL: the first `image`-kind attached media (signed, short-lived
   *  — see lib/server/showcase.ts:getShowcaseHeroImages) if there is one,
   *  else the legacy `image_url` column, else null. Never re-derive this
   *  client-side from `image_url` alone — that would skip attached media
   *  entirely and silently show nothing for every post-media-table entry
   *  that has a hero image. */
  heroImageUrl: string | null;
};

// ── generator (public, no auth) ───────────────────────────────────────────────
//
// The generator itself (/api/promote/generate) is public and stateless — it
// only fetches metadata and asks Groq to draft an article; it writes nothing.
// Turning a draft into a shareable page (POST-ing it into promote_showcase,
// getting a slug, publishing) requires a session and goes through
// app/promote/actions.ts, not this route.

export type GeneratorResult = {
  paper: {
    title: string;
    authors: string[];
    sourceUrl: string;
    doi: string | null;
    pmid: string | null;
    publishedDate: string | null;
    journal: string | null;
  };
  headline: string;
  standfirst: string;
  /** "## Section heading" separated plain-prose body — see
   *  lib/server/promote/generateArticle.ts. Editable as one plain textarea. */
  articleBody: string;
};

// ── article draft (create/edit/publish) ────────────────────────────────────
//
// The unified /promote/submit flow: paste a DOI (default) or go manual,
// generate/write the article, edit it, attach media, publish. One flow, one
// row shape, whether or not a paper was involved.

export type CreateArticleInput = {
  type: ShowcaseType;
  title: string;
  headline: string;
  standfirst: string;
  articleBody: string;
  authors: string;
  doi: string | null;
  link: string | null;
  journal: string | null;
};

export type ArticleDraftPatch = {
  type?: ShowcaseType;
  headline?: string;
  standfirst?: string;
  articleBody?: string;
  authors?: string;
  /** Only ever set together, by SubmitFlow's generate() when a DOI lookup
   *  succeeds against a row that already exists (lazily created earlier
   *  from typing or an attached file, before the person used the DOI box) —
   *  so that reuse doesn't lose the paper's citation details the way a
   *  patch touching only headline/standfirst/articleBody/authors would. */
  doi?: string | null;
  link?: string | null;
  journal?: string | null;
};

// ── media attachments ────────────────────────────────────────────────────

export const MEDIA_KINDS = ["image", "slides"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export type ShowcaseMedia = {
  id: string;
  kind: MediaKind;
  /** A signed, short-lived URL — never a stable/public one, since the
   *  showcase-media bucket is private. Re-fetched per page load. */
  url: string;
  filename: string;
  sizeBytes: number;
};

/** The public article at /promote/[slug] — everything the page needs to
 *  render, nothing more (no owner_id, no draft-only fields). */
export type PublicArticle = {
  slug: string;
  headline: string;
  standfirst: string;
  articleBody: string;
  title: string;
  authors: string;
  doi: string | null;
  link: string | null;
  journal: string | null;
  image_url: string | null;
  media: ShowcaseMedia[];
  created_at: string;
  /** When this article was (most recently) published — null is only
   *  reachable in practice through a direct/urltampered slug lookup, since
   *  getPublishedArticleBySlug only ever returns a row with published=true,
   *  and setArticlePublished(true) always stamps this. */
  publishedAt: string | null;
};
