// Tab bar for the community page. Plain links (`?tab=`), so each tab is a
// server render, shareable, and works without client JS. Which tabs exist is
// decided by visibleTabs() in lib/server/communityHome.

import Link from "next/link";
import { TAB_LABEL, type TabKey } from "@/lib/server/communityHome/communityHome";

export default function CommunityTabs({
  slug,
  tabs,
  active,
}: {
  slug: string;
  tabs: TabKey[];
  active: TabKey;
}) {
  return (
    // overflow-x:auto alone makes the box scroll vertically too (the little
    // up/down widget), so y is clipped; the scrollbar is hidden on every engine.
    <nav
      aria-label="Community sections"
      className="border-b border-outline-variant/40 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex gap-1 min-w-max">
        {tabs.map((t) => {
          const on = t === active;
          return (
            <li key={t}>
              <Link
                href={t === "home" ? `/communities/${slug}` : `/communities/${slug}?tab=${t}`}
                aria-current={on ? "page" : undefined}
                className={
                  "block whitespace-nowrap px-4 py-3 font-label-md text-label-md border-b-2 transition-colors " +
                  (on
                    ? "border-primary text-primary"
                    : "border-transparent text-secondary hover:text-on-background")
                }
              >
                {TAB_LABEL[t]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
