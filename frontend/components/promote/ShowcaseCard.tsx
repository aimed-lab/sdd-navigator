"use client";

// One Promote item as a tile. Same tinted tile look as Explore, and each type's
// card is a little different so the grid reads at a glance:
//   - Event: a date badge (month / day) and the place. (No "going" count: there
//     is no RSVP data to show.)
//   - Talk & slides: a slide-preview frame (the first image, else a slide icon).
//   - Funding win: the amount, large, with the funder.
//   - Tool & app: a "Before vs now" line.
//   - Everything else: the standfirst.
// Every card ends with its main button (the author's label and link, else the
// type's default). `featured` is the large front-page story with its key-facts
// strip; `compact` is the small side card beside it.
//
// The headline link stretches over the whole tile (after:absolute); the main
// button and the owner menu sit above it (relative z-10).
//
// Owner-only Edit / Delete is a small kebab menu revealed on hover. Client
// component because that menu and the delete confirm need local state.

import { useState } from "react";
import Link from "next/link";
import { SHOWCASE_TYPE_ICON, SHOWCASE_TYPE_LABEL, type ShowcaseEntry } from "@/lib/showcaseTypes";
import { estimateReadMinutes } from "@/lib/articleFormat";
import { relativeTime, TYPE_STYLES, type TypeKey } from "@/lib/typeStyles";
import { beforeNowLine, eventBadge, fundingAmount, visibleFacts } from "@/lib/server/promote/showcaseKinds";
import DeleteShowcaseConfirm from "./DeleteShowcaseConfirm";

const TINT: Record<string, TypeKey> = {
  paper: "paper",
  preprint: "paper",
  talk: "news",
  poster: "podcast",
  event: "dataset",
  achievement: "community",
  breakthrough: "community",
  partnership: "news",
  funding: "tool",
  tool: "tool",
  service: "dataset",
  dataset: "dataset",
  other: "other",
};

