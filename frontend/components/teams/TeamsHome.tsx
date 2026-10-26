// "/" in teams mode: a simple landing. Server component.

import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { listMyTeamsNewest } from "@/lib/server/teams/teams";
import { teamPath } from "@/lib/server/teams/teamRules";

export default async function TeamsHome() {
  const user = await getCurrentUser();
  const teams = user ? await listMyTeamsNewest(12) : [];

  return (
    <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-24 flex flex-col gap-10">
      <div className="flex flex-col gap-3 text-center">
        <h1 className="font-title text-[40px] md:text-[56px] leading-[1.1] font-medium text-on-background">Teams</h1>
        <p className="font-body-lg text-body-lg text-secondary">
          A private space for your group: slides, papers, AI-updated learning pages, and people.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/teams/new"
          className="btn-primary rounded-2xl px-6 py-6 font-label-lg text-[18px] text-center inline-flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined">add</span>
          Create a team
        </Link>
        <div className="rounded-2xl border border-[#e8e4da] bg-white px-6 py-4 text-center flex flex-col items-center justify-center gap-1">
          <span className="font-label-lg text-[18px] text-on-background inline-flex items-center gap-2">
            <span className="material-symbols-outlined">qr_code_scanner</span>
            Join with a QR code
          </span>
          <span className="font-body-sm text-body-sm text-secondary">Scan the QR code your organiser shared</span>
        </div>
      </div>

      {teams.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="your-teams">
          <h2 id="your-teams" className="font-headline-sm text-[22px] leading-8 text-on-background">
            Your teams
          </h2>
          <ul className="flex flex-col gap-2">
            {teams.map((t) => (
              <li key={t.slug}>
                <Link
                  href={teamPath(t.slug)}
                  className="block rounded-xl border border-[#e8e4da] bg-white px-5 py-3 font-label-lg text-on-background hover:border-primary transition-colors"
                >
                  {t.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
