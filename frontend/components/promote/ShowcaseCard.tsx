"use client";

// One showcase entry, as an image-led editorial card.
//
// Every non-featured card is IDENTICAL in height, by construction, not by
// grid stretching alone (grid stretch can't fix content of different
// lengths): a fixed 16:9 image/cover, then a fixed-height content block —
// the headline's wrapper reserves two full lines even when the text is one
// line (line-clamp-2 truncates the overflow, a fixed h-14/h-16 +
// overflow-hidden is a hard backstop), and the meta line is pinned to the
// bottom with `mt-auto`. No author list here anymore — at this size it
// truncated into noise, and it's already on the article page.
//
// `featured` (set by the caller, app/promote/page.tsx, for the first entry
// only) is a STRUCTURALLY DIFFERENT layout, not a bigger version of the
// same one — cover on the left, text on the right, full width, on its own
// row. Two earlier versions of this both forced a second card into the same
// row as the featured one (spanning grid columns, then flex-basis widths),
// and BOTH made that second card stretch to the featured card's height —
// which for a card with only a headline and a meta line is mostly empty
// space with the date stranded at the bottom. There is no version of
// "stretch a short card to match a tall one" that doesn't produce that
// void, so the featured card no longer shares a row with anything: it's
// full width, side-by-side internally instead of tall, and everything else
// renders in its own uniform grid below where every card genuinely is the
// same height because they all have the same content shape, not because
// one was forced to match a stranger.
//
// NO IMAGE -> a GENERATED COVER, not a placeholder. It carries CONTEXT, not
// the headline — the headline already appears once, right below/beside the
// cover; repeating it a second time (an earlier version of this did) read
// as a rendering bug, not a design choice, especially once both copies were
// clipped mid-sentence. The cover shows: the category name, large; the
// journal/venue underneath in small caps when known; the category icon
// large in the background at low opacity, not a small corner mark. Every
// category renders through the exact same structure (GeneratedCover below)
// — only the tint (SHOWCASE_TYPE_COVER) changes — so it never looks like a
// different component per category.
//
// Owner-only Edit/Delete are a small kebab menu revealed on hover
// (`group`/`group-hover`), absolutely positioned over the top-right corner
// so they never occupy layout space — a browsing surface, not an admin
// table, and this is also what keeps an owned card and an unowned card
// exactly the same height.
//
// The hero image itself is `entry.heroImageUrl`, resolved server-side per
// request in lib/server/showcase.ts (listShowcase -> getShowcaseHeroImages)
// — a freshly signed URL when the entry has attached media, since those
// expire and can never be cached into a stale link, falling back to the
// legacy `image_url` column for a pre-media-table row. This component only
// renders whatever it's given; it never re-derives or re-fetches the URL.
//
// Client component because the owner-only delete confirm and the hover
// menu both need local state — same reason collaborate/PostCard.tsx is a
// client component.
//
// An entry created through the unified /promote/submit flow has a `slug`
// and links to its hosted article at /promote/[slug] — the headline (not
// the paper's own title) is what's shown, since the headline is what the
// author actually wrote/edited for this card. The link to the ORIGINAL
// paper lives on the article page itself, not here. A legacy entry with no
// slug (created before this flow existed) falls back to its title and
// external `link`.

import { useState } from "react";
import Link from "next/link";
import type { ShowcaseEntry, ShowcaseType } from "@/lib/showcaseTypes";
import {
  DEFAULT_SHOWCASE_TYPE_COVER,
  DEFAULT_SHOWCASE_TYPE_ICON,
  LEGACY_SHOWCASE_TYPE_LABEL,
  SHOWCASE_TYPE_COVER,
  SHOWCASE_TYPE_ICON,
  SHOWCASE_TYPE_LABEL,
} from "@/lib/showcaseTypes";
import { estimateReadMinutes, formatPublishedDate } from "@/lib/articleFormat";
import DeleteShowcaseConfirm from "./DeleteShowcaseConfirm";

/** The generated cover for an entry with no image of its own — context, not
 *  the headline (that's already right below/beside it). ONE structure for
 *  every category: a large background icon at low opacity, the category
 *  name as the main element, the journal/venue in small caps above it when
 *  known. Only `cover.bg`/`cover.text` (the type's tint) ever changes. */
