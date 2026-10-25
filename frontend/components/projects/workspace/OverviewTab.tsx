// The Overview tab: the project description and details, the project's wiki
// pages, and (right column) progress, the next checklist items and the team.
// The one primary button is "New wiki page". Server-safe.

import Link from "next/link";
import { tabHref } from "@/lib/server/projectWorkspace/workspace";
import { dueLabel, isOverdue, listProgress, nextUp } from "@/lib/server/projectWorkspace/status";
import HelpBanner from "./HelpBanner";
import type { ChecklistItem, ProjectMember } from "@/lib/server/projects";
import type { ProjectPage } from "@/lib/server/pages/projectPages";
import NewProjectWikiPage from "./NewProjectWikiPage";
import WikiList from "./WikiList";

function Card({ title, children, href, linkLabel }: { title: string; children: React.ReactNode; href?: string; linkLabel?: string }) {
  return (
    <section className="rounded-2xl glass-panel p-5 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-headline-sm text-headline-sm text-on-background">{title}</h2>
        {href && (
          <Link href={href} className="font-label-sm text-label-sm text-primary hover:underline underline-offset-4 shrink-0">
            {linkLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export default function OverviewTab({
  projectId,
  description,
  chips,
  checklist,
  members,
  pages,
  today,
  role,
  helpPosts,
}: {
  today: string;
  /** The viewer's role on the project (lead, manager or member). */
  role: string;
  /** Unresolved help posts, newest first. */
  helpPosts: { id: string; body: string }[];
  projectId: string;
  description: string | null;
  chips: string[];
  checklist: ChecklistItem[];
  members: ProjectMember[];
  pages: ProjectPage[];
}) {
  // All three lists together: overdue first, then by due date.
  const lp = listProgress(checklist);
  const progress = { ...lp, percent: lp.total === 0 ? 0 : Math.round((lp.ready / lp.total) * 100) };
  const next = nextUp(checklist, today, 4);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-8 items-start">
      <div className="flex flex-col gap-8 min-w-0">
        <HelpBanner projectId={projectId} role={role} posts={helpPosts} />
        <section className="flex flex-col gap-4">
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <span key={c} className="px-3 py-1 rounded-full bg-primary/5 text-primary font-label-sm text-label-sm">
                  {c}
                </span>
              ))}
            </div>
          )}
          <p className="font-body-lg text-body-lg text-secondary max-w-3xl">
            {description || "No description yet. Your team's wiki, tasks, files and people are all on the left."}
          </p>
          <div>
            <NewProjectWikiPage projectId={projectId} />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-headline-sm text-headline-sm text-on-background">Wiki pages</h2>
            {pages.length > 0 && (
              <Link href={tabHref(projectId, "wiki")} className="font-label-sm text-label-sm text-primary hover:underline underline-offset-4">
                Open the wiki
              </Link>
            )}
          </div>
          {pages.length === 0 ? (
            <p className="font-body-md text-body-md text-secondary max-w-2xl">
              No wiki pages yet. Click New wiki page above and type a topic; the page collects the latest papers and
              trials for your team.
            </p>
          ) : (
            <WikiList projectId={projectId} pages={pages.slice(0, 5)} />
          )}
        </section>
      </div>

      <div className="flex flex-col gap-4 min-w-0">
        <Card title="Progress" href={tabHref(projectId, "tasks")} linkLabel="Tasks">
          {progress.total === 0 ? (
            <p className="font-body-md text-body-md text-secondary">
              No checklist yet. Add the first item under Tasks &amp; checklists.
            </p>
          ) : (
            <>
              <p className="font-body-md text-body-md text-on-background">
                {progress.ready} of {progress.total} ready
              </p>
              <div className="h-2 rounded-full bg-surface-container overflow-hidden" aria-hidden>
                <div className="h-full bg-primary" style={{ width: `${progress.percent}%` }} />
              </div>
            </>
          )}
        </Card>

        <Card title="Next up" href={tabHref(projectId, "tasks")} linkLabel="All tasks">
          {next.length === 0 ? (
            <p className="font-body-md text-body-md text-secondary">
              {progress.total === 0 ? "Nothing to do yet." : "Everything on the checklist is ready."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {next.map((i) => (
                <li key={i.id} className="flex items-start gap-2 font-body-md text-body-md text-on-background">
                  <span className="material-symbols-outlined text-[18px] text-secondary mt-0.5">
                    {i.status === "in_progress" ? "pending" : "radio_button_unchecked"}
                  </span>
                  <span className="min-w-0 break-words">
                    {i.label}
                    {i.assignee_name && <span className="text-secondary"> · {i.assignee_name}</span>}
                    {i.due_date && (
                      <span className={isOverdue(i, today) ? " text-error font-medium" : " text-secondary"}>
                        {" "}
                        · {isOverdue(i, today) ? "Overdue " : "Due "}
                        {dueLabel(i.due_date)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Team" href={tabHref(projectId, "team")} linkLabel="Manage">
          <ul className="flex flex-col gap-2">
            {members.slice(0, 6).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 font-body-md text-body-md">
                <span className="min-w-0 truncate text-on-background">{m.user_id && m.name ? m.name : m.email}</span>
                <span className="shrink-0 font-label-sm text-label-sm text-secondary">
                  {!m.user_id ? "Invited" : m.role === "lead" ? "Lead" : "Member"}
                </span>
              </li>
            ))}
          </ul>
          {members.length > 6 && <p className="font-body-sm text-body-sm text-secondary">and {members.length - 6} more</p>}
        </Card>
      </div>
    </div>
  );
}
