// "The network" teaser: three columns of blurred grey placeholder bars with a
// lock overlay and an invite-code button. Shared by the homepage and /industry.
// Placeholder bars only, never real or invented names. Server-safe (no state).

import Link from "next/link";
import Locked from "@/components/Locked";

const COLUMNS = ["Researchers", "Labs", "Companies"] as const;
const WIDTHS = ["w-4/5", "w-full", "w-3/5", "w-11/12", "w-2/3"] as const;

export default function LockedNetworkCard() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white border border-outline-variant/60 p-6 md:p-10">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h2 className="font-headline-lg text-headline-lg text-on-background">The network</h2>
        <Locked />
      </div>
      <div aria-hidden className="grid grid-cols-1 sm:grid-cols-3 gap-6 blur-[2px] select-none">
        {COLUMNS.map((col) => (
          <div key={col}>
            <p className="font-label-md text-label-md uppercase tracking-wide text-secondary mb-4">
              {col}
            </p>
            <div className="space-y-3">
              {WIDTHS.map((w, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="h-8 w-8 rounded-full bg-surface-container-high shrink-0" />
                  <span className={`h-3 rounded-full bg-surface-container-high ${w}`} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 top-20 bg-white/25 flex flex-col items-center justify-center gap-4 text-center p-6">
        <span className="material-symbols-outlined text-primary text-5xl">lock</span>
        <p className="font-headline-md text-headline-md text-on-background">
          Unlock the full network with an invite code
        </p>
        <Link
          href="/invite"
          className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md"
        >
          Request invite code
        </Link>
      </div>
    </div>
  );
}
