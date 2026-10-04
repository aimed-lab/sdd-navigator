"use client";

// One showcase entry, as an editorial tile (same look as Explore's tiles): tint
// by entry type, 14px radius, no border, serif title, a 2-line summary and a
// muted date line.
//
// IMAGE: when an entry has one it is shown as a proper cover, object-fit: cover
// in a FIXED aspect ratio (16:9 on a regular tile, 3:2 on the featured one), so
// it can never be cropped into a corner. With no image there is NO image box at
// all; the tinted tile just starts with its text.
//
// `featured` (the first entry, set by app/promote/page.tsx) is a wide tile:
// image on the left, text on the right and vertically centred, so the tint fills
// the row and there's no empty white space.
//
// Owner-only Edit/Delete are a small kebab menu revealed on hover
// (`group`/`group-hover`), absolutely positioned over the top-right corner so
// they never occupy layout space.
//
// The hero image is `entry.heroImageUrl`, resolved server-side per request in
// lib/server/showcase.ts (a freshly signed URL for attached media, else the
// legacy `image_url`). This component only renders what it's given.
//
// An entry created through /promote/submit has a `slug` and links to its hosted
// article at /promote/[slug]; the headline (what the author edited for this
// card) is what's shown. A legacy entry with no slug falls back to its title
// and external `link`. The whole tile is clickable through the headline link.
//
// Client component because the owner-only delete confirm and the hover menu
// need local state.

import { useState } from "react";
import Link from "next/link";
import type { ShowcaseEntry } from "@/lib/showcaseTypes";
import { LEGACY_SHOWCASE_TYPE_LABEL, SHOWCASE_TYPE_LABEL } from "@/lib/showcaseTypes";
import { estimateReadMinutes } from "@/lib/articleFormat";
import { relativeTime, TYPE_STYLES, type TypeKey } from "@/lib/typeStyles";
import DeleteShowcaseConfirm from "./DeleteShowcaseConfirm";

// Tint per entry type, from the shared type tints (lib/typeStyles.ts).
const TINT: Record<string, TypeKey> = {
  paper: "paper",
  talk: "news",
  poster: "podcast",
  award: "community",
  tool: "tool",
  event: "dataset",
};

export default function ShowcaseCard({
  entry,
  featured = false,
  className = "",
}: {
  entry: ShowcaseEntry;
  featured?: boolean;
  /** Outer sizing only (grid/flex width): the caller's job. */
  className?: string;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const heading = entry.headline || entry.title;
  const href = entry.slug ? `/promote/${entry.slug}` : null;
  // A legacy entry (no slug, so no hosted article) links to its external page.
  const externalHref = !href ? entry.link : null;

  // A row from before the current picker may carry a type SHOWCASE_TYPE_LABEL
  // no longer has a key for: fall back to the legacy label map.
  const typeLabel =
    (SHOWCASE_TYPE_LABEL as Record<string, string>)[entry.type] ??
    LEGACY_SHOWCASE_TYPE_LABEL[entry.type] ??
    entry.type;
  const t = TYPE_STYLES[TINT[entry.type] ?? "other"];

  const readMinutes = estimateReadMinutes(entry.standfirst, entry.articleBody);
  // Date only when present and not in the future; read time is computed from the article.
  const meta = [relativeTime(entry.publishedAt), `${readMinutes} min read`]
    .filter(Boolean)
    .join(" · ");

  // line-clamp-2 goes directly on the Link/anchor with NO "block" alongside it:
  // "block" would win the `display` property over line-clamp's own
  // `display:-webkit-box` and silently disable the clamp. `after:absolute
  // after:inset-0` stretches the link over the whole tile.
  const linkCls = "line-clamp-2 hover:underline underline-offset-4 after:absolute after:inset-0";
  const headingContent = href ? (
    <Link href={href} className={linkCls}>
      {heading}
    </Link>
  ) : externalHref ? (
    <a href={externalHref} target="_blank" rel="noopener noreferrer" className={linkCls}>
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
        className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shadow-sm"
      >
        <span className="material-symbols-outlined text-secondary text-lg">more_vert</span>
      </button>

      {menuOpen && (
        <>
          {/* Click-outside catcher: under the menu, above everything else */}
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

  // The cover: only when the entry has an image. Fixed ratio, object-fit: cover.
  const cover = entry.heroImageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={entry.heroImageUrl}
      alt=""
      loading="lazy"
      decoding="async"
      className="w-full h-full object-cover"
    />
  ) : null;

  // ── Featured: wide tile, image left (fixed 3:2), text right ───────────────
  if (featured) {
    return (
      <>
        <article
          className={`tile group relative flex flex-col md:flex-row overflow-hidden ${className}`}
          style={{ background: t.bg }}
        >
          {ownerMenu}

          {cover && (
            <div className="w-full md:w-5/12 shrink-0 aspect-[3/2] overflow-hidden">{cover}</div>
          )}

          <div className="flex flex-col flex-1 justify-center p-6 md:p-10">
            <p className="type-label" style={{ color: t.fg }}>
              {typeLabel}
            </p>
            <h3 className="mt-3 font-title text-[26px] md:text-[32px] leading-[1.15] font-medium text-on-background">
              {headingContent}
            </h3>
            {entry.standfirst && (
              <p className="mt-3 text-[15px] leading-relaxed text-on-background/70 line-clamp-3">
                {entry.standfirst}
              </p>
            )}
            <p className="mt-4 text-xs text-on-background/55" suppressHydrationWarning>
              {meta}
            </p>
          </div>
        </article>

        {deleteConfirm}
      </>
    );
  }

  // ── Every other entry: vertical tile, cover on top when there is one ──────
  return (
    <>
      <article
        className={`tile group relative flex flex-col h-full overflow-hidden ${className}`}
        style={{ background: t.bg }}
      >
        {ownerMenu}

        {cover && <div className="w-full shrink-0 aspect-video overflow-hidden">{cover}</div>}

        <div className="flex flex-col flex-1 p-5">
          <p className="type-label" style={{ color: t.fg }}>
            {typeLabel}
          </p>
          <h3 className="mt-3 font-title text-[20px] leading-tight font-medium text-on-background">
            {headingContent}
          </h3>
          {entry.standfirst && (
            <p className="mt-1.5 text-[13px] leading-snug text-on-background/70 line-clamp-2">
              {entry.standfirst}
            </p>
          )}
          <p className="mt-auto pt-3 text-xs text-on-background/55" suppressHydrationWarning>
            {meta}
          </p>
        </div>
      </article>

      {deleteConfirm}
    </>
  );
}
