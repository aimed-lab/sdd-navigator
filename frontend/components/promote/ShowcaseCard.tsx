"use client";

// One showcase entry. Two card styles from one component: with a figure the
// image leads; without one the card is text-only — never a placeholder image.
//
// Client component (not a server component anymore) because the owner-only
// delete affordance needs local state for the confirm dialog — same reason
// collaborate/PostCard.tsx is a client component.
//
// An entry created through the unified /promote/submit flow has a `slug` and
// links to its hosted article at /promote/[slug] — the headline (not the
// paper's own title) is what's shown, since the headline is what the author
// actually wrote/edited for this card. The link to the ORIGINAL paper lives
// on the article page itself, not here. A legacy entry with no slug (created
// before this flow existed) falls back to its title and external `link`,
// same as before this card was reworked.

import { useState } from "react";
import Link from "next/link";
import type { ShowcaseEntry } from "@/lib/showcaseTypes";
import { LEGACY_SHOWCASE_TYPE_LABEL, SHOWCASE_TYPE_LABEL } from "@/lib/showcaseTypes";
import DeleteShowcaseConfirm from "./DeleteShowcaseConfirm";

export default function ShowcaseCard({ entry }: { entry: ShowcaseEntry }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const credit = [entry.authors, entry.owner?.affiliation].filter(Boolean).join(" · ");
  const heading = entry.headline || entry.title;
  const href = entry.slug ? `/promote/${entry.slug}` : null;
  // A row from before the current 6-category picker may carry a value
  // (case_study/white_paper/achievement) SHOWCASE_TYPE_LABEL no longer has a
  // key for — fall back to the legacy label map, then the raw value.
  const typeLabel =
    (SHOWCASE_TYPE_LABEL as Record<string, string>)[entry.type] ??
    LEGACY_SHOWCASE_TYPE_LABEL[entry.type] ??
    entry.type;

  return (
    <>
    <article className="glass-panel rounded-2xl overflow-hidden flex flex-col h-full">
      {entry.image_url && (
        <div className="w-full aspect-video bg-surface-container-high overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={entry.image_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="flex flex-col flex-1 p-6">
        <span className="self-start px-3 py-1 mb-3 rounded-full bg-primary/5 text-primary font-label-sm text-label-sm">
          {typeLabel}
        </span>

        <h3 className="font-headline-md text-lg leading-tight text-on-background">
          {href ? (
            <Link href={href} className="hover:underline underline-offset-4">
              {heading}
            </Link>
          ) : (
            heading
          )}
        </h3>

        {entry.description && (
          <p className="mt-2 font-body-sm text-body-sm text-secondary line-clamp-3">
            {entry.description}
          </p>
        )}

        {entry.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {entry.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="px-2.5 py-1 rounded-full bg-surface-container-low text-secondary font-label-sm text-label-sm"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto pt-5">
          <div className="pt-4 border-t border-outline-variant/30 flex items-center justify-between gap-3">
            <span className="font-label-sm text-label-sm text-secondary truncate">
              {credit || "SmartDrugDiscovery"}
            </span>
            <span className="shrink-0 flex items-center gap-3">
              {href ? (
                // Reads the hosted article — the link to the ORIGINAL paper
                // lives on that page itself, not here.
                <Link
                  href={href}
                  className="inline-flex items-center gap-1 font-label-md text-label-md text-primary hover:underline underline-offset-4"
                >
                  Read
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </Link>
              ) : (
                entry.link && (
                  <a
                    href={entry.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-label-md text-label-md text-primary hover:underline underline-offset-4"
                  >
                    View
                    <span className="material-symbols-outlined text-base">open_in_new</span>
                  </a>
                )
              )}
              {entry.is_owner && href && (
                <Link
                  href={`${href}/edit`}
                  className="font-label-sm text-label-sm text-secondary/60 hover:text-primary transition-colors"
                >
                  Edit
                </Link>
              )}
              {entry.is_owner && (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="font-label-sm text-label-sm text-secondary/60 hover:text-error transition-colors"
                >
                  Delete
                </button>
              )}
            </span>
          </div>
        </div>
      </div>
    </article>

    {confirmingDelete && (
      <DeleteShowcaseConfirm
        entryId={entry.id}
        entryTitle={entry.title}
        onClose={() => setConfirmingDelete(false)}
      />
    )}
    </>
  );
}
