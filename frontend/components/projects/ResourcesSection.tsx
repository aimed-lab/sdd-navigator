"use client";

// Resources section — frontend/design/projects/STRUCTURE.md, detail
// workspace, "Resources". CLIENT component (was server-only until the
// tile filter): clicking a count tile filters the list below to that
// kind IN PLACE — no new page, no new fetch, every item is already on
// hand via `resources.items`. Click the same tile again to clear the
// filter back to the "3 most recent" default view. "Explore for this
// project" is deliberately left alone as the separate action for finding
// MORE resources, not for looking at what's already saved.
//
// ITEM CARDS REUSE <ItemCard> — the same component Explore renders, not a
// second card style. Every card here is already known-saved, so
// initiallySaved is always true; its bookmark button becomes "remove from
// this project" (see ItemCard's own projectId-aware toggle).

import { useState } from "react";
import Link from "next/link";
import ItemCard from "@/components/ItemCard";
import type { ProjectResources } from "@/lib/server/projectResources";

const TILE_ICON: Record<string, string> = {
  paper: "article",
  dataset: "dataset",
  tool: "biotech",
  trial: "vaccines",
  grant: "payments",
  news: "newspaper",
  resource: "link",
  person: "person",
  episode: "podcasts",
};

export default function ResourcesSection({
  projectId,
  exploreHref,
  resources,
}: {
  projectId: string;
  exploreHref: string;
  resources: ProjectResources;
}) {
  const [selectedKind, setSelectedKind] = useState<string | null>(null);

  const toggleKind = (kind: string) => {
    setSelectedKind((current) => (current === kind ? null : kind));
  };

  const visible = selectedKind
    ? resources.items.filter((item) => item.kind === selectedKind)
    : resources.recent;

  return (
    <section className="mb-20">
      <div className="flex items-center justify-between mb-8">
        <h2 className="font-headline-md text-headline-md text-on-background">Resources</h2>
        <Link
          href={exploreHref}
          className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md flex items-center gap-2"
        >
          Explore for this project
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </Link>
      </div>

      {resources.total === 0 ? (
        // The main action on a brand-new project — inviting, not a bare
        // "no data" notice.
        <div className="glass-card rounded-2xl p-12 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4">
            <span className="material-symbols-outlined text-[32px]">search</span>
          </div>
          <h3 className="font-headline-md text-headline-md text-on-background mb-2">
            Nothing saved yet
          </h3>
          <p className="font-body-md text-body-md text-secondary mb-6 max-w-md">
            Find papers, datasets, tools, trials and grants matched to this project
          </p>
          <Link
            href={exploreHref}
            className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md flex items-center gap-2"
          >
            Explore for this project
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </Link>
        </div>
      ) : (
        <>
          {/* Count tiles — only kinds with at least one item. Clicking one
              filters the list below IN PLACE; clicking the same tile again
              clears the filter. */}
          <div className="flex flex-wrap gap-4 mb-8">
            {resources.tiles.map((tile) => {
              const active = selectedKind === tile.kind;
              return (
                <button
                  key={tile.kind}
                  type="button"
                  onClick={() => toggleKind(tile.kind)}
                  aria-pressed={active}
                  className={`bg-surface-container-lowest border rounded-xl p-4 flex-1 min-w-[120px] text-center shadow-sm hover:shadow-md transition-shadow ${
                    active ? "border-primary ring-2 ring-primary/30" : "border-outline-variant/30"
                  }`}
                >
                  <span className="material-symbols-outlined text-primary text-[20px] mb-1 block">
                    {TILE_ICON[tile.kind] ?? "bookmark"}
                  </span>
                  <div className="font-display-lg text-on-background mb-1">{tile.count}</div>
                  <div className="font-label-md text-secondary uppercase tracking-wider">
                    {tile.label}
                  </div>
                </button>
              );
            })}
          </div>

          {/* When a tile is selected: every saved item of that kind, and a
              way back to the default view. Otherwise: the 3 most recent,
              any kind. */}
          {selectedKind && (
            <div className="flex items-center justify-between mb-4">
              <p className="font-label-md text-label-md text-secondary">
                Showing all {visible.length}{" "}
                {resources.tiles.find((t) => t.kind === selectedKind)?.label.toLowerCase()}
              </p>
              <button
                type="button"
                onClick={() => setSelectedKind(null)}
                className="font-label-md text-label-md text-primary hover:underline flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
                Clear filter
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {visible.map((item) => (
              <ItemCard key={item.id} item={item} projectId={projectId} initiallySaved />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
