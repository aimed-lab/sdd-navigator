// The team page hero: a deep green card with the eyebrow, team name (serif),
// one-line description, an avatar stack with the member count, and on the right
// a white card with the join QR. Leads also get a "Team settings" button at the
// top right. Stacks on a phone, with the QR card full width under the text.
// A server component; the interactive parts are the client components it renders.

import Link from "next/link";
import { initials } from "@/lib/server/communityHome/communityHome";
import { plural } from "@/lib/server/teams/teamRules";
import { avatarOverflow } from "@/lib/server/teams/teamUi";
import TeamDescription from "./TeamDescription";
import TeamQrCard from "./TeamQrCard";

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
  const more = avatarOverflow(memberCount);

  return (
    <header
      className="relative rounded-[20px] text-white overflow-hidden"
      style={{ background: "linear-gradient(135deg, #033319, #1A5632 60%, #1A5632)" }}
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-6 p-5 sm:p-7">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[12px] leading-5 font-semibold tracking-[0.14em] text-white/80">TEAM · PRIVATE</span>
            {isLead && (
              <Link
                href={`/teams/${team.slug}?settings=1#settings`}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-white/70 px-3 py-1.5 text-[13px] font-semibold leading-5 text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <span className="material-symbols-outlined text-[18px]">settings</span>
                Team settings
              </Link>
            )}
          </div>
          <h1 className="font-headline-lg text-[28px] sm:text-[32px] leading-[1.2] text-white break-words">{team.name}</h1>
          <TeamDescription teamId={team.id} slug={team.slug} description={team.description} isLead={isLead} />
          <div className="flex items-center gap-3 pt-1">
            {shown.length > 0 && (
              <div className="flex -space-x-2" aria-hidden>
                {shown.map((n, i) => (
                  <span
                    key={i}
                    className="w-8 h-8 rounded-full bg-white text-[#1A5632] border-2 border-[#1A5632] flex items-center justify-center text-[11px] font-semibold"
                  >
                    {initials(n)}
                  </span>
                ))}
                {more && (
                  <span className="w-8 h-8 rounded-full bg-[#033319] text-white border-2 border-[#1A5632] flex items-center justify-center text-[11px] font-semibold">
                    {more}
                  </span>
                )}
              </div>
            )}
            <span className="text-[14px] leading-5 text-white/90">{plural(memberCount, "member")}</span>
          </div>
        </div>

        <TeamQrCard slug={team.slug} name={team.name} />
      </div>
    </header>
  );
}
