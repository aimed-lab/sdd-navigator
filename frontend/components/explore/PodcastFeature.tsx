// The latest podcast episode as one wide tile. Renders nothing when there is
// no episode. "Latest" = highest episode number if every item carries one, else
// the newest valid date, else the first item (the backend's own order).

import { relativeTime, TYPE_STYLES } from "@/lib/typeStyles";
import type { ExploreItem } from "@/types/explore";

function latestEpisode(items: ExploreItem[]): ExploreItem | null {
  if (items.length === 0) return null;
  const num = (i: ExploreItem) =>
    typeof i.raw?.episode_number === "number" ? (i.raw.episode_number as number) : null;
  if (items.every((i) => num(i) !== null)) {
    return [...items].sort((a, b) => (num(b) as number) - (num(a) as number))[0];
  }
  const dated = items.filter((i) => i.date_iso && !isNaN(new Date(i.date_iso).getTime()));
  if (dated.length === items.length) {
    return [...items].sort((a, b) => +new Date(b.date_iso!) - +new Date(a.date_iso!))[0];
  }
  return items[0];
}

export default function PodcastFeature({ items }: { items: ExploreItem[] }) {
  const ep = latestEpisode(items);
  if (!ep) return null;
  const t = TYPE_STYLES.podcast;
  const n = typeof ep.raw?.episode_number === "number" ? (ep.raw.episode_number as number) : null;
  const when = relativeTime(ep.date_iso);
  const label = ["Podcast", n !== null ? `Episode ${n}` : null, when].filter(Boolean).join(" · ");
  const image = typeof ep.raw?.image_url === "string" ? (ep.raw.image_url as string) : null;
  const external = !!ep.url && /^https?:/.test(ep.url);

  return (
    <a
      href={ep.url ?? "/explore/podcast"}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="tile group flex flex-col md:flex-row md:items-center gap-5 md:gap-8 p-6 md:p-8"
      style={{ background: t.bg }}
    >
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          loading="lazy"
          className="w-full md:w-40 aspect-square object-cover rounded-[14px] shrink-0"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="type-label" style={{ color: t.fg }} suppressHydrationWarning>
          {label}
        </p>
        <h3 className="mt-3 font-title text-[26px] leading-[1.2] font-medium text-on-background">
          {ep.title}
        </h3>
        {ep.summary && (
          <p className="mt-3 font-body-md text-body-md text-on-background/70 line-clamp-2">
            {ep.summary}
          </p>
        )}
        <span className="mt-4 inline-block font-label-md text-label-md text-primary group-hover:underline underline-offset-4">
          Listen →
        </span>
      </div>
    </a>
  );
}
