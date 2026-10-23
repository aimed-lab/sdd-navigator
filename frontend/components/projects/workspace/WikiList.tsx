// The project's wiki pages, sub-pages nested under their parent, with the
// page's last update. Empty state says what to do. Server-safe (the sub-page
// button is a client component).

import Link from "next/link";
import { pageDateLine } from "@/lib/server/pages/pageEditCore";
import { flattenPages, nestPages } from "@/lib/server/projectWorkspace/workspace";
import type { ProjectPage } from "@/lib/server/pages/projectPages";
import NewProjectWikiPage from "./NewProjectWikiPage";

export default function WikiList({ projectId, pages }: { projectId: string; pages: ProjectPage[] }) {
  if (pages.length === 0) {
    return (
      <div className="glass-panel rounded-2xl p-8 max-w-2xl flex flex-col items-start gap-4">
        <p className="font-body-md text-body-md text-secondary">
          No wiki pages yet. A wiki page collects the latest papers and trials on one topic for your team and keeps
          itself up to date. Click New wiki page and type the topic.
        </p>
        <NewProjectWikiPage projectId={projectId} />
      </div>
    );
  }

  const rows = flattenPages(nestPages(pages));
  const byId = new Map(pages.map((p) => [p.id, p]));
  return (
    <ul className="flex flex-col gap-2 max-w-3xl">
      {rows.map(({ page, depth }) => {
        const full = byId.get(page.id);
        return (
          <li
            key={page.id}
            style={{ marginLeft: Math.min(depth, 3) * 24 }}
            className="rounded-xl bg-white border border-outline-variant/30 p-4 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <Link
                href={`/pages/${page.slug}`}
                className="font-title text-[18px] leading-tight font-medium text-on-background hover:text-primary break-words"
              >
                {depth > 0 && <span className="text-secondary/60 mr-1">↳</span>}
                {page.title}
              </Link>
              <p className="mt-1 font-body-sm text-body-sm text-secondary">{pageDateLine(full?.last_refreshed_at, full?.created_at)}</p>
            </div>
            {depth === 0 && <NewProjectWikiPage projectId={projectId} parentPageId={page.id} variant="text" />}
          </li>
        );
      })}
    </ul>
  );
}
