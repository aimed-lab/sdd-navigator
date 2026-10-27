"use client";

// People: one row per member with an initials avatar (soft green), the name and a
// green "Lead" pill for leads. Someone added by email who has not signed in yet is
// marked "invited". The Connect button stays for everyone but you.

import ConnectButton from "@/components/communities/ConnectButton";
import { initials } from "@/lib/server/communityHome/communityHome";
import { roleLabel } from "@/lib/server/teams/teamRules";
import type { MemberRosterEntry } from "@/lib/server/communities";

export default function PeopleList({
  teamId,
  roster,
  viewerUserId,
  isLead,
}: {
  teamId: string;
  roster: MemberRosterEntry[];
  viewerUserId: string;
  isLead: boolean;
}) {
  return (
    <>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {roster.map((m) => {
          const lead = roleLabel(m.role) === "Lead";
          return (
            <li
              key={m.member_id}
              className="flex items-center gap-2.5 rounded-xl border border-[#e8e4da] bg-white px-3 py-2.5 text-[13.5px] min-w-0"
            >
              <span
                className="grid place-items-center shrink-0 w-[34px] h-[34px] rounded-full bg-[#e9f5ec] text-[#0f6b33] text-[12px] font-bold"
                aria-hidden
              >
                {initials(m.display_name)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[#1d1d1b]">
                {m.display_name}
                {!m.signed_up && <span className="ml-2 text-[11.5px] text-[#6b6a64]">invited</span>}
              </span>
              {lead && (
                <span className="shrink-0 rounded-full bg-[#e9f5ec] px-2 py-0.5 text-[11px] font-bold leading-4 text-[#0f6b33]">Lead</span>
              )}
              {m.user_id !== viewerUserId && <ConnectButton communityId={teamId} memberId={m.member_id} compact />}
            </li>
          );
        })}
      </ul>
      {roster.length <= 1 && (
        <p className="mt-3 text-[13px] leading-[1.5] text-[#6b6a64]">
          Just you so far. Share the QR code at the top{isLead ? ", or invite people by email" : ""}.
        </p>
      )}
    </>
  );
}
