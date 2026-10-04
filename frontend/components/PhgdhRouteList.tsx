// The PHGDH route as a numbered list, one short line per step, under the map so
// it reads well on phones. Same links as the map (lib/phgdhRoute.ts). The
// invite-only step carries the lock; external steps open in a new tab with ↗.

import Link from "next/link";
import { isExternal, PHGDH_STEPS } from "@/lib/phgdhRoute";

const ROUTE_COLOR = "#C2410C";

export default function PhgdhRouteList() {
  return (
    <ol className="mt-8 max-w-3xl mx-auto divide-y divide-[#e7e4dc] border-y border-[#e7e4dc]">
      {PHGDH_STEPS.map((step, i) => {
        const external = isExternal(step.href);
        const inner = (
          <>
            <span
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-label-md text-label-md text-white"
              style={{ background: step.locked ? "#9ca3af" : ROUTE_COLOR }}
            >
              {i + 1}
            </span>
            <span className="flex-1 font-body-lg text-body-lg text-on-background">
              {step.listText}
              {external && <span aria-hidden> ↗</span>}
            </span>
            {step.locked && (
              <span className="shrink-0 inline-flex items-center gap-1 text-secondary font-label-sm text-label-sm">
                <span className="material-symbols-outlined text-base leading-none">lock</span>
                Invite only
              </span>
            )}
          </>
        );
        const cls =
          "flex items-center gap-4 py-4 hover:bg-black/[0.03] transition-colors px-2 -mx-2 rounded-lg";
        return (
          <li key={step.key}>
            {external ? (
              <a href={step.href} target="_blank" rel="noopener noreferrer" className={cls}>
                {inner}
              </a>
            ) : (
              <Link href={step.href} className={cls}>
                {inner}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
