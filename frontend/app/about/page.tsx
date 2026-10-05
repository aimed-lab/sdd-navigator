// About — /about. Static server page, linked from the shared Footer.

import PageHeader, { PageShell } from "@/components/PageHeader";

export const metadata = { title: "About — SmartDrugDiscovery" };

export default function AboutPage() {
  return (
    <PageShell narrow className="space-y-6">
      <PageHeader title="About" className="mb-2" />
      <p className="font-body-lg text-body-lg text-secondary">
        SmartDrugDiscovery is an open source drug discovery platform built at UAB SPARC (Systems
        Pharmacology AI Research Center). It brings the field&apos;s papers, data and tools into
        one searchable place.
      </p>
      <p className="font-body-lg text-body-lg text-secondary">
        Researchers explore papers, data and tools, collaborate on projects, and promote their
        work. The platform is nonprofit and pre-competitive.
      </p>
    </PageShell>
  );
}
