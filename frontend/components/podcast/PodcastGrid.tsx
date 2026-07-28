"use client";

// Client half of the podcast grid — search box + client-side filtering over
// the full episode set the Server Component already fetched (see
// app/explore/podcast/page.tsx). 64 rows is small enough that loading all of
// them and filtering in the browser is the correct solution: no backend
// round-trip per keystroke, no tokenized-match reimplementation in
// TypeScript — just word-prefix matching per term, ANDed.
//
// NOT raw substring: a query term matches an episode if it's a PREFIX of any
// word in that episode's searchable text (title/description/concept
// titles/tags), tokenized on non-alphanumeric boundaries. Raw substring was
// tried first and measurably wrong — "rug" (bare substring of "drug") alone
// matched 55 of 64 episodes, and "ai" was matching inside "available",
// "maintain", "domain", etc., inflating a 51-episode result that was mostly
// noise. Prefix-on-token-boundary keeps search-as-you-type working ("deliv"
// still finds "delivery" via the "delivery" token) while "ai" no longer
// matches "available" (no token in that episode STARTS WITH "ai"). Multi-term
// AND: every query term must prefix-match at least one token.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EpisodeCard as EpisodeCardData } from "@/lib/server/wiki";

const GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6";

// "EP 42". Returns null when the row has no real number — never invents one.
function episodeLabel(n: number | null): string | null {
  return typeof n === "number" ? `EP ${n}` : null;
}

function searchableText(episode: EpisodeCardData): string {
  return [
    episode.title,
    episode.description,
    ...episode.concepts.map((c) => c.title),
    ...episode.tags,
  ].join(" ");
}

// Split into lowercase word tokens once per episode, reused across every
// keystroke rather than re-tokenizing the same text on every render.
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function matches(tokens: string[], terms: string[]): boolean {
  if (terms.length === 0) return true;
  return terms.every((term) => tokens.some((tok) => tok.startsWith(term)));
}

function EpisodeCard({ episode }: { episode: EpisodeCardData }) {
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

export default function PodcastGrid({
  episodes,
  failed,
  initialQuery,
}: {
  episodes: EpisodeCardData[];
  /** True when the server-side read itself failed — distinct from a read
   * that succeeded and simply returned zero rows. */
  failed: boolean;
  initialQuery: string;
}) {
  const router = useRouter();
  // Seeded from ?q= (the Explore "Podcast" chip passes the active search
  // through) — read once as the initial value; typing owns it from then on.
  const [query, setQuery] = useState(initialQuery);

  const terms = useMemo(
    () => query.toLowerCase().split(/\s+/).filter(Boolean),
    [query]
  );

  // Tokenized once per episode list (not per keystroke) — episodes doesn't
  // change while the user types.
  const tokensByEpisode = useMemo(
    () => episodes.map((e) => tokenize(searchableText(e))),
    [episodes]
  );

  const filtered = useMemo(
    () =>
      failed
        ? []
        : episodes.filter((_, i) => matches(tokensByEpisode[i], terms)),
    [episodes, tokensByEpisode, terms, failed]
  );

  const showEmpty = !failed && filtered.length === 0;

  return (
    <>
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
        {!failed && (
          <span className="font-label-md text-label-md text-secondary">
            {filtered.length} {filtered.length === 1 ? "episode" : "episodes"}
            {query.trim() && " matching"}
          </span>
        )}
      </div>

      {/* Results */}
      <div className="mt-10">
        {failed && (
          <div className="glass-panel rounded-xl py-20 px-6 text-center">
            <span className="material-symbols-outlined text-5xl text-secondary">cloud_off</span>
            <h2 className="mt-4 font-headline-md text-headline-md text-on-background">
              Couldn&apos;t load episodes right now
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary">
              The database didn&apos;t respond. Please try again in a moment.
            </p>
            <button
              onClick={() => router.refresh()}
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

        {!failed && filtered.length > 0 && (
          <div className={GRID}>
            {filtered.map((episode) => (
              <EpisodeCard key={episode.id || episode.slug} episode={episode} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
