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
    <nav aria-label="Community sections" className="border-b border-outline-variant/40 overflow-x-auto">
      <ul className="flex gap-1 min-w-max">
        {tabs.map((t) => {
          const on = t === active;
          return (
            <li key={t}>
              <Link
                href={t === "home" ? `/communities/${slug}` : `/communities/${slug}?tab=${t}`}
                aria-current={on ? "page" : undefined}
                className={
                  "block px-4 py-3 font-label-md text-label-md border-b-2 -mb-px transition-colors " +
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
