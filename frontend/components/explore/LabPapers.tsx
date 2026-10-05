"use client";

// "From the AI.MED Lab": the lab's recent publications (lib/labPapers.ts) in the
// same citation-row style as Explore's papers. Title on the left, "Venue · Year"
// on the right, no authors line (none are stored). Newest year first (the list's
// own order is kept within a year); the first 6 show, and "Show all 12" expands
// in place. Each row opens https://doi.org/<doi> in a new tab.

import { useMemo, useState } from "react";
import PaperList from "@/components/explore/PaperList";
import SectionHeading from "@/components/explore/SectionHeading";
import { doiUrl, LAB_PUBLICATIONS_URL, labPapers } from "@/lib/labPapers";
import type { ExploreItem } from "@/types/explore";

const SHOWN_COLLAPSED = 6;

export default function LabPapers() {
  const [expanded, setExpanded] = useState(false);

  // Shaped as ExploreItems so PaperList renders them like every other paper.
  // summary "Published in <venue>." is the form PaperList reads the venue from.
  const items = useMemo<ExploreItem[]>(
    () =>
      labPapers
        .map((p, i) => ({ p, i }))
        .sort((a, b) => b.p.year - a.p.year || a.i - b.i)
        .map(({ p }) => ({
          id: `lab-paper-${p.doi}`,
          kind: "paper",
          title: p.title,
          summary: `Published in ${p.venue}.`,
          url: doiUrl(p.doi),
          doi: p.doi,
          source: "aimed-lab",
          date_iso: `${p.year}-01-01T00:00:00.000Z`,
          signal: null,
        })),
    []
  );

  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, SHOWN_COLLAPSED);

  return (
    <section>
      <SectionHeading
        title="From the AI.MED Lab"
        subtitle="Recent AI drug discovery research from Prof. Jake Chen's lab at UAB."
      />
      <PaperList items={shown} />
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        {items.length > SHOWN_COLLAPSED && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
          >
            {expanded ? "Show fewer" : `Show all ${items.length}`}
          </button>
        )}
        <a
          href={LAB_PUBLICATIONS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-secondary hover:text-primary hover:underline underline-offset-4"
        >
          All lab publications ↗
        </a>
      </div>
    </section>
  );
}
