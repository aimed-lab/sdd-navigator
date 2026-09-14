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

// These are the seven choices the /promote/submit flow opens with (see
// components/promote/SubmitFlow.tsx) — "what are you showcasing?" — and
// double as the Type field in the editor and the gallery's filter chips.
// "paper" is the one choice that goes through DOI/PubMed generation; every
// other choice goes through the structured five-question form
// (STRUCTURED_QUESTIONS below) instead of being written by hand. Replaced
// the old case_study/paper/white_paper/achievement set (kept below,
// read-only, for rows created before this picker existed).
//
// "event" added alongside the original five: a talk and an event share a
// where/when context question, but need genuinely different second
// questions ("what did people think before/now" vs "why does this matter
// now" — see STRUCTURED_QUESTIONS), which only makes sense as two types,
// not one relabeled.
export const SHOWCASE_TYPES = ["paper", "talk", "poster", "award", "tool", "event", "other"] as const;
export type ShowcaseType = (typeof SHOWCASE_TYPES)[number];

/** Human labels for the type chips / select. */
export const SHOWCASE_TYPE_LABEL: Record<ShowcaseType, string> = {
  paper: "Paper",
  talk: "Conference or talk",
  poster: "Poster",
  award: "Award or milestone",
  tool: "Tool or software",
  event: "Event",
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
  event: "event",
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
  event: { bg: "bg-tertiary/20", text: "text-tertiary" },
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

/** The community a showcase entry is attached to — just enough to render a
 *  link, never the full Community shape (that's lib/server/communities.ts's
 *  job). Communities are publicly readable (RLS: USING (true)), so this can
 *  always be resolved regardless of who's viewing, the same way `owner`
 *  above is resolved for a signed-out visitor. */
export type ShowcaseCommunity = {
  id: string;
  slug: string;
  name: string;
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
  /** Null for an entry attached to no community (the default) — see
   *  database/migrations/2026-09-13_promote_showcase_community.sql. Not
   *  rendered on the gallery card today (ShowcaseCard.tsx); it's what the
   *  community page's own Showcase section and the article page's eyebrow
   *  link use. */
  community: ShowcaseCommunity | null;
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
  /** The LinkedIn post — hook/contrast/bullets/humility/ask/hashtags, with a
   *  literal "{{ARTICLE_LINK}}" placeholder in place of the URL (filled in
   *  at copy time — see ShareButtons.tsx). This, not the article, is the
   *  thing the flow is actually for; the article is the page the post links
   *  to. See lib/server/promote/generateArticle.ts for the shape rules. */
  linkedinPost: string;
};

// ── structured (non-paper) generator, public, no auth ───────────────────────
//
// The model post Prof. Chen pointed at was hand-written, not sourced from a
// DOI or a repo — what made it work was its SHAPE, not where its content
// came from. So every non-paper type (talk/poster/award/tool/event/other)
// asks the same five questions rather than fetching anything: what people
// lack is the shape to write in, not source data to draft from. A GitHub
// URL is still accepted, but only as an OPTIONAL prefill for the tool
// type's own five answers (see components/promote/GithubPrefill.tsx) — it
// is never itself the thing that gets generated from, and the form works
// completely without it.
//
// ONE set of five slots for every type — oneLiner/contrast/specifics/
// context/audience — because the ANSWERS already carry whatever is
// type-specific once someone's actually written them (a talk's contrast
// answer already reads "people used to think X, now they think Y" because
// that's the question they were asked). Only the QUESTION WORDING AND
// EXAMPLE differ per type (STRUCTURED_QUESTIONS below); the generation
// prompt itself (lib/server/promote/generateStructuredArticle.ts) is one
// prompt, not six, parameterized by `type` for register only (first person
// "I built…" vs "I gave a talk on…") plus these five answers.
export type StructuredAnswers = {
  /** Q1 — what it is, in one line. */
  oneLiner: string;
  /** Q2 — the contrast: before vs. now (talk: what people thought before
   *  vs. now; event: replaced entirely by "why does this matter now" — see
   *  STRUCTURED_QUESTIONS' own per-type override). */
  contrast: string;
  /** Q3 — three to five specific things, IN THE PERSON'S OWN WORDS. Kept as
   *  separate strings (one per line in the form), not one blob, so the
   *  generator can turn each into exactly one ◆ bullet without having to
   *  guess where one specific ends and the next begins. This is the field
   *  the prompt is told NEVER to invent from, only lightly tighten — see
   *  that module's own comment on why this is the one element a summary
   *  can't manufacture. */
  specifics: string[];
  /** Q4 — context: stage (tool), where/when (talk/event), which conference
   *  (poster). Drives whether the generated post includes a hedge — an
   *  "early/prototype/first time" context earns one, an
   *  "established/validated/already delivered" context doesn't. The
   *  generation prompt makes this call from the TEXT here, the same way
   *  generateArticle.ts's paper prompt judges hedging from the abstract's
   *  own wording — not a keyword list in application code. */
  context: string;
  /** Q5 — who they want to hear from, by field or role. Drives the post's
   *  ask line directly: named close to verbatim, never widened to a
   *  generic "the community". */
  audience: string;
};

export type StructuredGeneratorResult = {
  headline: string;
  standfirst: string;
  articleBody: string;
  linkedinPost: string;
};

/** One question's label + a real example answer, shown directly under the
 *  field so someone knows what a good answer looks like before they type
 *  anything — not a placeholder that vanishes on focus. */
export type StructuredQuestion = { label: string; example: string };

export type StructuredQuestionSet = {
  oneLiner: StructuredQuestion;
  contrast: StructuredQuestion;
  specifics: StructuredQuestion;
  context: StructuredQuestion;
  audience: StructuredQuestion;
};

/** Every non-paper type's wording for the same five slots. "paper" is
 *  intentionally absent — it never reaches this form, see SubmitFlow.tsx.
 *  Examples below are deliberately concrete and specific (real commands,
 *  real numbers, a real venue) rather than generic placeholders, matching
 *  the same "a specific travels, a summary doesn't" standard the generated
 *  posts themselves are held to. */
export const STRUCTURED_QUESTIONS: Record<Exclude<ShowcaseType, "paper">, StructuredQuestionSet> = {
  tool: {
    oneLiner: {
      label: "What is it, in one line",
      example: "A command-line tool that finds every off-target for a CRISPR guide RNA in under a second.",
    },
    contrast: {
      label: "What did people have to do before, and what can they do now",
      example:
        "Before: run a BLAST search by hand and cross-reference three databases yourself. Now: one command, one answer, thirty seconds.",
    },
    specifics: {
      label: "Three to five example commands a user would actually type",
      example: "guidefinder scan --guide GACCTAGCTAGCTAGCTAGC --genome hg38",
    },
    context: {
      label: "What stage it's at",
      example: "Early — I've been using it on my own projects for two months, not yet used outside my lab.",
    },
    audience: {
      label: "Who you want to hear from",
      example: "People doing CRISPR screens or guide RNA design, especially anyone on a non-human genome.",
    },
  },
  talk: {
    oneLiner: {
      label: "What is it, in one line",
      example: "A talk on why most drug-target papers can't be reproduced from the methods section alone.",
    },
    contrast: {
      label: "What did people think before this, and what do they think now",
      example:
        "Before: assumed a target ID pipeline in a paper was basically reproducible if you had the data. Now: several people came up afterward saying they'd never actually tried rerunning one end to end.",
    },
    specifics: {
      label: "Three to five things someone walks away able to do",
      example: "Spot the three most common places a target-ID pipeline silently forks from what's written up.",
    },
    context: {
      label: "Where and when",
      example: "AACR Annual Meeting, session on computational target discovery, April 2026.",
    },
    audience: {
      label: "Who you want to hear from",
      example: "Anyone who's tried to reproduce a published target discovery pipeline and hit a wall.",
    },
  },
  poster: {
    oneLiner: {
      label: "What is it, in one line",
      example: "A poster on a computational screen that found 12 candidate compounds for a previously undruggable target.",
    },
    contrast: {
      label: "What did people have to do before, and what can they do now",
      example:
        "Before: this target had no known small-molecule binders and no structural handle to screen against. Now: a predicted pocket and 12 ranked candidates to start from.",
    },
    specifics: {
      label: "Three to five specific findings",
      example: "12 candidates ranked by predicted binding affinity, 3 with binding energies below -9 kcal/mol.",
    },
    context: {
      label: "Which conference",
      example: "ACS Fall 2026, poster session on computational drug discovery.",
    },
    audience: {
      label: "Who you want to hear from",
      example: "Structural biologists or medicinal chemists who've worked on this target family before.",
    },
  },
  award: {
    oneLiner: {
      label: "What is it, in one line",
      example: "Our lab's early-career investigator award for work on antibody developability prediction.",
    },
    contrast: {
      label: "What did people have to do before, and what can they do now",
      example:
        "Before: developability was assessed late, after a candidate was already selected. Now: the model flags likely aggregation risk before synthesis.",
    },
    specifics: {
      label: "Three to five specific things about the work being recognized",
      example: "Screened 40,000 candidate sequences, flagged aggregation risk with 85% precision on held-out data.",
    },
    context: {
      label: "What it's for and when",
      example: "American Association of Immunologists early-career award, announced March 2026.",
    },
    audience: {
      label: "Who you want to hear from",
      example: "Other groups working on antibody developability or biologics manufacturability.",
    },
  },
  event: {
    oneLiner: {
      label: "What is it, in one line",
      example: "A one-day workshop on reproducible computational pipelines for drug discovery.",
    },
    contrast: {
      label: "Why does this matter now",
      example:
        "Every lab we talked to has been burned by a pipeline that worked on one machine and nowhere else — this is the first time we're getting people in a room to actually fix that together.",
    },
    specifics: {
      label: "Three to five specific things happening at it",
      example: "A hands-on session rebuilding a real published pipeline from scratch, live, with the audience.",
    },
    context: {
      label: "Where and when",
      example: "Boston, June 12 2026, hosted at the Broad Institute.",
    },
    audience: {
      label: "Who you want to hear from",
      example: "Anyone who's maintained a computational pipeline other people depend on.",
    },
  },
  other: {
    oneLiner: {
      label: "What is it, in one line",
      example: "A public dataset of 500 curated drug-target interaction pairs with confidence scores.",
    },
    contrast: {
      label: "What did people have to do before, and what can they do now",
      example:
        "Before: cobble together interaction data from five inconsistent sources by hand. Now: one file, one schema, confidence-scored.",
    },
    specifics: {
      label: "Three to five specific things about it",
      example: "500 pairs, each scored 0-1 for confidence, sourced from six curated databases with citations.",
    },
    context: {
      label: "The relevant context",
      example: "First release — built over the past three months, not yet used outside my own project.",
    },
    audience: {
      label: "Who you want to hear from",
      example: "Anyone building a model that needs labeled drug-target interaction data.",
    },
  },
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
  /** See GeneratorResult's own comment — the "{{ARTICLE_LINK}}" placeholder
   *  convention applies here too. */
  linkedinPost: string;
  /** Optional, defaults to none (null) — see ShowcaseCommunity's own
   *  comment. Only ever one of the ids listMyActiveCommunities() (lib/server
   *  /communities.ts) returned for the signed-in author; a forged id isn't
   *  stopped by anything client-side, but is by
   *  promote_showcase_insert_own/update_own's WITH CHECK
   *  (can_post_to_community) in the database. */
  communityId: string | null;
};

export type ArticleDraftPatch = {
  type?: ShowcaseType;
  headline?: string;
  standfirst?: string;
  articleBody?: string;
  authors?: string;
  linkedinPost?: string;
  communityId?: string | null;
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
  /** Drives the category pill in the page's eyebrow row. Typed loosely
   *  (not ShowcaseType) because a pre-picker legacy row can carry a value
   *  SHOWCASE_TYPE_LABEL has no key for — see LEGACY_SHOWCASE_TYPE_LABEL. */
  type: string;
  headline: string;
  standfirst: string;
  articleBody: string;
  /** See GeneratorResult's own comment — never rendered raw; ShareButtons
   *  substitutes "{{ARTICLE_LINK}}" for this article's own URL before
   *  copying it. Empty for an entry created before this field existed. */
  linkedinPost: string;
  title: string;
  authors: string;
  doi: string | null;
  link: string | null;
  journal: string | null;
  image_url: string | null;
  media: ShowcaseMedia[];
  /** Null for an article attached to no community — see ShowcaseEntry's own
   *  comment. Rendered as a pill/link in the eyebrow row, next to the
   *  category pill (app/promote/[slug]/page.tsx). */
  community: ShowcaseCommunity | null;
  created_at: string;
  /** When this article was (most recently) published — null is only
   *  reachable in practice through a direct/urltampered slug lookup, since
   *  getPublishedArticleBySlug only ever returns a row with published=true,
   *  and setArticlePublished(true) always stamps this. */
  publishedAt: string | null;
  /** Who posted this — name + affiliation only, via showcase_owners()
   *  (never a plain join; see that function's own comment on why). Null if
   *  the owner lookup itself failed, same degrade-to-uncredited behavior as
   *  the gallery card; the page skips the attribution line rather than
   *  showing a blank one. */
  owner: ShowcaseOwner | null;
};
