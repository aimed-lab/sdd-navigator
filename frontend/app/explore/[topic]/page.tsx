"use client";

// Search results page — /explore/<topic>. Same shell, grid, and category strip
// as the Explore feed, but scoped to a query: it POSTs { input: topic } to the
// explore backend and renders the routed sections. Selecting a category filters
// to that section; an empty selected category shows the A+D invitation card.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ItemCard, { SkeletonCard } from "@/components/ItemCard";
import CategoryStrip, { CATEGORIES, labelForKind } from "@/components/CategoryStrip";
import CategoryEmptyCard from "@/components/CategoryEmptyCard";
import type { ExploreItem, ExploreResponse, ExploreSection } from "@/types/explore";

const SECTION_TITLE: Record<string, string> = {
  news: "Industry News",
  paper: "Latest Papers",
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
  const showError = failed || data?.error === true || (!loading && totalItems === 0);

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

      {/* Error / no results at all */}
      {!loading && showError && (
        <div className="max-w-md mx-auto text-center py-24">
          <span className="material-symbols-outlined text-5xl text-secondary/50">search_off</span>
          <h2 className="mt-4 font-headline-md text-headline-md text-on-background">
            No results for &ldquo;{topic}&rdquo;
          </h2>
          <p className="mt-2 text-secondary font-body-md">
            Try a broader term, or browse the full feed.
          </p>
          <button
            onClick={() => router.push("/explore")}
            className="mt-6 btn-primary px-6 py-2 rounded-lg font-label-md text-label-md"
          >
            Browse the full feed
          </button>
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
