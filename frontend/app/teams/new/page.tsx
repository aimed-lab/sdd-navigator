// Create a team — /teams/new. One name, optional emails, one button. A signed-out
// visitor sees the same form, with the button replaced by the existing sign-in
// link (which returns here with the typed name).

import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import PageHeader, { PageShell } from "@/components/PageHeader";
import CreateTeamForm from "@/components/teams/CreateTeamForm";

export const dynamic = "force-dynamic"; // depends on the session

export const metadata = { title: "Create a team · SmartDrugDiscovery" };

export default async function NewTeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const initialName = typeof sp.name === "string" ? sp.name.slice(0, 80) : "";
  const user = await getCurrentUser();

  return (
    <PageShell narrow>
      <Link
        href="/teams"
        className="inline-flex items-center gap-1 mb-8 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Your teams
      </Link>
      <PageHeader
        title="Create a team"
        subtitle="A team is a small private group. Give it a name and you are in. You get a QR code to bring people in."
        className="mb-8"
      />
      <CreateTeamForm signedIn={!!user} initialName={initialName} />
    </PageShell>
  );
}
