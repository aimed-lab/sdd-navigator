"use client";

// "Leave team": a small secondary button at the bottom of the People list. It asks
// "Leave <team>? You can join again with the QR code or link." with Cancel / Leave.
// The server action decides (a lead can leave only when another lead remains); on
// success the person goes to /teams, which shows "You left the team.".

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { leaveTeamAction } from "@/app/teams/actions";
import Sheet from "@/components/ui/Sheet";

export default function LeaveTeamButton({ teamId, slug, teamName }: { teamId: string; slug: string; teamName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await leaveTeamAction(teamId, slug);
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    router.push("/teams?left=1");
  };

  return (
    <>
      <div className="mt-6 flex">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#e8e4da] bg-white px-3 py-2 text-[12.5px] font-semibold leading-4 text-[#6b6a64] hover:text-[#1d1d1b] hover:border-[#cfc8b8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6b33]"
        >
          <LogOut size={16} strokeWidth={1.75} aria-hidden />
          Leave team
        </button>
      </div>
      {open && (
        <Sheet title="Leave team" onClose={() => !busy && setOpen(false)}>
          <div className="flex flex-col gap-4">
            <p className="text-[14.5px] leading-[1.5] text-[#1d1d1b]">
              Leave {teamName}? You can join again with the QR code or link.
            </p>
            {error && (
              <p className="text-[13.5px] leading-5 font-semibold text-error" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={leave}
                disabled={busy}
                className="rounded-[10px] bg-[#1d1d1b] px-5 py-2.5 text-[13px] font-bold leading-5 text-white hover:bg-black disabled:opacity-50"
              >
                {busy ? "Leaving…" : "Leave"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-[10px] border border-[#e8e4da] bg-white px-5 py-2.5 text-[13px] font-bold leading-5 text-[#1d1d1b] hover:border-[#cfc8b8] disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
