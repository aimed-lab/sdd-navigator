// The Overview tab. Middle column, top to bottom: the Welcome card (ColaboFest,
// until dismissed), the Box folder card, the newest Announcements and the newest
// Discussions. Right column: Progress (the SPARC and Southern Research
// checklists) and Team. On a phone it is one column in this order: Welcome, Box,
// Progress, Announcements, Discussions, Team. That order comes from `order-*` on
// each card; the two column wrappers are `contents` on a phone and real columns
// from xl up. Server-safe (WelcomeCard and HelpBanner are the only client parts).

import Link from "next/link";
import { tabHref } from "@/lib/server/projectWorkspace/workspace";
import { LIST_LABEL, dueLabel, isOverdue, progressByList, visibleLists, type ListKey } from "@/lib/server/projectWorkspace/status";
import { nextDue, roleLabel, shortDate, timeAgo } from "@/lib/server/projectWorkspace/colabofest";
import type { ChecklistItem, ProjectMember } from "@/lib/server/projects";
import type { ProjectUpdate } from "@/lib/server/projectWorkspace/updates";
import type { Thread } from "@/lib/server/projectWorkspace/discussions";
import HelpBanner from "./HelpBanner";
import WelcomeCard from "./WelcomeCard";
import LinkedText from "./LinkedText";

