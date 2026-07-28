// Episode detail — /explore/podcast/<slug>. Layout follows the old design's rich
// episode page (header, Key Concepts, Summary, Transcript in the main column;
// Live Literature + Related Episodes in the right rail) restyled in the current
// design system. The knowledge graph is deliberately NOT here (deferred).
//
// Reads `wiki_pages` DIRECTLY from Supabase (lib/server/wiki.ts's getWikiPage),
// not through the Python backend — wiki_pages is Supabase data, so proxying it
// through EXPLORE_API_URL added a hop and a failure mode for no benefit. This
// is a Server Component now (was a client component fetching /api/podcast/
// [slug]); the "loading" state that used to be client-side state is now
// Next's automatic loading.tsx for this route segment.
//
// Fetching stays split so the page paints fast:
//   • the episode itself (transcript included) — this Server Component, blocks
//     the main column (via loading.tsx while it resolves)
//   • Live Literature + Related Episodes — each rail fetches on its own client
//     side, with its own skeleton and error state, so a slow external search
//     never holds up the episode content. LEFT ALONE in this change: Live
//     Literature genuinely needs the Python backend's live PubMed/OpenAlex/
//     Crossref fan-out (that data doesn't live in Supabase), and Related
//     Episodes is a separate migration (topic-matched search_wiki behavior,
//     not yet reproduced as a direct Supabase query).

import Link from "next/link";
import CategoryStrip from "@/components/CategoryStrip";
import CommentsSection from "@/components/podcast/CommentsSection";
import LiveLiteratureRail from "@/components/podcast/LiveLiteratureRail";
import RelatedEpisodesRail from "@/components/podcast/RelatedEpisodesRail";
import TranscriptSection from "@/components/podcast/TranscriptSection";
import { getWikiPage, type WikiPage } from "@/lib/server/wiki";

// The query that anchors LiveLiteratureRail (the live PubMed/OpenAlex/Crossref
// search — that one still needs a free-text query string). RelatedEpisodesRail
// no longer uses this: it scores directly against the episode's own concepts/
// tags (see getRelatedEpisodes in lib/server/wiki.ts), not a derived query
// string, because "related" should be a real overlap score, not a text search.
function topicQuery(ep: WikiPage): string {
  const parts = [...ep.concepts.map((c) => c.title).filter(Boolean), ...ep.tags];
  const q = parts.slice(0, 6).join(" ").trim();
  return q || ep.title;
}

function BackLink() {
  return (
    <>
      <CategoryStrip selected="episode" navigate />
      <Link
        href="/explore/podcast"
        className="inline-flex items-center gap-1 -mt-6 mb-8 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        All episodes
      </Link>
    </>
  );
}

export default async function EpisodeDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await getWikiPage(slug);

  if (result.status === "missing") {
    return (
      <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-10 md:py-14">
        <BackLink />
        <div className="glass-panel rounded-xl py-20 px-6 text-center">
          <span className="material-symbols-outlined text-5xl text-secondary">search_off</span>
          <h1 className="mt-4 font-headline-md text-headline-md text-on-background">
            That episode doesn&apos;t exist
          </h1>
          <p className="mt-2 font-body-md text-body-md text-secondary">
            No episode matches &ldquo;{slug}&rdquo;.
          </p>
          <Link
            href="/explore/podcast"
            className="btn-primary inline-block mt-6 px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            Browse all episodes
          </Link>
        </div>
      </div>
    );
  }

  if (result.status === "error") {
    return (
      <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-10 md:py-14">
        <BackLink />
        <div className="glass-panel rounded-xl py-20 px-6 text-center">
          <span className="material-symbols-outlined text-5xl text-secondary">cloud_off</span>
          <h1 className="mt-4 font-headline-md text-headline-md text-on-background">
            Couldn&apos;t load this episode
          </h1>
          <p className="mt-2 font-body-md text-body-md text-secondary">
            The database didn&apos;t respond. Please try again in a moment.
          </p>
          <Link
            href={`/explore/podcast/${encodeURIComponent(slug)}`}
            className="btn-primary inline-block mt-6 px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  const episode = result.page;
  const query = topicQuery(episode);

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-10 md:py-14">
      <BackLink />

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

          {/* Transcript — collapsed by default; it's tens of thousands of chars.
              Interactive (show/hide), so it's the one client component here. */}
          {episode.transcript && <TranscriptSection transcript={episode.transcript} />}

          {/* Comments — public read, posting auth-gated */}
          <CommentsSection wikiId={episode.id} />
        </main>

        {/* ── RIGHT RAIL ──────────────────────────────────────────────── */}
        <aside className="min-w-0 space-y-8 lg:sticky lg:top-24">
          <LiveLiteratureRail query={query} />
          <RelatedEpisodesRail
            slug={episode.slug}
            concepts={episode.concepts}
            tags={episode.tags}
          />
        </aside>
      </div>
    </div>
  );
}
