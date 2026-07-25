"use client";

// Episode detail — /explore/podcast/<slug>. Layout follows the old design's rich
// episode page (header, Key Concepts, Summary, Transcript in the main column;
// Live Literature + Related Episodes in the right rail) restyled in the current
// design system. The knowledge graph is deliberately NOT here (deferred).
//
// Fetching is split so the page paints fast:
//   • the episode itself (transcript included) — blocks the main column
//   • Live Literature + Related Episodes — each rail fetches on its own, with
//     its own skeleton and error state, so a slow external search never holds
//     up the episode content.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import CategoryStrip from "@/components/CategoryStrip";
import CommentsSection from "@/components/podcast/CommentsSection";
import LiveLiteratureRail from "@/components/podcast/LiveLiteratureRail";
import RelatedEpisodesRail from "@/components/podcast/RelatedEpisodesRail";
import type { EpisodeDetail } from "@/types/podcast";

// The query that anchors both rails: the episode's concept titles and tags carry
// the topic far better than the episode title alone (titles are often playful).
function topicQuery(ep: EpisodeDetail): string {
  const parts = [
    ...ep.concepts.map((c) => c.title).filter(Boolean),
    ...ep.tags,
  ];
  const q = parts.slice(0, 6).join(" ").trim();
  return q || ep.title;
}

function HeaderSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="w-full aspect-video rounded-xl bg-surface-container" />
      <div className="h-8 w-2/3 rounded bg-surface-container" />
      <div className="h-4 w-full rounded bg-surface-container" />
      <div className="h-4 w-5/6 rounded bg-surface-container" />
    </div>
  );
}

export default function EpisodeDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug ?? "";

  const [episode, setEpisode] = useState<EpisodeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setMissing(false);
    try {
      const res = await fetch(`/api/podcast/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        setMissing(true);
        return;
      }
      const json = (await res.json()) as { episode?: EpisodeDetail | null; error?: boolean };
      if (json.error || !json.episode) setFailed(true);
      else setEpisode(json.episode);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const query = useMemo(() => (episode ? topicQuery(episode) : ""), [episode]);

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-10 md:py-14">
      {/* Back into Explore — the strip is the same shared component as the feed */}
      <CategoryStrip selected="episode" navigate />

      <Link
        href="/explore/podcast"
        className="inline-flex items-center gap-1 -mt-6 mb-8 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        All episodes
      </Link>

      {missing && (
        <div className="glass-panel rounded-xl py-20 px-6 text-center">
          <span className="material-symbols-outlined text-5xl text-secondary">search_off</span>
          <h1 className="mt-4 font-headline-md text-headline-md text-on-background">
            That episode doesn&apos;t exist
          </h1>
          <p className="mt-2 font-body-md text-body-md text-secondary">
            No episode matches “{slug}”.
          </p>
          <Link
            href="/explore/podcast"
            className="btn-primary inline-block mt-6 px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            Browse all episodes
          </Link>
        </div>
      )}

      {failed && !missing && (
        <div className="glass-panel rounded-xl py-20 px-6 text-center">
          <span className="material-symbols-outlined text-5xl text-secondary">cloud_off</span>
          <h1 className="mt-4 font-headline-md text-headline-md text-on-background">
            Couldn&apos;t load this episode
          </h1>
          <p className="mt-2 font-body-md text-body-md text-secondary">
            The podcast backend didn&apos;t respond. Please try again in a moment.
          </p>
          <button
            onClick={load}
            className="btn-primary mt-6 px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !failed && !missing && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-10">
          <HeaderSkeleton />
          <div />
        </div>
      )}

      {episode && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-10 lg:gap-14 items-start">
          {/* ── MAIN COLUMN ─────────────────────────────────────────────── */}
          <main className="min-w-0 space-y-12">
            {/* Header */}
            <header className="space-y-5">
              {episode.image_url && (
                <div className="w-full aspect-video rounded-xl overflow-hidden bg-surface-container-high">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={episode.image_url}
                    alt=""
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {typeof episode.episode_number === "number" && (
                <span className="inline-block px-3 py-1 rounded-full bg-primary text-on-primary font-label-sm text-label-sm">
                  EP {episode.episode_number}
                </span>
              )}

              <h1 className="font-headline-lg text-headline-lg md:text-[40px] md:leading-tight text-on-background">
                {episode.title}
              </h1>

              {episode.description && (
                <p className="font-body-lg text-body-lg text-secondary">{episode.description}</p>
              )}

              {episode.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {episode.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 rounded-full bg-surface-container-low text-secondary font-label-sm text-label-sm"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {episode.episode_url && (
                <div>
                  <a
                    href={episode.episode_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      play_arrow
                    </span>
                    Listen to episode
                  </a>
                </div>
              )}
            </header>

            {/* Key Concepts */}
            {episode.concepts.length > 0 && (
              <section>
                <h2 className="font-headline-lg text-headline-lg text-on-background mb-6">
                  Key Concepts
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {episode.concepts.map((concept, i) => (
                    <div key={`${concept.title}-${i}`} className="glass-panel rounded-xl p-6">
                      <h3 className="font-headline-md text-lg text-on-background mb-3">
                        {concept.title}
                      </h3>
                      <ul className="space-y-2">
                        {concept.bullets.map((b, j) => (
                          <li
                            key={j}
                            className="flex gap-2 font-body-sm text-body-sm text-secondary"
                          >
                            <span className="mt-2 w-1.5 h-1.5 shrink-0 rounded-full bg-primary" />
                            {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Summary */}
            {episode.summary.length > 0 && (
              <section>
                <h2 className="font-headline-lg text-headline-lg text-on-background mb-6">
                  Episode Summary
                </h2>
                <ul className="glass-panel rounded-xl p-6 space-y-3">
                  {episode.summary.map((line, i) => (
                    <li key={i} className="flex gap-3 font-body-md text-body-md text-on-background">
                      <span className="material-symbols-outlined text-primary text-xl shrink-0">
                        check_circle
                      </span>
                      {line}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Transcript — collapsed by default; it's tens of thousands of chars */}
            {episode.transcript && (
              <section>
                <h2 className="font-headline-lg text-headline-lg text-on-background mb-6">
                  Full Transcript
                </h2>
                <div className="glass-panel rounded-xl p-6">
                  <button
                    onClick={() => setShowTranscript((s) => !s)}
                    aria-expanded={showTranscript}
                    className="w-full flex items-center justify-between gap-4 font-label-md text-label-md text-primary"
                  >
                    <span>
                      {showTranscript ? "Hide transcript" : "Show transcript"}
                      <span className="text-secondary ml-2">
                        ({episode.transcript.length.toLocaleString()} characters)
                      </span>
                    </span>
                    <span className="material-symbols-outlined">
                      {showTranscript ? "expand_less" : "expand_more"}
                    </span>
                  </button>

                  {showTranscript && (
                    <div className="mt-5 pt-5 border-t border-outline-variant/30 max-h-[32rem] overflow-y-auto">
                      {episode.transcript.split(/\n{2,}/).map((para, i) => (
                        <p
                          key={i}
                          className="font-body-md text-body-md text-secondary mb-4 whitespace-pre-wrap"
                        >
                          {para}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Comments — public read, posting auth-gated */}
            <CommentsSection wikiId={episode.id} />
          </main>

          {/* ── RIGHT RAIL ──────────────────────────────────────────────── */}
          <aside className="min-w-0 space-y-8 lg:sticky lg:top-24">
            <LiveLiteratureRail query={query} />
            <RelatedEpisodesRail query={query} excludeSlug={episode.slug} />
          </aside>
        </div>
      )}
    </div>
  );
}
