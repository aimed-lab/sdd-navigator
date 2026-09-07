"use client";

// The grid on /saved — the viewer's OWN saves with no project attached
// (project_id IS NULL on saved_items; see lib/server/projectResources.ts's
// "Personal (non-project) saves" section). First real surface for this
// data: nothing in app/ rendered it before this page existed.
//
// Same ItemCard/tile pattern as components/projects/ResourcesSection.tsx,
// simplified: no export button, no "Explore for this project" link (this
// isn't scoped to one project), and every item is shown at once rather
// than truncated to "3 most recent" — there is no other place to see the
// rest of a personal save, unlike a project page where the full list is
// one tile-click away.
//
// REMOVING: every card here is already known-saved (initiallySaved),
// and its bookmark is wired to `onSaveClick` -> an immediate
// removeMyItemAction call, not SaveItemPicker — re-opening the "where do
// you want to save this" dialog for an item that's already exactly here
// would be a non-sequitur. A failed remove shows inline, not silently.

import { useState } from "react";
import { useRouter } from "next/navigation";
import ItemCard from "@/components/ItemCard";
import { removeMyItemAction } from "@/app/explore/actions";
import type { ProjectResources } from "@/lib/server/projectResources";
import type { ExploreItem } from "@/types/explore";

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

export default function SavedItemsSection({ resources }: { resources: ProjectResources }) {
  const router = useRouter();
  const [selectedKind, setSelectedKind] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const toggleKind = (kind: string) => {
    setSelectedKind((current) => (current === kind ? null : kind));
  };

  const visible = selectedKind
    ? resources.items.filter((item) => item.kind === selectedKind)
    : resources.items;

  const handleRemove = async (item: ExploreItem) => {
    setRemoveError(null);
    const res = await removeMyItemAction(item.id);
    if (res.ok) {
      router.refresh();
    } else {
      setRemoveError(res.error);
    }
  };

  if (resources.total === 0) {
    return (
      <div className="glass-card rounded-2xl p-12 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4">
          <span className="material-symbols-outlined text-[32px]">bookmark</span>
        </div>
        <h3 className="font-headline-md text-headline-md text-on-background mb-2">
          Nothing saved yet
        </h3>
        <p className="font-body-md text-body-md text-secondary max-w-md">
          On Explore, or in a community&apos;s feed, tap a card&apos;s bookmark and choose &quot;Just
          save it for me&quot; to see it here.
        </p>
      </div>
    );
  }

  return (
    <>
      {removeError && (
        <p className="mb-4 font-body-sm text-body-sm text-error" role="alert">
          {removeError}
        </p>
      )}

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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {visible.map((item) => (
          <ItemCard key={item.id} item={item} initiallySaved onSaveClick={handleRemove} />
        ))}
      </div>
    </>
  );
}
