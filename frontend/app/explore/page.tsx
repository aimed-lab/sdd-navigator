"use client";

// Explore feed — the field-wide default landing feed from the real explore
// backend. Layout follows design/stitch/smartdrugdiscovery_refined_explore_grid
// (the GRID version). Nav/Footer come from the shared shell (in the root layout).

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ItemCard, { SkeletonCard } from "@/components/ItemCard";
import CategoryStrip, { CATEGORIES, labelForKind } from "@/components/CategoryStrip";
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

function ExploreFeed() {
  const router = useRouter();
  // ?category=<kind> preselects a section — this is how the chips on pages
  // without their own feed (e.g. /explore/podcast) route back in scoped.
  const categoryParam = useSearchParams().get("category");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(
    categoryParam && CATEGORIES.some((c) => c.kind === categoryParam) ? categoryParam : null
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch("/api/explore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: "" }), // empty -> backend default field-wide feed
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
  }, []);

  // A+B empty rule: 3+ items -> full grid section; 1-2 items -> pooled into
  // "Also Found"; 0 items -> hidden entirely.
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
    if (q) router.push(`/explore/${encodeURIComponent(q)}`);
  };

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-8 pb-32">
      {/* Search */}
      <section className="max-w-3xl mx-auto mb-10">
        <form onSubmit={submit} className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="text"
            placeholder="What are you working on? e.g. PHGDH in Alzheimer's, pancreatic cancer, CRISPR screening"
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

      {/* Stat strip */}
      <div className="mb-6 py-3 border-y border-surface-variant/40 text-center">
        <p className="text-primary font-label-md text-label-md tracking-wide">
          Live across 6+ sources · 64 podcast episodes · papers, news, tools, trials, grants, people
        </p>
      </div>

      {/* Category strip — shared switcher; horizontal scroll on mobile. The
          Podcast chip routes to /explore/podcast rather than filtering inline. */}
      <CategoryStrip selected={selected} onSelect={setSelected} query={query} />

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

      {/* Error / empty */}
      {!loading && showError && (
        <div className="max-w-md mx-auto text-center py-24">
          <span className="material-symbols-outlined text-5xl text-secondary/50">cloud_off</span>
          <h2 className="mt-4 font-headline-md text-headline-md text-on-background">
            Couldn&apos;t load the feed right now
          </h2>
          <p className="mt-2 text-secondary font-body-md">
            The discovery backend didn&apos;t respond. Please try again in a moment.
          </p>
          <button
            onClick={() => location.reload()}
            className="mt-6 btn-primary px-6 py-2 rounded-lg font-label-md text-label-md"
          >
            Retry
          </button>
        </div>
      )}

      {/* Feed */}
      {!loading && !showError && (() => {
        // "All" -> A+B feed (full sections + pooled). A specific category -> just
        // that kind's section (regardless of item count, so a small section is
        // still reachable via its chip).
        const activeSections =
          selected === null
            ? fullSections
            : (data?.sections ?? []).filter((s) => s.kind === selected && s.items.length > 0);
        const showPooled = selected === null && pooledItems.length > 0;
        const label = labelForKind(selected);

        if (selected !== null && activeSections.length === 0) {
          return (
            <div className="text-center py-20 text-secondary font-body-md">
              No {label.toLowerCase()} in this feed yet.
            </div>
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

// useSearchParams() must sit inside a Suspense boundary (see CLAUDE.md).
export default function ExplorePage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-8 pb-32">
          <div className={GRID}>
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      }
    >
      <ExploreFeed />
    </Suspense>
  );
}
