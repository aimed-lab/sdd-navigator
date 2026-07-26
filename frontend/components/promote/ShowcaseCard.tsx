// One showcase entry. Two card styles from one component: with a figure the
// image leads; without one the card is text-only — never a placeholder image.
//
// Server component: nothing here is interactive.

import type { ShowcaseEntry } from "@/lib/showcaseTypes";
import { SHOWCASE_TYPE_LABEL } from "@/lib/showcaseTypes";

export default function ShowcaseCard({ entry }: { entry: ShowcaseEntry }) {
  const credit = [entry.authors, entry.owner?.affiliation].filter(Boolean).join(" · ");

  return (
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
          {SHOWCASE_TYPE_LABEL[entry.type]}
        </span>

        <h3 className="font-headline-md text-lg leading-tight text-on-background">
          {entry.title}
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
            {entry.link && (
              <a
                href={entry.link}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 inline-flex items-center gap-1 font-label-md text-label-md text-primary hover:underline underline-offset-4"
              >
                View
                <span className="material-symbols-outlined text-base">open_in_new</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
