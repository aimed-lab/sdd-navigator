// The workspace's navigation: project name, its label (e.g. ColaboFest 2026),
// team size, then one link per tab. On wide screens it is a column on the left;
// on a phone the same links become a scrolling tab bar across the top. The tab
// lives in the URL (?tab=), so links and the back button work. Server-safe.

import Link from "next/link";
import {
  TAB_ICON,
  TAB_LABEL,
  projectLabel,
  tabHref,
  teamSizeLabel,
  visibleTabs,
  type TabKey,
} from "@/lib/server/projectWorkspace/workspace";

export default function ProjectSidebar({
  projectId,
  name,
  challengeKey,
  memberCount,
  active,
}: {
  projectId: string;
  name: string;
  challengeKey: string | null;
  memberCount: number;
  active: TabKey;
}) {
  const label = projectLabel(challengeKey);
  const tabs = visibleTabs(!!challengeKey);

  return (
    <aside className="lg:w-64 shrink-0">
      <div className="lg:sticky lg:top-24 flex flex-col gap-4">
        <div className="min-w-0">
          {label && (
            <span className="inline-block px-3 py-1 mb-2 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm">
              {label}
            </span>
          )}
          <h1 className="font-title text-[26px] leading-tight font-medium text-on-background break-words">{name}</h1>
          <p className="mt-1 font-body-sm text-body-sm text-secondary">{teamSizeLabel(memberCount)}</p>
        </div>

        <nav aria-label="Project sections" className="-mx-margin-mobile px-margin-mobile lg:mx-0 lg:px-0 overflow-x-auto">
          <ul className="flex lg:flex-col gap-1 whitespace-nowrap">
            {tabs.map((t) => {
              const on = t === active;
              return (
                <li key={t}>
                  <Link
                    href={tabHref(projectId, t)}
                    aria-current={on ? "page" : undefined}
                    className={
                      "flex items-center gap-2 px-4 py-2 rounded-lg font-label-md text-label-md transition-colors " +
                      (on
                        ? "bg-primary text-on-primary"
                        : "text-secondary hover:bg-surface-container-low hover:text-primary")
                    }
                  >
                    <span className="material-symbols-outlined text-[18px]">{TAB_ICON[t]}</span>
                    {TAB_LABEL[t]}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </aside>
  );
}
