// The team page header: a green banner with the team label, name, one-line
// description, member avatars and, on the right, the QR box ("Scan to join",
// Download QR) and the Team settings button (leads). A server component; the
// interactive parts are the client components it renders.

import Link from "next/link";
import { initials } from "@/lib/server/communityHome/communityHome";
import { teamHeaderLine } from "@/lib/server/teams/teamRules";
import JoinQr from "@/components/communities/JoinQr";
import CopyLinkButton from "@/components/communities/CopyLinkButton";
import TeamDescription from "./TeamDescription";

export default function TeamHeader({
  team,
  memberCount,
  memberNames,
  isLead,
}: {
  team: { id: string; slug: string; name: string; description: string | null };
  memberCount: number;
  memberNames: string[];
  isLead: boolean;
}) {
  const shown = memberNames.slice(0, 6);

  return (
    <header className="rounded-2xl bg-primary text-on-primary overflow-hidden">
      <div className="flex flex-col lg:flex-row lg:items-center gap-6 p-6 sm:p-7 min-h-[11rem]">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <span className="font-label-sm text-label-sm tracking-widest text-on-primary/80">
            {teamHeaderLine(memberCount).toUpperCase()}
          </span>
          <h1 className="font-headline-lg text-headline-lg text-on-primary break-words">{team.name}</h1>
          <TeamDescription teamId={team.id} slug={team.slug} description={team.description} isLead={isLead} />
          {shown.length > 0 && (
            <div className="flex -space-x-2 pt-1" aria-hidden>
              {shown.map((n, i) => (
                <span
                  key={i}
                  className="w-8 h-8 rounded-full bg-white/90 text-primary border-2 border-primary flex items-center justify-center font-label-sm text-[11px] font-semibold"
                >
                  {initials(n)}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="lg:w-64 shrink-0 rounded-xl bg-surface-container-lowest text-on-background p-4 flex flex-col items-stretch gap-3 shadow-sm">
          <JoinQr slug={team.slug} name={team.name} isAdmin team />
          <CopyLinkButton slug={team.slug} label="Copy join link" team />
          {isLead && (
            <Link
              href={`/teams/${team.slug}?settings=1#settings`}
              className="btn-outline px-4 py-2 rounded-lg font-label-md text-label-md text-center inline-flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">settings</span>
              Team settings
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
