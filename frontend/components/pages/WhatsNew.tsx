// "What's new" on a living page: what refresh runs added (page_updates),
// newest day first, one line per day ("Oct 20: 3 new papers, 1 new FDA
// approval") that opens to the items, each linking out. The page's first build
// is not an update; it is the single line at the bottom, "Page created <date>
// with <N> sources". Server component (native <details>).

import SectionHeading from "@/components/explore/SectionHeading";
import { groupUpdatesByDate, type UpdateRow } from "@/lib/server/pages/pageViewHelpers";

export default function WhatsNew({ updates, createdLine }: { updates: UpdateRow[]; createdLine: string }) {
  const groups = groupUpdatesByDate(updates);

  return (
    <section>
      <SectionHeading title="What's new" subtitle="Resources added to this page, newest first." />
      {groups.length === 0 && (
        <p className="mb-3 font-body-md text-body-md text-secondary">Nothing new since the page was created.</p>
      )}
      <div className="divide-y divide-[#e7e4dc] border-y border-[#e7e4dc]">
        {groups.map((group, i) => (
          <details key={group.date} open={i === 0} className="group py-3">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-body-md text-body-md text-on-background">
              <span>{group.headline}</span>
              <span className="material-symbols-outlined text-secondary text-base transition-transform group-open:rotate-180">
                expand_more
              </span>
            </summary>
            <ul className="mt-3 flex flex-col gap-2">
              {group.items.map((u) => (
                <li key={u.id} className="font-body-sm text-body-sm">
                  {u.url ? (
                    <a
                      href={u.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-on-background hover:text-primary hover:underline underline-offset-4"
                    >
                      {u.title}
                    </a>
                  ) : (
                    <span className="text-on-background">{u.title}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ))}
        <p className="py-3 font-body-sm text-body-sm text-secondary">{createdLine}</p>
      </div>
    </section>
  );
}
