"use client";

// "Related Episodes" — search_wiki over this episode's own concepts/tags, so the
// suggestions are topical rather than just "the newest episodes". Loads
// independently of the page, like the literature rail.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Episode, PodcastResponse } from "@/types/podcast";

export default function RelatedEpisodesRail({
  query,
  excludeSlug,
  limit = 4,
}: {
  query: string;
  /** The episode being viewed — never suggest it back to itself. */
  excludeSlug: string;
  limit?: number;
}) {
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/podcast?q=${encodeURIComponent(query)}`);
        const json = (await res.json()) as PodcastResponse;
        if (cancelled) return;
        if (json.error) {
          setFailed(true);
          return;
        }
        setEpisodes(json.episodes.filter((e) => e.slug !== excludeSlug).slice(0, limit));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, excludeSlug, limit]);

  return (
    <div className="glass-panel rounded-xl p-6">
      <div className="flex items-center gap-2 mb-5">
        <span className="material-symbols-outlined text-primary">podcasts</span>
        <h2 className="font-headline-md text-headline-md text-on-background">Related Episodes</h2>
      </div>

      {episodes === null && !failed && (
        <ul className="space-y-4">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex gap-3 animate-pulse">
              <div className="w-16 h-16 shrink-0 rounded-lg bg-surface-container" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-4 w-full rounded bg-surface-container" />
                <div className="h-3 w-1/3 rounded bg-surface-container" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {failed && (
        <p className="font-body-sm text-body-sm text-secondary">
          Couldn&apos;t load related episodes right now.
        </p>
      )}

      {episodes && episodes.length === 0 && !failed && (
        <p className="font-body-sm text-body-sm text-secondary">No related episodes found.</p>
      )}

      {episodes && episodes.length > 0 && (
        <ul className="space-y-4">
          {episodes.map((e) => (
            <li key={e.slug}>
              <Link href={`/explore/podcast/${e.slug}`} className="group flex gap-3 items-start">
                {e.image_url ? (
                  <span className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-surface-container-high">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={e.image_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  </span>
                ) : (
                  <span className="w-16 h-16 shrink-0 rounded-lg bg-surface-container-low flex items-center justify-center">
                    <span className="material-symbols-outlined text-secondary">podcasts</span>
                  </span>
                )}
                <span className="min-w-0">
                  {typeof e.episode_number === "number" && (
                    <span className="block font-label-sm text-label-sm text-primary">
                      EP {e.episode_number}
                    </span>
                  )}
                  <span className="block font-body-md text-body-md text-on-background leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                    {e.title}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
