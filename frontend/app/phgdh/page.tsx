"use client";

// /phgdh: the PHGDH collection (step 3 of the homepage route). Same editorial
// look as Explore: Newsreader headings, #FBFAF7 background, type tints, and the
// shared PaperList / ResourceBento / SectionHeading components.
//
// Live sections (papers, datasets, clinical trials) come from the explore
// backend and hide when empty or when the backend is down. The reference and
// lab-project tiles are static links, so the page still has substance without
// the backend. Gene sets are deliberately not shown here.
//
// Reference links were each checked before being added:
//   UniProt O43175, Open Targets ENSG00000092621, ChEMBL CHEMBL2311243 (all the
//   human PHGDH entry, matched through UniProt O43175 and Ensembl), RCSB's
//   group page for UniProt O43175 (21 entries when checked), and GeneCards'
//   PHGDH gene card. No IDs here were guessed.

import { useEffect, useState } from "react";
import Link from "next/link";
import PaperList from "@/components/explore/PaperList";
import ResourceBento, { liveTile, type BentoTile } from "@/components/explore/ResourceBento";
import { TILE_GRID, TrialTile } from "@/components/explore/ResultTiles";
import SectionHeading from "@/components/explore/SectionHeading";
import { BlockSkeleton } from "@/components/explore/Skeletons";
import { PHGDH_LINKS } from "@/lib/phgdhRoute";
import type { ExploreItem, ExploreResponse } from "@/types/explore";

const WRAP = "max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop";
const MAX_PAPERS = 8;
const MIN_ALZHEIMER_PAPERS = 3;

const REFERENCE_TILES: BentoTile[] = [
  {
    id: "ref-uniprot",
    kind: "dataset",
    label: "Reference",
    name: "UniProt",
    description: "Human PHGDH, entry O43175",
    url: "https://www.uniprot.org/uniprotkb/O43175/entry",
    tags: [],
    external: true,
  },
  {
    id: "ref-opentargets",
    kind: "dataset",
    label: "Reference",
    name: "Open Targets",
    description: "Human PHGDH, ENSG00000092621",
    url: "https://platform.opentargets.org/target/ENSG00000092621",
    tags: [],
    external: true,
  },
  {
    id: "ref-chembl",
    kind: "dataset",
    label: "Reference",
    name: "ChEMBL",
    description: "Human PHGDH, CHEMBL2311243",
    url: "https://www.ebi.ac.uk/chembl/explore/target/CHEMBL2311243",
    tags: [],
    external: true,
  },
  {
    id: "ref-rcsb",
    kind: "dataset",
    label: "Reference",
    name: "RCSB PDB",
    description: "Structures of human PHGDH (UniProt O43175)",
    url: "https://www.rcsb.org/uniprot/O43175",
    tags: [],
    external: true,
  },
  {
    id: "ref-genecards",
    kind: "dataset",
    label: "Reference",
    name: "GeneCards",
    description: "The PHGDH gene card",
    url: "https://www.genecards.org/card/PHGDH",
    tags: [],
    external: true,
  },
];

const LAB_TILES: BentoTile[] = [
  {
    id: "lab-rbd",
    name: "PHGDH RNA-binding domain",
    url: "https://wiki.smartdrugdiscovery.org/projects/pleaser-phgdh-rna-binding-domain---comprehensive-biologi/",
  },
  {
    id: "lab-act",
    name: "PHGDH ACT domain: lead optimization",
    url: "https://wiki.smartdrugdiscovery.org/projects/pleaser-phgdh-act-domain---lead-optimization-for-cns-pen/",
  },
  {
    id: "lab-allosteric",
    name: "PHGDH allosteric RBD binder",
    url: "https://wiki.smartdrugdiscovery.org/PHGDH-Allosteric-RBD-Binder/",
  },
  {
    id: "lab-ranking",
    name: "PHGDH small-molecule ranking",
    url: "https://wiki.smartdrugdiscovery.org/projects/pleaser-phgdh-rna-binding-domain-small-molecule-ranking/",
  },
].map((t) => ({
  ...t,
  kind: "other",
  label: "Lab project",
  description: "Project notes on the SDD wiki ↗",
  tags: [],
}));

