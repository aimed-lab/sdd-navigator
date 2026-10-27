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
import HeroPhoneActions from "./HeroPhoneActions";
import TeamQrCard from "./TeamQrCard";

export default function TeamHeader({
  team,
  memberCount,
  memberNames,
  isLead,
  compact = false,
}: {
  team: { id: string; slug: string; name: string; description: string | null };
  memberCount: number;
  memberNames: string[];
  isLead: boolean;
  /** Inside a section: on a phone the hero shrinks to a slim bar with the team name only. */
  compact?: boolean;
}) {
  const shown = memberNames.slice(0, 6);
  const more = avatarOverflow(memberCount);

  return (
    <>
      {compact && (
        <div
          className="md:hidden rounded-[20px] text-white px-4 py-3.5"
          style={{ background: "linear-gradient(135deg, #0b3d22, #0f6b33 60%, #1f8a4a)" }}
        >
          <span className="block text-[11px] font-bold tracking-[0.1em] text-white/80">TEAM · PRIVATE</span>
          <span className="block mt-1 font-headline-lg text-[20px] leading-6 text-white break-words">{team.name}</span>
        </div>
      )}
    <header
      className={`relative rounded-[20px] text-white overflow-hidden ${compact ? "hidden md:block" : ""}`}
      style={{ background: "linear-gradient(135deg, #0b3d22, #0f6b33 60%, #1f8a4a)" }}
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
                    className="w-8 h-8 rounded-full bg-white text-[#0f6b33] border-2 border-[#0f6b33] flex items-center justify-center text-[11px] font-semibold"
                  >
                    {initials(n)}
                  </span>
                ))}
                {more && (
                  <span className="w-8 h-8 rounded-full bg-[#0b3d22] text-white border-2 border-[#0f6b33] flex items-center justify-center text-[11px] font-semibold">
                    {more}
                  </span>
                )}
              </div>
            )}
            <span className="text-[14px] leading-5 text-white/90">{plural(memberCount, "member")}</span>
          </div>
          <HeroPhoneActions slug={team.slug} name={team.name} />
        </div>

        <div className="hidden md:block">
          <TeamQrCard slug={team.slug} name={team.name} />
        </div>
      </div>
    </header>
    </>
  );
}
