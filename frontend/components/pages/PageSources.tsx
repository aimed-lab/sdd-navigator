// "All sources" on a wiki page: page_evidence grouped by kind, rendered with
// the same lists and tiles Explore uses (PaperList for papers and preprints,
// OtherSections for everything else). page_evidence keeps no per-source `raw`
// details, so tiles show the title, summary and date and hide the rest.

import PaperList from "@/components/explore/PaperList";
import OtherSections from "@/components/explore/OtherSections";
import SectionHeading from "@/components/explore/SectionHeading";
import { groupEvidenceByKind, type EvidenceRow } from "@/lib/server/pages/pageViewHelpers";

export default function PageSources({ evidence }: { evidence: EvidenceRow[] }) {
  const sections = groupEvidenceByKind(evidence);
  if (sections.length === 0) return null;
  const papers = sections.find((s) => s.kind === "paper");
  const preprints = sections.find((s) => s.kind === "preprint");
  const others = sections.filter((s) => s.kind !== "paper" && s.kind !== "preprint");

  return (
    <section className="flex flex-col gap-12">
      <SectionHeading
        title="All sources"
        subtitle={`${evidence.length} resources collected for this page.`}
        className="mb-0"
      />
      {papers && (
        <div>
          <SectionHeading title="Papers" className="mb-4" />
          <PaperList items={papers.items} hideSave />
        </div>
      )}
      {preprints && (
        <div>
          <SectionHeading title="Preprints" className="mb-4" />
          <PaperList items={preprints.items} preprint hideSave />
        </div>
      )}
      <OtherSections sections={others} expandGenesets hideSave />
    </section>
  );
}
