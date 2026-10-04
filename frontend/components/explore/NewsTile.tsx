// One news story as a tinted tile: "NEWS · source · 3h ago" label + serif
// title. Server-safe (no state). Used by NewsFront's lead story and by the
// homepage's "Live on the network today" row. Missing fields are hidden.

import { relativeTime, newsSource, newsSummary, TYPE_STYLES } from "@/lib/typeStyles";
import type { ExploreItem } from "@/types/explore";

export default function NewsTile({
  item,
  large = false,
  className = "",
}: {
  item: ExploreItem;
  large?: boolean;
  className?: string;
}) {
  const t = TYPE_STYLES.news;
  const source = newsSource(item);
  const when = relativeTime(item.date_iso);
  const summary = large ? newsSummary(item) : null;
  const label = ["News", source, when].filter(Boolean).join(" · ");

  const inner = (
    <>
      <p className="type-label" style={{ color: t.fg }} suppressHydrationWarning>
        {label}
      </p>
      <h3
        className={
          "font-title font-medium text-on-background " +
          (large
            ? "mt-4 text-[28px] md:text-[32px] leading-[1.2]"
            : "mt-3 text-[20px] leading-[1.25] line-clamp-4")
        }
      >
        {item.title}
      </h3>
      {summary && (
        <p className="mt-3 font-body-md text-body-md text-on-background/70 line-clamp-2">
          {summary}
        </p>
      )}
      {large && !summary && item.url && (
        <p className="mt-6 font-label-md text-label-md text-primary group-hover:underline underline-offset-4">
          {source ? `Read on ${source} ↗` : "Read the story ↗"}
        </p>
      )}
    </>
  );

  const cls = `tile group block p-6 ${large ? "md:p-8" : ""} ${className}`;
  return item.url ? (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cls}
      style={{ background: t.bg }}
    >
      {inner}
    </a>
  ) : (
    <div className={cls} style={{ background: t.bg }}>
      {inner}
    </div>
  );
}
