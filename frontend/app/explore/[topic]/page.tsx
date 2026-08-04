"use client";

// Search results page — /explore/<topic>. Same shell, grid, and category strip
// as the Explore feed, but scoped to a query: it POSTs { input: topic } to the
// explore backend and renders the routed sections. Selecting a category filters
// to that section; an empty selected category shows the A+D invitation card.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ItemCard, { SkeletonCard } from "@/components/ItemCard";
import CategoryStrip, { CATEGORIES, labelForKind } from "@/components/CategoryStrip";
import CategoryEmptyCard from "@/components/CategoryEmptyCard";
import InlineFeedback from "@/components/feedback/InlineFeedback";
import { submitFeedbackAction } from "@/app/feedback/actions";
import type { ExploreItem, ExploreResponse, ExploreSection } from "@/types/explore";

const SECTION_TITLE: Record<string, string> = {
  news: "Industry News",
  paper: "Latest Papers",
  dataset: "Datasets",
  tool: "Trending Tools",
  trial: "Clinical Trials",
  grant: "Funding & Grants",
  episode: "From the Podcast",
  resource: "Lab Resources",
  person: "People",
};
const titleFor = (kind: string) =>
  SECTION_TITLE[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);

const GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6";

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-8">
      <div className="w-1.5 h-8 bg-primary rounded-full" />
      <h2 className="font-headline-lg text-headline-lg text-on-background">{title}</h2>
    </div>
  );
}

