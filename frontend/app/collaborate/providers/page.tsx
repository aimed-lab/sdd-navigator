// Service Providers directory — /collaborate/providers.
//
// Companies met at BioTechX Europe 2026, from lib/data/providers.json. The page
// is a server component; the search box, category chips and card grid are one
// client component (ProviderDirectory) because filtering is instant and client
// side. "List your services" saves a provider_requests row for the SPARC team.

import type { Metadata } from "next";
import Link from "next/link";
import PageHeader, { PageShell } from "@/components/PageHeader";
import ProviderDirectory from "@/components/providers/ProviderDirectory";
import { ListServicesButton } from "@/components/providers/ProviderForms";
import { getCurrentUser } from "@/lib/auth";
import { getAllProviders } from "@/lib/server/providers/providers";

export const dynamic = "force-dynamic"; // the sign-in state decides what the forms show

export const metadata: Metadata = {
  title: "Find a service provider | SmartDrugDiscovery",
  description:
    "Chemistry, biology, AI, manufacturing and reagent companies met at BioTechX Europe 2026, with what they offer and how to reach them.",
};

export default async function ProvidersPage() {
  const providers = getAllProviders();
  const user = await getCurrentUser();

  return (
    <PageShell>
      <Link
        href="/collaborate"
        className="inline-flex items-center gap-1 mb-6 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Back to Collaborate
      </Link>

      <PageHeader
        title="Find a service provider"
        subtitle="Companies we met at BioTechX Europe 2026 that can do the work: chemistry, biology, AI, manufacturing and reagents."
        action={<ListServicesButton signedIn={user !== null} />}
        className="mb-8"
      />

      <ProviderDirectory providers={providers} />

      <p className="mt-10 text-sm text-secondary/80">
        Numbers on cards come from each company&apos;s own brochure.
      </p>
    </PageShell>
  );
}
