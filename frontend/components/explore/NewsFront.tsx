"use client";

// News as a front page: one lead story (largest tile) beside a compact headline
// list. Stacks on phones. In the All view the list is capped at 5 with an
// "All news" link; in the News chip view (`expanded`) it runs longer.

import { withBestLead } from "@/lib/newsLead";
import NewsTile from "@/components/explore/NewsTile";
import SaveButton from "@/components/explore/SaveButton";
import { newsSource, relativeTime } from "@/lib/typeStyles";
import type { ExploreItem } from "@/types/explore";

const COMPACT_MAX = 5;
const EXPANDED_MAX = 20;

export default function NewsFront({
  items,
  expanded = false,
  onAllNews,
  projectId,
}: {
  items: ExploreItem[];
  expanded?: boolean;
  /** All view only: selects the News chip. */
  onAllNews?: () => void;
  projectId?: string;
}) {
  if (items.length === 0) return null;
  const [lead, ...rest] = withBestLead(items);
  const list = rest.slice(0, expanded ? EXPANDED_MAX : COMPACT_MAX);

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-[1.35fr_1fr] gap-6 items-start">
        <NewsTile item={lead} large />

        {list.length > 0 && (
          <ul className="divide-y divide-[#e7e4dc]">
            {list.map((item) => {
              const source = newsSource(item);
              const when = relativeTime(item.date_iso);
              const meta = [source, when].filter(Boolean).join(" · ");
              const row = (
                <>
                  <span className="min-w-0 flex-1 font-title text-[17px] leading-snug font-medium text-on-background md:truncate">
                    {item.title}
                  </span>
                  {meta && (
                    <span
                      className="shrink-0 text-xs text-secondary md:text-right"
                      suppressHydrationWarning
                    >
                      {meta}
                    </span>
                  )}
                </>
              );
              const rowCls =
                "min-w-0 flex-1 flex flex-col gap-1 md:flex-row md:items-baseline md:gap-4";
              return (
                <li key={item.id} className="group flex items-center gap-3 py-3">
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${rowCls} hover:opacity-80`}
                    >
                      {row}
                    </a>
                  ) : (
                    <div className={rowCls}>{row}</div>
                  )}
                  <SaveButton item={item} projectId={projectId} />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!expanded && onAllNews && (
        <button
          type="button"
          onClick={onAllNews}
          className="mt-5 font-label-md text-label-md text-primary hover:underline underline-offset-4"
        >
          All news →
        </button>
      )}
    </div>
  );
}
