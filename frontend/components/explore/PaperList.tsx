"use client";

// Papers as citation rows, not tiles: serif title, authors line (muted, cut to
// "First Author et al."), journal · year on the right (below on phones), save
// icon on hover (always visible on phones). Thin dividers between rows.

import SaveButton from "@/components/explore/SaveButton";
import { paperMeta } from "@/lib/typeStyles";
import type { ExploreItem } from "@/types/explore";

export default function PaperList({
  items,
  limit,
  onMore,
}: {
  items: ExploreItem[];
  /** All view: show at most this many, then a "More papers" link. */
  limit?: number;
  onMore?: () => void;
}) {
  if (items.length === 0) return null;
  const shown = limit ? items.slice(0, limit) : items;

  return (
    <div>
      <ul className="divide-y divide-[#e7e4dc] border-y border-[#e7e4dc]">
        {shown.map((item) => {
          const { authors, venue, year } = paperMeta(item);
          const right = [venue, year].filter(Boolean).join(" · ");
          const body = (
            <>
              <h3 className="font-title text-[18px] leading-snug font-medium text-on-background">
                {item.title}
              </h3>
              {authors && <p className="mt-1 text-sm text-secondary truncate">{authors}</p>}
            </>
          );
          return (
            <li key={item.id} className="group py-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
              <div className="min-w-0 col-start-1">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block hover:opacity-80"
                  >
                    {body}
                  </a>
                ) : (
                  body
                )}
              </div>
              <div className="col-start-2 row-start-1 row-span-2 flex items-start gap-3 md:justify-end">
                {right && (
                  <span className="hidden md:block text-sm text-secondary text-right pt-0.5 max-w-[240px] truncate">
                    {right}
                  </span>
                )}
                <SaveButton />
              </div>
              {right && (
                <p className="md:hidden col-start-1 text-xs text-secondary truncate">{right}</p>
              )}
            </li>
          );
        })}
      </ul>
      {limit && items.length > limit && onMore && (
        <button
          type="button"
          onClick={onMore}
          className="mt-5 font-label-md text-label-md text-primary hover:underline underline-offset-4"
        >
          More papers →
        </button>
      )}
    </div>
  );
}
