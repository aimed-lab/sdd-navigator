"use client";

// Podcast episode grid — /explore/podcast. Lives UNDER Explore because Explore
// is the single destination for all content; podcast is a category within it,
// not a top-level section. Real episodes from the wiki_pages table via
// /api/podcast -> the Python backend's /api/wiki (search_wiki). The API route
// keeps its own path (/api/podcast) — internal, not a user-facing URL.
//
// Layout STRUCTURE follows design/podcast-list.html (intro, search, episode
// cards with number badge + title + snippet). The VISUAL style is the current
// design system, not that file's older palette: forest-green #006e2f primary,
// glass cards, Nav/Footer from the root layout.
//
// Search is served by the backend, not filtered client-side, so it uses
// search_wiki's tokenized match over title/description/concepts/tags. It seeds
// from ?q= so the Explore category chip can carry the user's scope in.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import CategoryStrip from "@/components/CategoryStrip";
import type { Episode, PodcastResponse } from "@/types/podcast";

const GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6";

// "EP 42". Returns null when the row has no real number — never invents one.
function episodeLabel(n: number | null): string | null {
  return typeof n === "number" ? `EP ${n}` : null;
}

function EpisodeCard({ episode }: { episode: Episode }) {
  const label = episodeLabel(episode.episode_number);

  return (
    <Link
      href={`/explore/podcast/${episode.slug}`}
      className="glass-card group flex flex-col overflow-hidden rounded-xl border-t-4 border-t-primary-container"
    >
      {/* Thumbnail only when the row actually has one — otherwise a clean
          text-only card, never a placeholder image.
          Plain <img>, NOT next/image: the podcast CDN resets Next's server-side
          fetch (ECONNRESET), so the optimizer 500s on these URLs even though the
          browser loads them fine directly. Downside — the source serves ~2 MB
          originals, so these are full-size images scaled down by the browser.
          Lazy loading keeps the off-screen ones from being fetched at all. */}
      {episode.image_url && (
        <div className="w-full aspect-video bg-surface-container-high overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={episode.image_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        </div>
      )}

      <div className="flex flex-col flex-1 p-6">
        {label && (
          <span className="self-start inline-block px-3 py-1 mb-3 rounded-full bg-primary text-on-primary font-label-sm text-label-sm">
            {label}
          </span>
        )}

        <h3 className="font-headline-md text-lg leading-tight text-on-background line-clamp-2 group-hover:text-primary transition-colors">
          {episode.title}
        </h3>

        {episode.description && (
          <p className="mt-2 font-body-sm text-body-sm text-secondary line-clamp-3">
            {episode.description}
          </p>
        )}

        {episode.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {episode.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 rounded-full bg-surface-container-low text-secondary font-label-sm text-label-sm"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <span className="mt-auto pt-5 flex items-center font-label-md text-label-md text-primary group-hover:translate-x-1 transition-transform">
          Read wiki
          <span className="material-symbols-outlined ml-1 text-base">arrow_forward</span>
        </span>
      </div>
    </Link>
  );
}

function SkeletonEpisodeCard() {
  return (
    <div className="glass-card rounded-xl border-t-4 border-t-surface-variant overflow-hidden animate-pulse">
      <div className="w-full aspect-video bg-surface-container" />
      <div className="p-6 space-y-3">
        <div className="h-6 w-16 rounded-full bg-surface-container" />
        <div className="h-5 w-full rounded bg-surface-container" />
        <div className="h-4 w-5/6 rounded bg-surface-container" />
        <div className="flex gap-2 pt-2">
          <div className="h-6 w-16 rounded-full bg-surface-container" />
          <div className="h-6 w-20 rounded-full bg-surface-container" />
        </div>
      </div>
    </div>
  );
}

function PodcastGrid() {
  // Seeded from ?q= (the Explore "Podcast" chip passes the active search
  // through) — read once as the initial value; typing owns it from then on.
  const initialQuery = useSearchParams().get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Guards against a slow response for an earlier query overwriting a newer one.
  const seq = useRef(0);

  const load = useCallback(async (q: string) => {
    const mine = ++seq.current;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/podcast?q=${encodeURIComponent(q)}`);
      const json = (await res.json()) as PodcastResponse;
      if (mine !== seq.current) return; // a newer request has since started
      if (json.error) {
        setFailed(true);
        setEpisodes([]);
      } else {
        setEpisodes(json.episodes);
      }
    } catch {
      if (mine === seq.current) {
        setFailed(true);
        setEpisodes([]);
      }
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // Initial load (empty query -> all episodes, newest first), then debounced
  // reloads as the user types so each keystroke doesn't hit the backend.
  useEffect(() => {
    const t = setTimeout(() => load(query), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  const showEmpty = !loading && !failed && episodes.length === 0;

  return (
    <section className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-20">
      {/* Intro */}
      <div className="max-w-3xl space-y-4">
        <span className="inline-block px-4 py-1 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm uppercase">
          Podcast
        </span>
        <h1 className="font-display-lg text-display-lg text-on-background">
          Drug Discovery AI Talk
        </h1>
        <p className="font-body-lg text-body-lg text-secondary">
          Every episode, transcribed and turned into a searchable wiki page — the
          concepts, entities and tags pulled out of each conversation.
        </p>
      </div>

      {/* Category strip — same shared component as the feed. In navigate mode
          every other chip links back into /explore scoped to that kind, so this
          page isn't a dead end. Podcast stays active (it IS this page). */}
      <div className="mt-8 -mb-6">
        <CategoryStrip selected="episode" navigate />
      </div>

      {/* Search */}
      <div className="mt-10 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="relative flex-1 max-w-xl">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-secondary">
            search
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search episodes by title, concept or tag…"
            aria-label="Search episodes"
            className="w-full glass-panel rounded-full pl-12 pr-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        {!loading && !failed && (
          <span className="font-label-md text-label-md text-secondary">
            {episodes.length} {episodes.length === 1 ? "episode" : "episodes"}
            {query.trim() && " matching"}
          </span>
        )}
      </div>

      {/* Results */}
      <div className="mt-10">
        {loading && (
          <div className={GRID}>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonEpisodeCard key={i} />
            ))}
          </div>
        )}

        {!loading && failed && (
          <div className="glass-panel rounded-xl py-20 px-6 text-center">
            <span className="material-symbols-outlined text-5xl text-secondary">cloud_off</span>
            <h2 className="mt-4 font-headline-md text-headline-md text-on-background">
              Couldn&apos;t load episodes right now
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary">
              The podcast backend didn&apos;t respond. Please try again in a moment.
            </p>
            <button
              onClick={() => load(query)}
              className="btn-primary mt-6 px-6 py-3 rounded-lg font-label-md text-label-md"
            >
              Retry
            </button>
          </div>
        )}

        {showEmpty && (
          <div className="glass-panel rounded-xl py-20 px-6 text-center">
            <span className="material-symbols-outlined text-5xl text-secondary">search_off</span>
            <h2 className="mt-4 font-headline-md text-headline-md text-on-background">
              No episodes match “{query.trim()}”
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary">
              Try a broader term — a concept, a tag, or part of an episode title.
            </p>
          </div>
        )}

        {!loading && !failed && episodes.length > 0 && (
          <div className={GRID}>
            {episodes.map((episode) => (
              <EpisodeCard key={episode.id || episode.slug} episode={episode} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// useSearchParams() must sit inside a Suspense boundary (see CLAUDE.md).
export default function PodcastPage() {
  return (
    <Suspense
      fallback={
        <section className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-20">
          <div className={GRID}>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonEpisodeCard key={i} />
            ))}
          </div>
        </section>
      }
    >
      <PodcastGrid />
    </Suspense>
  );
}
