// Podcast episode grid — /explore/podcast. Lives UNDER Explore because Explore
// is the single destination for all content; podcast is a category within it,
// not a top-level section.
//
// Reads `wiki_pages` DIRECTLY from Supabase (lib/server/wiki.ts's
// listEpisodes), not through the Python backend — wiki_pages is Supabase
// data, so proxying it through EXPLORE_API_URL added a hop and a failure
// mode for no benefit. Search is now CLIENT-SIDE filtering over the full
// 64-episode set (see components/podcast/PodcastGrid.tsx) rather than a
// backend round-trip per keystroke — small enough table that this is the
// correct solution, not a shortcut, and it means no reimplementation of
// search_wiki's tokenized match in TypeScript: this is deliberately a
// simpler multi-term-AND substring match, not the same algorithm.
//
// Layout STRUCTURE follows design/podcast-list.html (intro, search, episode
// cards with number badge + title + snippet). The VISUAL style is the current
// design system, not that file's older palette: forest-green #006e2f primary,
// glass cards, Nav/Footer from the root layout.
//
// Server Component for the data fetch (+ the static intro/category strip);
// PodcastGrid is the client half that owns the search box and filtering —
// same split as TranscriptSection on the episode detail page.

import CategoryStrip from "@/components/CategoryStrip";
import PodcastGrid from "@/components/podcast/PodcastGrid";
import { listEpisodes } from "@/lib/server/wiki";

export default async function PodcastPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // Seeded from ?q= (the Explore "Podcast" chip passes the active search
  // through) — read once as PodcastGrid's initial value; typing owns it from
  // then on (no URL sync back, matching the page's prior behavior).
  const { q } = await searchParams;
  const initialQuery = q ?? "";

  const result = await listEpisodes();

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

      <PodcastGrid
        episodes={result.status === "ok" ? result.episodes : []}
        failed={result.status === "error"}
        initialQuery={initialQuery}
      />
    </section>
  );
}
