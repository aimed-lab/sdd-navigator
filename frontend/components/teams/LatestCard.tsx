// "Latest in this team": the three newest items across slides and files, photos and
// learning pages, one line each: the section's icon, the title and "Section · added
// <date>". A row opens that section (a page opens the page). Members are not listed:
// the roster has no joining date. Server-safe.

import Link from "next/link";
import { shortDate } from "@/lib/server/communityHome/communityHome";
import { teamPageHref } from "@/lib/server/teams/teamRules";
import { viewHref, type LatestItem } from "@/lib/server/teams/teamUi";
import { SECTION_ICON, SoftIcon } from "./TeamIcons";

const SECTION_NAME = { slides: "Slides", learn: "Learn", photos: "Photos" } as const;

export default function LatestCard({
  slug,
  items,
  pageSlugs,
}: {
  slug: string;
  items: LatestItem[];
  /** page id -> its slug, for the link of a Learn row. */
  pageSlugs: Record<string, string>;
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border border-[#e8e4da] bg-white p-3.5 min-w-0" aria-labelledby="team-latest">
      <h2 id="team-latest" className="font-title text-[16px] leading-6 text-[#1d1d1b] mb-2">
        Latest in this team
      </h2>
      <ul>
        {items.map((it) => {
          const pageId = it.key.startsWith("p:") ? it.key.slice(2) : null;
          const href = pageId && pageSlugs[pageId] ? teamPageHref(pageSlugs[pageId], slug) : viewHref(slug, it.kind === "learn" ? "learn" : it.kind);
          return (
            <li key={it.key} className="border-t border-[#e8e4da] first:border-t-0">
              <Link href={href} className="flex items-center gap-2.5 py-2 text-[13px] leading-[18px] text-[#1d1d1b] hover:text-[#0f6b33]">
                <SoftIcon icon={SECTION_ICON[it.kind]} size={30} iconSize={18} />
                <span className="min-w-0">
                  <span className="block truncate">{it.title}</span>
                  <small className="block text-[11.5px] leading-4 text-[#6b6a64]">
                    {SECTION_NAME[it.kind]} · added {shortDate(it.at)}
                  </small>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