export default function SearchResultsPage() {
  const router = useRouter();
  const params = useParams<{ topic: string }>();
  const topic = decodeURIComponent(
    Array.isArray(params.topic) ? params.topic[0] : params.topic ?? ""
  );

  const [query, setQuery] = useState(topic); // search bar value (pre-filled)
  const [data, setData] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // (Re)fetch whenever the routed topic changes.
  useEffect(() => {
    let cancelled = false;
    setQuery(topic);
    setSelected(null);
    (async () => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch("/api/explore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: topic }),
        });
        const json = (await res.json()) as ExploreResponse;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [topic]);

  // A+B rule (same as feed): 3+ -> full grid; 1-2 -> pooled "Also Found"; 0 hidden.
  const { fullSections, pooledItems } = useMemo(() => {
    const withItems = (data?.sections ?? []).filter((s) => s.items.length > 0);
    const full = withItems.filter((s) => s.items.length >= 3);
    const pooled = withItems
      .filter((s) => s.items.length >= 1 && s.items.length < 3)
      .flatMap((s) => s.items);
    return { fullSections: full, pooledItems: pooled };
  }, [data]);

  const totalItems = fullSections.reduce((n, s) => n + s.items.length, 0) + pooledItems.length;
  // Two DISTINCT settled failure shapes, never conflated:
  //   backendError — the search never actually ran (transport failure, or the
  //                  route itself reporting error:true). An availability
  //                  problem: we couldn't search, not that we searched and
  //                  found nothing.
  //   emptyResult  — the search ran, worked, and matched nothing. A coverage
  //                  problem: worth recording as a real signal about missing
  //                  sources, which backendError is not.
  // Both are "settled" (not loading) and mutually exclusive.
  const backendError = !loading && (failed || data?.error === true);
  const emptyResult = !loading && !backendError && totalItems === 0;
  const showError = backendError || emptyResult;

  // Auto-capture: page_path + the query, tagged with which of the two
  // settled outcomes it was, once per distinct topic. Fires for BOTH —
  // dropping backendError here would lose the exact signal this feature
  // exists for when the discovery backend is down (the expected case for
  // the info session). The ref (not state) is what makes this fire once per
  // topic: state would re-render and re-run the effect's dependency check on
  // every render, but the ref only changes when a topic actually gets
  // captured. Only fires on a SETTLED outcome — never while loading, and
  // never on a partial result (there is no partial state here: totalItems
  // reflects the full response once loading is false).
  const capturedTopicRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showError || capturedTopicRef.current === topic) return;
    capturedTopicRef.current = topic;
    submitFeedbackAction({
      page_path: `/explore/${encodeURIComponent(topic)}`,
      message: null,
      context: { query: topic, outcome: backendError ? "backend_error" : "empty" },
    });
  }, [showError, backendError, topic]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q && q !== topic) router.push(`/explore/${encodeURIComponent(q)}`);
  };

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-8 pb-32">
      {/* Search (pre-filled, editable) */}
      <section className="max-w-3xl mx-auto mb-6">
        <form onSubmit={submit} className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="text"
            placeholder="Search papers, tools, trials, grants, podcast, people…"
            className="w-full h-16 px-6 pr-16 bg-white border border-outline-variant/40 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-sm text-body-lg font-body-lg placeholder:text-secondary/50 transition-all"
          />
          <button
            type="submit"
            aria-label="Search"
            className="absolute right-3 top-3 bottom-3 btn-primary px-6 rounded-lg flex items-center justify-center"
          >
            <span className="material-symbols-outlined">search</span>
          </button>
        </form>
      </section>

      {/* Query heading */}
      <div className="mb-6 text-center">
        <p className="text-secondary font-body-md">
          Results for{" "}
          <span className="text-on-background font-headline-md">&ldquo;{topic}&rdquo;</span>
        </p>
      </div>

      {/* Category strip — the Podcast chip routes to /explore/podcast, carrying
          the routed topic so the episode grid opens scoped to the same search. */}
      <CategoryStrip selected={selected} onSelect={setSelected} query={topic} />

      {/* Loading */}
      {loading && (
        <div className="space-y-16">
          {[0, 1].map((s) => (
            <section key={s}>
              <div className="h-8 w-48 rounded bg-surface-container mb-8 animate-pulse" />
              <div className={GRID}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Error / no results at all — copy differs by which settled outcome
          this was. A backend failure must never read like an empty search:
          "try a broader term" tells someone their query was the problem when
          the actual problem is that nothing searched at all. */}
      {!loading && showError && (
        <div className="max-w-md mx-auto text-center py-24">
          {backendError ? (
            <>
              <span className="material-symbols-outlined text-5xl text-secondary/50">
                cloud_off
              </span>
              <h2 className="mt-4 font-headline-md text-headline-md text-on-background">
                Couldn&apos;t search right now
              </h2>
              <p className="mt-2 text-secondary font-body-md">
                The discovery backend didn&apos;t respond. This isn&apos;t about your
                search — please try again in a moment.
              </p>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-5xl text-secondary/50">
                search_off
              </span>
              <h2 className="mt-4 font-headline-md text-headline-md text-on-background">
                No results for &ldquo;{topic}&rdquo;
              </h2>
              <p className="mt-2 text-secondary font-body-md">
                Try a broader term, or browse the full feed.
              </p>
            </>
          )}

          <button
            onClick={() => router.push("/explore")}
            className="mt-6 btn-primary px-6 py-2 rounded-lg font-label-md text-label-md"
          >
            Browse the full feed
          </button>

          {emptyResult && (
            <div className="mt-8 text-left">
              <InlineFeedback
                prompt="What were you hoping to find?"
                pagePath={`/explore/${encodeURIComponent(topic)}`}
                context={{ query: topic }}
              />
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {!loading && !showError && (() => {
        const activeSections =
          selected === null
            ? fullSections
            : (data?.sections ?? []).filter((s) => s.kind === selected && s.items.length > 0);
        const showPooled = selected === null && pooledItems.length > 0;

        // Selected category with no results -> the A+D invitation card.
        if (selected !== null && activeSections.length === 0) {
          return (
            <CategoryEmptyCard
              label={labelForKind(selected)}
              kind={selected}
              query={topic}
              onBrowseAll={() => setSelected(null)}
            />
          );
        }

        return (
          <div className="space-y-16">
            {activeSections.map((section: ExploreSection) => (
              <section key={section.tool}>
                <SectionHeader title={titleFor(section.kind)} />
                <div className={GRID}>
                  {section.items.map((item: ExploreItem) => (
                    <ItemCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            ))}

            {showPooled && (
              <section>
                <SectionHeader title="Also Found" />
                <div className={GRID}>
                  {pooledItems.map((item: ExploreItem) => (
                    <ItemCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            )}
          </div>
        );
      })()}
    </div>
  );
}
