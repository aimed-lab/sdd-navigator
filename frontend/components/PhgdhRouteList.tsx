// The PHGDH case as a numbered list under the map, grouped under the hub's three
// functions (Explore, Collaborate, Promote). Same steps, order and links as the
// map stations (lib/phgdhRoute.ts), so it reads well on phones. The invite-only
// step carries the lock; external links open in a new tab with a ↗.

import Link from "next/link";
import { GROUPS, isExternal, PHGDH_STEPS, type PhgdhStep } from "@/lib/phgdhRoute";

const ROUTE_COLOR = "#C2410C";
const LINK_CLS = "text-primary hover:underline underline-offset-4";

function SmartLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return isExternal(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function Badge({ n, locked }: { n: number; locked?: boolean }) {
  return (
    <span
      className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-label-md text-label-md text-white"
      style={{ background: locked ? "#9ca3af" : ROUTE_COLOR }}
    >
      {n}
    </span>
  );
}

function Step({ step, n }: { step: PhgdhStep; n: number }) {
  const rowCls = "flex items-center gap-4 py-4 px-2 -mx-2 rounded-lg";
  const lock = step.locked && (
    <span className="shrink-0 inline-flex items-center gap-1 text-secondary font-label-sm text-label-sm">
      <span className="material-symbols-outlined text-base leading-none">lock</span>
      Invite only
    </span>
  );

  // A line with several links: the line itself is plain text.
  if (step.listLinks) {
    return (
      <li className={rowCls}>
        <Badge n={n} />
        <span className="flex-1 font-body-lg text-body-lg text-on-background">
          {step.listText}{" "}
          {step.listLinks.map((l, i) => (
            <span key={l.href}>
              {i > 0 && <span className="text-secondary"> and </span>}
              <SmartLink href={l.href} className={LINK_CLS}>
                {l.label}
                {isExternal(l.href) ? " ↗" : " →"}
              </SmartLink>
            </span>
          ))}
        </span>
      </li>
    );
  }

  return (
    <li>
      <SmartLink href={step.href} className={`${rowCls} hover:bg-black/[0.03] transition-colors`}>
        <Badge n={n} locked={step.locked} />
        <span className="flex-1 font-body-lg text-body-lg text-on-background">
          {step.listText}
          {isExternal(step.href) && <span aria-hidden> ↗</span>}
        </span>
        {lock}
      </SmartLink>
    </li>
  );
}

export default function PhgdhRouteList() {
  return (
    <div className="mt-8 max-w-3xl mx-auto space-y-6">
      {GROUPS.map((group) => {
        const steps = PHGDH_STEPS.map((step, i) => ({ step, n: i + 1 })).filter(
          (s) => s.step.group === group
        );
        return (
          <section key={group}>
            <h3 className="font-label-md text-label-md uppercase tracking-wide text-secondary mb-1">
              {group}
            </h3>
            <ol className="divide-y divide-[#e7e4dc] border-y border-[#e7e4dc]">
              {steps.map(({ step, n }) => (
                <Step key={step.key} step={step} n={n} />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
