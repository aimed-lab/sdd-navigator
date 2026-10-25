// Welcome — /start. Where a signed-in person lands after signing in when they
// weren't headed anywhere in particular. Four big tiles: make a team, see your
// teams, ask the assistant, explore research. Signed out goes to sign-in and
// comes back here.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listMyTeamsNewest } from "@/lib/server/teams/teams";
import { firstName, NO_TEAMS_LINE, START_QUESTION, START_SIGN_IN, welcomeLine } from "@/lib/startRules";
import { PageShell } from "@/components/PageHeader";
import ActionTile from "@/components/ui/ActionTile";
import StartAssistantTile from "@/components/start/StartAssistantTile";

export const dynamic = "force-dynamic"; // depends on the session

export const metadata = { title: "Getting started · SmartDrugDiscovery" };

export default async function StartPage() {
  const session = await getSession();
  if (!session) redirect(START_SIGN_IN);

  const [teams, profile] = await Promise.all([
    listMyTeamsNewest(5),
    session.db.from("users").select("name").eq("id", session.user.id).maybeSingle(),
  ]);
  const first = firstName((profile.data as { name?: string | null } | null)?.name, session.user.email);

  return (
    <PageShell className="!max-w-[1120px]">
      <h1 className="font-headline-lg text-[28px] sm:text-[34px] leading-[1.2] text-on-background break-words">
        {welcomeLine(first)} {START_QUESTION}
      </h1>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4">
        <ActionTile
          icon="group_add"
          title="Create a team"
          description="A private group with a QR code to bring people in. Share slides, wiki pages and learning material."
          action="Create a team →"
          tone="green"
          featured
          href="/teams/new"
        />

        <ActionTile icon="groups" title="Your teams" tone="blue">
          {teams.length === 0 ? (
            <span className="font-body-sm text-[13.5px] leading-[1.5] text-secondary">{NO_TEAMS_LINE}</span>
          ) : (
            <>
              <ul className="flex flex-col gap-1 min-w-0">
                {teams.map((t) => (
                  <li key={t.slug} className="min-w-0">
                    <Link
                      href={`/teams/${t.slug}`}
                      className="font-body-md text-[14px] leading-6 text-[#2c4a9a] hover:underline underline-offset-4 break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2c4a9a] rounded"
                    >
                      {t.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                href="/teams"
                className="mt-auto pt-1 text-[13.5px] font-semibold leading-6 text-[#2c4a9a] hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2c4a9a] rounded"
              >
                See all →
              </Link>
            </>
          )}
        </ActionTile>

        <StartAssistantTile />

        <ActionTile
          icon="search"
          title="Explore research"
          description="Search papers, trials, approvals, datasets and grants."
          action="Start exploring →"
          tone="rose"
          href="/explore"
        />
      </div>
    </PageShell>
  );
}
