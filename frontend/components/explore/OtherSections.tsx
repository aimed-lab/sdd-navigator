"use client";

// Everything on an Explore or search page that has no dedicated editorial
// component: clinical trials, compounds, targets, people, lab resources, gene
// sets, and so on. Tile-style cards under a SectionHeading. Gene sets are the
// niche type and always come LAST, collapsed behind a "Show gene sets (N)"
// button.

import { useState } from "react";
import SectionHeading from "@/components/explore/SectionHeading";
import { ResultTile, TILE_GRID, TrialTile } from "@/components/explore/ResultTiles";
import type { ExploreSection } from "@/types/explore";

const SECTION_TITLE: Record<string, string> = {
  geneset: "Gene sets",
  compound: "Compounds",
  target: "Target-disease evidence",
  trial: "Clinical trials",
  grant: "Funding & grants",
  resource: "Lab resources",
  person: "People",
  episode: "From the podcast",
};

export const sectionTitle = (kind: string) =>
  SECTION_TITLE[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);

// Open Targets' association score aggregates evidence across source types
// (genetic association, literature, animal model, ...) via a weighted
// harmonic mean; it is not a biological-importance ranking. One short line,
// not a card-level essay.
const TARGET_NOTE =
  "Open Targets' association score reflects breadth of evidence sources, not biological importance.";

function Grid({ section, projectId }: { section: ExploreSection; projectId?: string }) {
  return (
    <div className={TILE_GRID}>
      {section.items.map((item) =>
        item.kind === "trial" ? (
          <TrialTile key={item.id} item={item} projectId={projectId} />
        ) : (
          <ResultTile key={item.id} item={item} projectId={projectId} />
        )
      )}
    </div>
  );
}

export default function OtherSections({
  sections,
  projectId,
}: {
  sections: ExploreSection[];
  projectId?: string;
}) {
  const [showGenesets, setShowGenesets] = useState(false);
  const withItems = sections.filter((s) => s.items.length > 0);
  const normal = withItems.filter((s) => s.kind !== "geneset");
  const genesets = withItems.filter((s) => s.kind === "geneset");
  const genesetCount = genesets.reduce((n, s) => n + s.items.length, 0);

  return (
    <>
      {normal.map((section) => (
        <section key={section.tool}>
          <SectionHeading
            title={sectionTitle(section.kind)}
            subtitle={section.kind === "target" ? TARGET_NOTE : undefined}
          />
          <Grid section={section} projectId={projectId} />
        </section>
      ))}

      {genesetCount > 0 && (
        <section>
          {showGenesets ? (
            <>
              <SectionHeading title="Gene sets" />
              {genesets.map((s) => (
                <Grid key={s.tool} section={s} projectId={projectId} />
              ))}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowGenesets(true)}
              className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
            >
              Show gene sets ({genesetCount})
            </button>
          )}
        </section>
      )}
    </>
  );
}
