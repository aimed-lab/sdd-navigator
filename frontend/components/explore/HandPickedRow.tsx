"use client";

// "Hand-picked" row shown above the live results when the Tools or Datasets
// chip is selected on /explore. Curated entries come from lib/curated.ts and
// render through the normal ItemCard, so they look like every other card. The
// live search keeps loading below; this row never waits on it.

import { useState } from "react";
import ItemCard from "@/components/ItemCard";
import { curatedDatasets, curatedTools, curatedToExploreItem } from "@/lib/curated";

const COLLAPSED_COUNT = 8; // two rows on desktop, short enough on a phone
const GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6";

export default function HandPickedRow({ kind }: { kind: "tool" | "dataset" }) {
  const [expanded, setExpanded] = useState(false);
  const items = kind === "tool" ? curatedTools : curatedDatasets;
  if (items.length === 0) return null;

  const shown = expanded ? items : items.slice(0, COLLAPSED_COUNT);
  const noun = kind === "tool" ? "tools" : "datasets";

  return (
    <section className="mb-16">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-1.5 h-8 bg-primary rounded-full" />
        <div>
          <h2 className="font-headline-lg text-headline-lg text-on-background">Hand-picked</h2>
          <p className="text-xs text-tertiary mt-0.5">
            Open-source and public {noun} we recommend, chosen by hand.
          </p>
        </div>
      </div>
      <div className={GRID}>
        {shown.map((item) => (
          <ItemCard key={item.id} item={curatedToExploreItem(item, kind)} />
        ))}
      </div>
      {items.length > COLLAPSED_COUNT && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="px-6 py-2 rounded-full bg-surface-container-low text-primary font-label-md text-label-md hover:bg-surface-container transition-colors"
          >
            {expanded ? "Show fewer" : `Show all ${items.length} ${noun}`}
          </button>
        </div>
      )}
      <h3 className="mt-14 font-label-md text-label-md uppercase tracking-wide text-secondary">
        Live results
      </h3>
    </section>
  );
}