function GeneratedCover({
  type,
  icon,
  category,
  venue,
  featured,
}: {
  type: ShowcaseType | string;
  icon: string;
  category: string;
  venue: string | null;
  featured: boolean;
}) {
  const cover =
    (SHOWCASE_TYPE_COVER as Record<string, { bg: string; text: string }>)[type] ??
    DEFAULT_SHOWCASE_TYPE_COVER;

  return (
    <div className={`relative w-full h-full overflow-hidden flex items-center ${cover.bg}`}>
      {/* font-size via inline style, not a Tailwind text-[Xrem] class: verified
          in a real browser that .material-symbols-outlined's own CSS (globals.css)
          wins the cascade over that utility for font-size specifically (some
          other property in its rule set outranks utilities here — opacity and
          every other utility on this element apply fine, only font-size doesn't),
          so the icon silently rendered at the icon font's normal 24px instead of
          "large... as a background element" no matter what size class was used.
          An inline style always wins, sidestepping the cascade question entirely. */}
      <span
        aria-hidden
        className={`material-symbols-outlined absolute -right-4 -bottom-4 pointer-events-none select-none ${cover.text} opacity-[0.14]`}
        style={{ fontSize: featured ? "9rem" : "6rem" }}
      >
        {icon}
      </span>
      <div className="relative px-5 py-4">
        {venue && (
          <p
            className={`uppercase tracking-wide font-label-sm text-label-sm mb-1.5 ${cover.text} opacity-70`}
          >
            {venue}
          </p>
        )}
        <p className={`font-headline-md ${cover.text} ${featured ? "text-2xl" : "text-xl"}`}>
          {category}
        </p>
      </div>
    </div>
  );
}