export default function ShowcaseCard({
  entry,
  featured = false,
  compact = false,
  className = "",
}: {
  entry: ShowcaseEntry;
  featured?: boolean;
  compact?: boolean;
  /** Outer sizing only (grid/flex width): the caller's job. */
  className?: string;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const heading = entry.headline || entry.title;
  const href = entry.slug ? `/promote/${entry.slug}` : null;
  const externalHref = !href ? entry.link : null;

  const typeLabel = SHOWCASE_TYPE_LABEL[entry.type];
  const t = TYPE_STYLES[TINT[entry.type] ?? "other"];
  const facts = visibleFacts(entry.keyFacts);

  const readMinutes = estimateReadMinutes(entry.standfirst, entry.articleBody);
  const meta = [relativeTime(entry.publishedAt), `${readMinutes} min read`].filter(Boolean).join(" · ");

  const linkCls = "hover:underline underline-offset-4 after:absolute after:inset-0";
  const headingContent = href ? (
    <Link href={href} className={linkCls}>
      {heading}
    </Link>
  ) : externalHref ? (
    <a href={externalHref} target="_blank" rel="noopener noreferrer" className={linkCls}>
      {heading}
    </a>
  ) : (
    <span>{heading}</span>
  );

  // The main button: the item's own, else a plain "Read more" to the article.
  const buttonLabel = entry.cta?.label ?? "Read more";
  const buttonCls =
    "relative z-10 self-start inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/80 hover:bg-white border border-outline-variant/40 font-label-md text-label-md text-primary transition-colors";
  const mainButton = entry.cta ? (
    <a href={entry.cta.url} target="_blank" rel="noopener noreferrer" className={buttonCls}>
      {buttonLabel}
      <span className="material-symbols-outlined text-base">arrow_outward</span>
    </a>
  ) : href ? (
    <Link href={href} className={buttonCls}>
      {buttonLabel}
      <span className="material-symbols-outlined text-base">arrow_forward</span>
    </Link>
  ) : null;

  const ownerMenu = entry.is_owner && (
    <div className="absolute top-2 right-2 z-20">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        aria-label="More"
        className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-sm"
      >
        <span className="material-symbols-outlined text-secondary text-lg">more_horiz</span>
      </button>

      {menuOpen && (
        <>
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
    <DeleteShowcaseConfirm entryId={entry.id} entryTitle={entry.title} onClose={() => setConfirmingDelete(false)} />
  );

  const image = entry.heroImageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={entry.heroImageUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
  ) : null;

  // The part that differs by type.
  const badge = entry.type === "event" ? eventBadge(entry.eventStartsAt) : null;
  const amount = entry.type === "funding" ? fundingAmount(entry.keyFacts) : null;
  const beforeNow = entry.type === "tool" ? beforeNowLine(entry.keyFacts) : null;

  const typeVisual = (() => {
    if (entry.type === "talk") {
      // A slide-preview frame.
      return (
        <div className="aspect-video w-full overflow-hidden rounded-lg bg-white border border-outline-variant/40 shadow-sm flex items-center justify-center">
          {image ?? (
            <span className="material-symbols-outlined text-[44px]" style={{ color: t.fg }}>
              {SHOWCASE_TYPE_ICON.talk}
            </span>
          )}
        </div>
      );
    }
    if (image) return <div className="w-full aspect-video overflow-hidden rounded-lg">{image}</div>;
    return null;
  })();

  const detail = (
    <>
      {badge && (
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-14 rounded-lg bg-white text-center overflow-hidden border border-outline-variant/40">
            <div className="text-[11px] font-bold tracking-wide py-0.5 text-white" style={{ background: t.fg }}>
              {badge.month}
            </div>
            <div className="font-title text-[24px] leading-none py-1.5 text-on-background">{badge.day}</div>
          </div>
          {entry.eventLocation && (
            <p className="text-[13px] text-on-background/70 line-clamp-2">{entry.eventLocation}</p>
          )}
        </div>
      )}
      {amount && (
        <div>
          <p className="font-title text-[40px] leading-none font-medium" style={{ color: t.fg }}>
            {amount}
          </p>
          {facts[0] && <p className="mt-1.5 text-[13px] text-on-background/70 line-clamp-1">{facts[0].value}</p>}
        </div>
      )}
      {beforeNow && (
        <p className="rounded-lg bg-white/70 border border-outline-variant/30 px-3 py-2 text-[13px] leading-snug text-on-background/80 line-clamp-3">
          <span className="font-semibold">Before vs now: </span>
          {beforeNow}
        </p>
      )}
    </>
  );

  // ── Featured: the large front-page story ─────────────────────────────────
  // A dark green gradient card with white text; the key facts are translucent
  // boxes inside it. Its height is its content's height.
  if (featured) {
    const lightBtn =
      "relative z-10 self-start inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-white hover:bg-white/90 font-label-md text-label-md text-primary transition-colors";
    const featuredButton = entry.cta ? (
      <a href={entry.cta.url} target="_blank" rel="noopener noreferrer" className={lightBtn}>
        {buttonLabel}
        <span className="material-symbols-outlined text-base">arrow_outward</span>
      </a>
    ) : href ? (
      <Link href={href} className={lightBtn}>
        {buttonLabel}
        <span className="material-symbols-outlined text-base">arrow_forward</span>
      </Link>
    ) : null;

    return (
      <>
        <article
          className={`tile group relative flex flex-col gap-5 overflow-hidden p-6 md:p-8 text-white ${className}`}
          style={{ background: "linear-gradient(135deg, #04361c 0%, #006e2f 100%)" }}
        >
          {ownerMenu}
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full bg-white/15 font-label-sm text-label-sm uppercase tracking-wide">
              {typeLabel}
            </span>
            <span className="font-label-sm text-label-sm text-white/70">Featured</span>
          </div>

          <h3 className="max-w-3xl font-title text-[28px] md:text-[36px] leading-[1.12] font-medium">
            {href ? (
              <Link href={href} className="hover:underline underline-offset-4 after:absolute after:inset-0">
                {heading}
              </Link>
            ) : (
              heading
            )}
          </h3>

          {entry.standfirst && (
            <p className="max-w-3xl text-[16px] leading-relaxed text-white/85 line-clamp-3">{entry.standfirst}</p>
          )}

          {(badge || entry.eventLocation) && entry.type === "event" && (
            <p className="flex items-center gap-2 font-label-md text-label-md text-white/85">
              <span className="material-symbols-outlined text-base">event</span>
              {[badge ? `${badge.month} ${badge.day}` : null, entry.eventLocation].filter(Boolean).join(" · ")}
            </p>
          )}

          {facts.length > 0 && (
            <dl className={`grid grid-cols-1 gap-3 ${facts.length >= 3 ? "md:grid-cols-3" : facts.length === 2 ? "md:grid-cols-2" : ""}`}>
              {facts.map((f) => (
                <div key={f.label} className="rounded-xl bg-white/10 border border-white/20 p-4 min-w-0">
                  <dt className="font-label-sm text-label-sm uppercase tracking-wide text-white/70">{f.label}</dt>
                  <dd className="mt-1 text-[15px] leading-snug text-white break-words">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="flex flex-wrap items-center gap-4">
            {featuredButton}
            <span className="text-xs text-white/65" suppressHydrationWarning>
              {meta}
            </span>
          </div>
        </article>
        {deleteConfirm}
      </>
    );
  }

  // ── Every other card ──────────────────────────────────────────────────────
  return (
    <>
      <article
        className={`tile group relative flex flex-col h-full overflow-hidden ${className}`}
        style={{ background: t.bg }}
      >
        {ownerMenu}
        <div className={`flex flex-col flex-1 gap-3 ${compact ? "p-4" : "p-5"}`}>
          {typeVisual}
          <p className="type-label" style={{ color: t.fg }}>
            {typeLabel}
          </p>
          <h3
            className={`font-title font-medium text-on-background leading-tight ${compact ? "text-[18px]" : "text-[20px]"}`}
          >
            <span className="line-clamp-3">{headingContent}</span>
          </h3>
          {detail}
          {entry.standfirst && !amount && !beforeNow && (
            <p className="text-[13px] leading-snug text-on-background/70 line-clamp-2">{entry.standfirst}</p>
          )}
          <p className="mt-auto pt-1 text-xs text-on-background/55" suppressHydrationWarning>
            {meta}
          </p>
          {mainButton}
        </div>
      </article>
      {deleteConfirm}
    </>
  );
}
