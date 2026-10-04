"use client";

// The hand-picked (curated, lib/curated.ts) tools and datasets as a bento.
// Never waits on the live backend, so it still shows when that fails.
//   mix = All view: tools and datasets alternating, 11 tiles (fills four rows of
//         the bento exactly), with a "Browse all" link.
//   tool / dataset = that chip's view: every curated item of that type.

import ResourceBento, { curatedTile, type BentoTile } from "@/components/explore/ResourceBento";
import { curatedDatasets, curatedTools } from "@/lib/curated";

const MIX_COUNT = 11;

function mixed(): BentoTile[] {
  const out: BentoTile[] = [];
  const max = Math.max(curatedTools.length, curatedDatasets.length);
  for (let i = 0; i < max && out.length < MIX_COUNT; i++) {
    if (curatedTools[i]) out.push(curatedTile(curatedTools[i], "tool"));
    if (out.length < MIX_COUNT && curatedDatasets[i]) {
      out.push(curatedTile(curatedDatasets[i], "dataset"));
    }
  }
  return out;
}

export default function HandPickedRow({
  mode,
  onBrowseAll,
}: {
  mode: "mix" | "tool" | "dataset";
  /** Mix mode only: opens the Tools view. */
  onBrowseAll?: () => void;
}) {
  const tiles =
    mode === "mix"
      ? mixed()
      : mode === "tool"
        ? curatedTools.map((t) => curatedTile(t, "tool"))
        : curatedDatasets.map((d) => curatedTile(d, "dataset"));

  return (
    <div>
      <ResourceBento tiles={tiles} />
      {mode === "mix" && onBrowseAll && (
        <button
          type="button"
          onClick={onBrowseAll}
          className="mt-5 font-label-md text-label-md text-primary hover:underline underline-offset-4"
        >
          Browse all {curatedTools.length} tools · {curatedDatasets.length} datasets →
        </button>
      )}
    </div>
  );
}