export default function ShowcaseCard({
  entry,
  featured = false,
  className = "",
}: {
  entry: ShowcaseEntry;
  featured?: boolean;
  /** Outer sizing only (grid/flex width) — the caller's job. Internal
   *  layout (image ratio, spacing, height) is this component's. */
  className?: string;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const heading = entry.headline || entry.title;
  const href = entry.slug ? `/promote/${entry.slug}` : null;
  // A legacy entry (no slug, so no hosted article) still needs SOME way to
  // reach it — it used to be a separate "View" action; the whole card is
  // effectively behind the headline now, so this is what it links to when
  // there's no /promote/[slug] page to send it to.
  const externalHref = !href ? entry.link : null;

  // A row from before the current 6-category picker may carry a value
  // (case_study/white_paper/achievement) SHOWCASE_TYPE_LABEL/ICON no longer
  // has a key for — fall back to the legacy label map / a generic icon.
  const typeLabel =
    (SHOWCASE_TYPE_LABEL as Record<string, string>)[entry.type] ??
    LEGACY_SHOWCASE_TYPE_LABEL[entry.type] ??
    entry.type;
  const typeIcon =
    (SHOWCASE_TYPE_ICON as Record<string, string>)[entry.type] ?? DEFAULT_SHOWCASE_TYPE_ICON;

  const readMinutes = estimateReadMinutes(entry.standfirst, entry.articleBody);
  const meta = [
    entry.publishedAt ? formatPublishedDate(entry.publishedAt) : null,
    `${readMinutes} min read`,
  ]
    .filter(Boolean)
    .join(" · ");

  const cover = entry.heroImageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={entry.heroImageUrl}
      alt=""
      loading="lazy"
      decoding="async"
      className="w-full h-full object-cover"
    />
  ) : (
    <GeneratedCover
      type={entry.type}
      icon={typeIcon}
      category={typeLabel}
      venue={entry.type === "paper" ? entry.journal : null}
      featured={featured}
    />
  );

  // line-clamp-2 goes directly on the Link/anchor, with NO "block" alongside
  // it — verified in a real browser that adding "block" here silently wins
  // the `display` property over line-clamp-2's own required
  // `display:-webkit-box` (both utilities set `display`; "block" happened
  // to be the one Tailwind emits later), which disables the clamp entirely.
  // Without "block", line-clamp-2 applies its own display value and clips
  // correctly on its own — no wrapper needed.
  const headingContent = href ? (
    <Link href={href} className="line-clamp-2 hover:underline underline-offset-4">
      {heading}
    </Link>
  ) : externalHref ? (
    <a
      href={externalHref}
      target="_blank"
      rel="noopener noreferrer"
      className="line-clamp-2 hover:underline underline-offset-4"
    >
      {heading}
    </a>
  ) : (
    <span className="line-clamp-2">{heading}</span>
  );

  const ownerMenu = entry.is_owner && (
    <div className="absolute top-2 right-2 z-10">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        aria-label="Entry actions"
        className="w-8 h-8 rounded-full bg-surface-container-lowest/90 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shadow-sm"
      >
        <span className="material-symbols-outlined text-secondary text-lg">more_vert</span>
      </button>

      {menuOpen && (
        <>
          {/* Click-outside catcher — sits under the menu, above everything else */}
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 mt-1 w-32 rounded-lg bg-surface-container-lowest shadow-lg border border-outline-variant/30 overflow-hidden z-20">
            {href && (
              <Link
                href={`${href}/edit`}
                className="block px-4 py-2 font-label-sm text-label-sm text-on-background hover:bg-surface-container-low"
                onClick={() => setMenuOpen(false)}
              >
                Edit
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setConfirmingDelete(true);
              }}
              className="block w-full text-left px-4 py-2 font-label-sm text-label-sm text-error hover:bg-surface-container-low"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );

  const deleteConfirm = confirmingDelete && (
    <DeleteShowcaseConfirm
      entryId={entry.id}
      entryTitle={entry.title}
      onClose={() => setConfirmingDelete(false)}
    />
  );

  // ── Featured: full width, cover left / text right, own row ────────────────
  // No fixed/reserved headline height here — nothing else shares this row to
  // stay level with, so there's nothing to protect against a shorter
  // neighbour stretching into empty space. line-clamp-2 alone keeps a very
  // long headline from growing the row without bound.
  if (featured) {
    return (
      <>
        <article
          className={`glass-panel rounded-2xl overflow-hidden flex flex-col md:flex-row relative group ${className}`}
        >
          {ownerMenu}

          <div className="w-full md:w-2/5 lg:w-1/3 aspect-video md:aspect-auto shrink-0 overflow-hidden">
            {cover}
          </div>

          <div className="flex flex-col flex-1 justify-center gap-2 p-6 md:p-8">
            <span className="self-start px-3 py-1 rounded-full bg-primary/5 text-primary font-label-sm text-label-sm">
              {typeLabel}
            </span>

            <h3 className="font-headline-md text-2xl md:text-3xl leading-tight text-on-background line-clamp-2">
              {headingContent}
            </h3>

            {entry.standfirst && (
              <p className="font-body-md text-body-md text-secondary line-clamp-2">
                {entry.standfirst}
              </p>
            )}

            <p className="font-label-sm text-label-sm text-secondary">{meta}</p>
          </div>
        </article>

        {deleteConfirm}
      </>
    );
  }

  // ── Every other entry: uniform vertical card ───────────────────────────────
  return (
    <>
      <article
        className={`glass-panel rounded-2xl overflow-hidden flex flex-col h-full relative group ${className}`}
      >
        {ownerMenu}

        <div className="w-full shrink-0 aspect-video overflow-hidden">{cover}</div>

        <div className="flex flex-col flex-1 p-6">
          <span className="self-start px-3 py-1 mb-3 rounded-full bg-primary/5 text-primary font-label-sm text-label-sm">
            {typeLabel}
          </span>

          {/* Fixed height (h-14), not min-height, + overflow-hidden: a hard
              backstop so an unusually long headline can never grow this box
              past two lines even if line-clamp somehow didn't apply — every
              non-featured card needs to be the SAME height regardless of
              content, and a min-height only sets a floor, not a ceiling. */}
          <h3 className="font-headline-md text-lg leading-tight text-on-background overflow-hidden h-14">
            {headingContent}
          </h3>

          {/* Pinned to the bottom on purpose, not just spaced under the
              headline — this is what makes every card here the same height
              read as intentional rather than coincidental. */}
          <p className="mt-auto pt-2 font-label-sm text-label-sm text-secondary">{meta}</p>
        </div>
      </article>

      {deleteConfirm}
    </>
  );
}