function Card({
  title,
  children,
  href,
  linkLabel,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <section className={"rounded-2xl glass-panel p-5 flex flex-col gap-3 " + className}>
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

function Bar({ label, ready, total }: { label: string; ready: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((ready / total) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-body-md text-body-md text-on-background">{label}</span>
        <span className="font-label-sm text-label-sm text-secondary shrink-0">
          {ready} of {total}
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-container overflow-hidden" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={ready}>
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function OverviewTab({
  projectId,
  isColabofest,
  showWelcome,
  firstName,
  today,
  role,
  description,
  sharedFolderUrl,
  checklist,
  members,
  announcements,
  threads,
  helpPosts,
}: {
  projectId: string;
  isColabofest: boolean;
  /** The Welcome card is still wanted (ColaboFest and not dismissed). */
  showWelcome: boolean;
  firstName: string;
  today: string;
  /** The viewer's role on the project (lead, manager or member). */
  role: string;
  description: string | null;
  sharedFolderUrl: string | null;
  checklist: ChecklistItem[];
  members: ProjectMember[];
  /** Already arranged: pinned first, then newest. */
  announcements: ProjectUpdate[];
  /** Already sorted: newest activity first. */
  threads: Thread[];
  helpPosts: { id: string; body: string }[];
}) {
  const lists: ListKey[] = isColabofest ? (["sparc", "southern_research"] as ListKey[]) : visibleLists(false);
  const byList = progressByList(checklist);
  const due = nextDue(checklist, today);
  const isLead = role === "lead";

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 items-start">
      <div className="contents xl:flex xl:flex-col xl:gap-6 xl:min-w-0">
        <div className="order-1 min-w-0 flex flex-col gap-4 empty:hidden">
          <HelpBanner projectId={projectId} role={role} posts={helpPosts} />
          {showWelcome && <WelcomeCard projectId={projectId} firstName={firstName} today={today} />}
          {!isColabofest && description && <p className="font-body-lg text-body-lg text-secondary max-w-3xl">{description}</p>}
        </div>

        <section
          className="order-2 rounded-2xl border border-[#9bd0a8] bg-[#e8f5ec] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          aria-label={isColabofest ? "Your Box folder" : "Shared folder"}
        >
          <div className="min-w-0">
            <h2 className="font-title text-[22px] leading-snug font-medium text-[#14532d]">
              {isColabofest ? "Your Box folder" : "Shared folder"}
            </h2>
            <p className="mt-1 font-body-md text-body-md text-[#1f5f36]">
              {sharedFolderUrl
                ? isColabofest
                  ? "Proposal, data and results for your team"
                  : "Files your team keeps together"
                : isLead
                  ? isColabofest
                    ? "Your team's folder is not linked yet."
                    : "No folder is linked yet."
                  : isColabofest
                    ? "Your Box folder will appear here"
                    : "The shared folder will appear here"}
            </p>
          </div>
          {sharedFolderUrl ? (
            <a
              href={sharedFolderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center justify-center gap-1 rounded-xl bg-[#166534] hover:bg-[#14532d] text-white px-6 py-3 font-label-md text-label-md transition-colors"
            >
              {isColabofest ? "Open Box folder" : "Open folder"} ↗
            </a>
          ) : isLead ? (
            <Link
              href={tabHref(projectId, "files")}
              className="shrink-0 inline-flex items-center justify-center rounded-xl bg-[#166534] hover:bg-[#14532d] text-white px-6 py-3 font-label-md text-label-md transition-colors"
            >
              {isColabofest ? "Add your Box folder link" : "Add a folder link"}
            </Link>
          ) : null}
        </section>

        <Card title="Announcements" href={tabHref(projectId, "announcements")} linkLabel="See all" className="order-4">
          {announcements.length === 0 ? (
            <p className="font-body-md text-body-md text-secondary">No announcements yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {announcements.slice(0, 3).map((a) => (
                <li key={a.id} className="flex flex-col gap-1 border-t border-outline-variant/20 pt-3 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2 font-label-sm text-label-sm text-secondary">
                    {a.pinned && (
                      <span className="px-2 py-0.5 rounded-full bg-primary text-on-primary uppercase tracking-wider text-[10px]">Pinned</span>
                    )}
                    <span className="text-on-background">{a.author_name ?? "SPARC team"}</span>
                    <span>{shortDate(a.created_at)}</span>
                  </div>
                  <p className="font-body-md text-body-md text-on-background whitespace-pre-wrap break-words line-clamp-3">
                    <LinkedText text={a.body} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Discussions" href={tabHref(projectId, "discussions")} linkLabel="See all" className="order-5">
          {threads.length === 0 ? (
            <p className="font-body-md text-body-md text-secondary">No discussions yet. Say hello and start the first one.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {threads.slice(0, 3).map((t) => (
                <li key={t.id} className="border-t border-outline-variant/20 pt-3 first:border-t-0 first:pt-0">
                  <Link href={`${tabHref(projectId, "discussions")}&thread=${t.id}`} className="block hover:text-primary">
                    <span className="block font-label-lg text-[16px] text-on-background break-words">{t.title}</span>
                    <span className="block font-body-sm text-body-sm text-secondary">
                      {t.author_name ?? "A team member"} · {timeAgo(t.last_activity_at)} · {t.reply_count} {t.reply_count === 1 ? "reply" : "replies"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Link
              href={`${tabHref(projectId, "discussions")}&new=1`}
              className="inline-flex items-center gap-1 font-label-md text-label-md text-primary hover:underline underline-offset-4"
            >
              + Start a discussion
            </Link>
          </div>
        </Card>
      </div>

      <div className="contents xl:flex xl:flex-col xl:gap-6 xl:min-w-0">
        <Card title="Progress" className="order-3">
          {lists.map((k) => (
            <Bar key={k} label={LIST_LABEL[k]} ready={byList[k].ready} total={byList[k].total} />
          ))}
          <p className="font-body-md text-body-md text-on-background">
            {due ? (
              <>
                <span className="text-secondary">Next due: </span>
                {due.label}{" "}
                <span className={isOverdue(due, today) ? "text-error font-medium" : "text-secondary"}>
                  {isOverdue(due, today) ? "Overdue " : ""}
                  {dueLabel(due.due_date)}
                </span>
                {due.assignee_name && <span className="text-secondary"> · {due.assignee_name}</span>}
              </>
            ) : (
              <span className="text-secondary">Next due: nothing scheduled</span>
            )}
          </p>
          <div>
            <Link href={tabHref(projectId, "tasks")} className="font-label-md text-label-md text-primary hover:underline underline-offset-4">
              Open checklists
            </Link>
          </div>
        </Card>

        <Card title="Team" href={tabHref(projectId, "team")} linkLabel={isLead ? "Manage" : "See all"} className="order-6">
          <ul className="flex flex-col gap-2">
            {members.slice(0, 8).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 font-body-md text-body-md">
                <span className="min-w-0 truncate text-on-background">{m.user_id && m.name ? m.name : m.email}</span>
                <span className="shrink-0 font-label-sm text-label-sm text-secondary">
                  {!m.user_id && m.role !== "lead" ? "Invited" : roleLabel(m.role, m.affiliation)}
                </span>
              </li>
            ))}
          </ul>
          {members.length > 8 && <p className="font-body-sm text-body-sm text-secondary">and {members.length - 8} more</p>}
        </Card>
      </div>
    </div>
  );
}