async function search(input: string): Promise<ExploreResponse | null> {
  try {
    const res = await fetch("/api/explore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    return (await res.json()) as ExploreResponse;
  } catch {
    return null;
  }
}

const itemsOf = (data: ExploreResponse | null, kind: string): ExploreItem[] =>
  data?.error ? [] : (data?.sections ?? []).find((s) => s.kind === kind)?.items ?? [];

export default function PhgdhCollectionPage() {
  const [loading, setLoading] = useState(true);
  const [papers, setPapers] = useState<ExploreItem[]>([]);
  const [datasets, setDatasets] = useState<ExploreItem[]>([]);
  const [trials, setTrials] = useState<ExploreItem[]>([]);
  const [liveFailed, setLiveFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [specific, broad] = await Promise.all([search("PHGDH Alzheimer"), search("PHGDH")]);
      if (cancelled) return;
      const specificPapers = itemsOf(specific, "paper");
      setPapers(
        (specificPapers.length >= MIN_ALZHEIMER_PAPERS ? specificPapers : itemsOf(broad, "paper")).slice(
          0,
          MAX_PAPERS
        )
      );
      setDatasets(itemsOf(broad, "dataset"));
      setTrials(itemsOf(broad, "trial"));
      setLiveFailed(!specific && !broad);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-[var(--explore-bg)] min-h-[calc(100vh-4rem)]">
      <div className={`${WRAP} pt-10 pb-32`}>
        {/* Header, with the locked "save" tile beside it */}
        <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 mb-14">
          <div className="max-w-3xl">
            <p className="font-label-md text-label-md uppercase tracking-wide text-[#C2410C]">
              Case study · PHGDH in Alzheimer&apos;s
            </p>
            <h1 className="mt-3 font-title text-[34px] md:text-[44px] leading-[1.1] font-medium text-on-background">
              PHGDH collection
            </h1>
            <p className="mt-3 font-body-lg text-body-lg text-secondary">
              Papers, data, tools and trials on PHGDH, gathered in one place.
            </p>
          </div>
          <Link
            href="/invite"
            className="tile shrink-0 md:w-72 p-5 flex items-start gap-3"
            style={{ background: "var(--type-other-bg)" }}
          >
            <span className="material-symbols-outlined text-secondary text-2xl leading-none mt-0.5">
              lock
            </span>
            <span>
              <span className="block font-title text-[18px] leading-snug font-medium text-on-background">
                Save this collection to your account
              </span>
              <span className="mt-1 block text-xs text-on-background/60">Invite only</span>
            </span>
          </Link>
        </header>

        <div className="space-y-16">
          {/* Papers */}
          {loading ? (
            <section>
              <SectionHeading title="Papers" />
              <BlockSkeleton className="h-48" />
            </section>
          ) : (
            papers.length > 0 && (
              <section>
                <SectionHeading title="Papers" />
                <PaperList items={papers} />
              </section>
            )
          )}
          {!loading && liveFailed && (
            <p className="text-secondary font-body-md">
              Live papers, datasets and trials are unavailable right now. The links below still work.
            </p>
          )}

          {/* Reference resources */}
          <section>
            <SectionHeading title="Reference resources" />
            <ResourceBento tiles={REFERENCE_TILES} flat />
          </section>

          {/* Lab work */}
          <section>
            <SectionHeading title="Lab work on PHGDH" />
            <ResourceBento tiles={LAB_TILES} flat />
          </section>

          {/* Datasets (hidden when empty) */}
          {!loading && datasets.length > 0 && (
            <section>
              <SectionHeading title="Datasets" />
              <ResourceBento tiles={datasets.map(liveTile)} />
            </section>
          )}

          {/* Clinical trials (hidden when empty) */}
          {!loading && trials.length > 0 && (
            <section>
              <SectionHeading title="Clinical trials" />
              <div className={TILE_GRID}>
                {trials.map((item) => (
                  <TrialTile key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Route navigation */}
        <nav className="mt-16 pt-6 border-t border-[#e7e4dc] flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-4">
          <Link
            href="/#phgdh-route"
            className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
          >
            ← Back to the route
          </Link>
          <a
            href={PHGDH_LINKS.analysis}
            target="_blank"
            rel="noopener noreferrer"
            className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
          >
            Next on the route: Analysis ↗
          </a>
        </nav>
      </div>
    </div>
  );
}
