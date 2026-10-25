// Your teams — /teams. The teams you are on, and a button to start one.

import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { listMyTeams } from "@/lib/server/teams/teams";
import { plural, roleLabel, teamPath } from "@/lib/server/teams/teamRules";
import PageHeader, { PageShell } from "@/components/PageHeader";
import DeletedNotice, { wasDeleted } from "@/components/DeletedNotice";

export const dynamic = "force-dynamic"; // depends on the session

export const metadata = { title: "Your teams · SmartDrugDiscovery" };

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const teams = user ? await listMyTeams() : [];

  return (
    <PageShell className="flex flex-col gap-10">
      <DeletedNotice show={wasDeleted(sp)} />
      <PageHeader
        title="Your teams"
        subtitle="A team is a small private group with its own documents, wiki pages and people."
        className="mb-0"
        action={
          <Link
            href="/teams/new"
            className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md inline-flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            Create a team
          </Link>
        }
      />

      {!user ? (
        <div className="glass-panel rounded-2xl p-8 flex flex-col gap-3 items-start">
          <p className="font-body-md text-body-md text-secondary">
            Sign in to see your teams. Scanning a team&apos;s QR code also brings you to it.
          </p>
          <Link
            href="/login?callbackUrl=%2Fteams"
            className="btn-outline px-5 py-2.5 rounded-lg font-label-md text-label-md"
          >
            Sign in
          </Link>
        </div>
      ) : teams.length === 0 ? (
        <div className="glass-panel rounded-2xl p-8">
          <h2 className="font-headline-sm text-headline-sm text-on-background">No teams yet</h2>
          <p className="mt-1 font-body-md text-body-md text-secondary">
            Click Create a team to make one in a few seconds, or scan a team&apos;s QR code to join one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
          {teams.map((t) => (
            <Link key={t.id} href={teamPath(t.slug)} className="tile group p-6 flex flex-col gap-2">
              <span className="font-title text-[22px] font-medium text-on-background break-words">{t.name}</span>
              {t.description && (
                <span className="font-body-md text-body-md text-secondary line-clamp-2">{t.description}</span>
              )}
              <span className="mt-auto pt-3 font-label-sm text-label-sm text-secondary">
                {plural(t.member_count, "member")} · {roleLabel(t.role)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}
