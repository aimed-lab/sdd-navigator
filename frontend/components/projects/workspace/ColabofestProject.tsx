// A ColaboFest project (projects.program = 'colabofest_2026'), minimal like the CFDE
// conference app: the hero banner, a to-do banner for finalists, up to six tiles
// (Tasks, Project files, Announcements, Team, Timeline, Manage) and, on the home, the
// three latest announcements. A tile opens its section on this page (?view=...) with
// "← Project home". Manage (the SPARC team) holds everything else the project page
// used to show. Discussions is not shown here (the code and data stay). Server-safe.

import Link from "next/link";
import {
  IconArrowLeft,
  IconChecklist,
  IconClock,
  IconFolder,
  IconMegaphone,
  IconSettings,
  IconUsers,
  IconExternal,
} from "@/components/communities/CommunityIcons";
import { COLABOFEST_CONTACT_EMAIL, COLABOFEST_STAGES, currentStageIndex, FINALIST_DUE } from "@/lib/colabofestConfig";
import { initials, plural, shortDate } from "@/lib/server/communityHome/communityHome";
import { finalistBanner, tasksTileLine, type ProjectView, type TaskRow, MANAGE_SECTIONS, type ManageSection } from "@/lib/server/projectWorkspace/finalistTasks";
import FinalistTasks from "./FinalistTasks";
import LinkedText from "./LinkedText";

const SECTION_TITLE: Record<ProjectView, string> = {
  tasks: "Tasks",
  files: "Project files",
  announcements: "Announcements",
  team: "Team",
  timeline: "Timeline",
  manage: "Manage",
};

const MANAGE_LABEL: Record<ManageSection, string> = {
  announcements: "Announcements",
  tasks: "Tasks & checklists",
  files: "Files",
  wiki: "Wiki",
  team: "Team",
  proposal: "Proposal",
};

const TILE =
  "relative text-center min-w-0 flex flex-col items-center basis-[calc((100%-20px)/3)] md:basis-[calc((100%-50px)/6)] grow-0 shrink-0 rounded-2xl bg-white px-1.5 pt-4 pb-3.5 md:pt-[18px] " +
  "transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

type Tile = { key: ProjectView; label: string; small: string; badge?: string | null; icon: React.ReactNode; dashed?: boolean };

export default function ColabofestProject({
  projectId,
  name,
  label,
  finalist,
  memberNames,
  memberCount,
  view,
  today,
  canMark,
  showManage,
  taskRows,
  sharedFolderUrl,
  announcements,
  announcementsNew,
  announcementsCount,
  announcementsNode,
  teamNode,
  manageNode,
  manageSection,
  hasProposal,
  nextDate,
}: {
  projectId: string;
  name: string;
  /** The project's description line (e.g. "ColaboFest 2026 · C-103"), the small label above the title. */
  label: string | null;
  finalist: boolean;
  memberNames: string[];
  memberCount: number;
  view: ProjectView | null;
  today: string;
  canMark: boolean;
  showManage: boolean;
  taskRows: TaskRow[];
  sharedFolderUrl: string | null;
  /** The newest announcements first (pinned first); the home shows three. */
  announcements: { id: string; body: string; created_at: string; author_name: string | null; pinned: boolean }[];
  announcementsNew: number;
  announcementsCount: number;
  announcementsNode: React.ReactNode;
  teamNode: React.ReactNode;
  manageNode: React.ReactNode;
  manageSection: ManageSection;
  hasProposal: boolean;
  nextDate: { label: string; shown: string } | null;
}) {
  const base = `/projects/${projectId}`;
  const done = taskRows.filter((r) => r.done).length;
  const banner = finalistBanner({ finalist, done, total: taskRows.length });

  const tiles: Tile[] = [];
  if (finalist) tiles.push({ key: "tasks", label: "Tasks", small: tasksTileLine(done, taskRows.length), icon: <IconChecklist /> });
  tiles.push({ key: "files", label: "Project files", small: sharedFolderUrl ? "Box" : "Soon", icon: <IconFolder /> });
  tiles.push({
    key: "announcements",
    label: "Announcements",
    small: plural(announcementsCount, "post"),
    badge: announcementsNew > 0 ? `${announcementsNew} new` : null,
    icon: <IconMegaphone />,
  });
  tiles.push({ key: "team", label: "Team", small: plural(memberCount, "member"), icon: <IconUsers /> });
  tiles.push({ key: "timeline", label: "Timeline", small: nextDate ? nextDate.shown : "Complete", icon: <IconClock /> });
  if (showManage) tiles.push({ key: "manage", label: "Manage", small: "SPARC team", icon: <IconSettings />, dashed: true });

  return (
    <div className="flex flex-col gap-5">
      {/* hero */}
      <header className="rounded-2xl bg-primary text-on-primary px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] leading-4 font-bold tracking-[0.1em] opacity-80 break-words">{(label || "ColaboFest 2026").toUpperCase()}</span>
          {finalist && (
            <span className="rounded-full bg-white px-2.5 py-0.5 text-[11.5px] font-bold leading-4 text-primary">★ Finalist</span>
          )}
        </div>
        <h1 className="mt-2 font-title text-[26px] sm:text-[32px] leading-[1.15] text-on-primary break-words">{name}</h1>
        <div className="mt-3.5 flex items-center gap-2.5 text-[13px]">
          <div className="flex -space-x-1.5" aria-hidden>
            {memberNames.slice(0, 5).map((n, i) => (
              <span
                key={i}
                className="grid place-items-center w-6 h-6 rounded-full bg-white text-primary border-2 border-primary text-[9px] font-bold"
              >
                {initials(n)}
              </span>
            ))}
          </div>
          {plural(memberCount, "member")}
        </div>
      </header>

      {/* finalists: the to-do banner */}
      {banner && (
        <section
          aria-label="Next step"
          className="rounded-2xl border border-[#e8e4da] border-l-4 border-l-primary bg-white px-[18px] py-3.5 flex flex-col sm:flex-row sm:items-center gap-3"
        >
          <p className="flex-1 min-w-0 font-label-lg text-[15px] leading-6 font-bold text-on-background">{banner.text}</p>
          {banner.kind === "todo" && (
            <Link
              href={`${base}?view=tasks`}
              className="btn-primary shrink-0 self-start sm:self-center whitespace-nowrap px-4 py-2.5 rounded-[10px] text-[13px] font-bold leading-5"
            >
              See tasks
            </Link>
          )}
        </section>
      )}

      {/* tiles */}
      <nav aria-label="Project sections" className="flex flex-wrap justify-center gap-2.5">
        {tiles.map((t) => {
          const on = view === t.key;
          return (
            <Link
              key={t.key}
              href={on ? base : `${base}?view=${t.key}`}
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={`${TILE} ${on ? "border-2 border-primary" : t.dashed ? "border border-dashed border-outline" : "border border-[#e8e4da]"}`}
            >
              {t.badge && (
                <span className="absolute top-2.5 right-2.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-[14px] text-on-primary">
                  {t.badge}
                </span>
              )}
              <span className="grid place-items-center shrink-0 w-[46px] h-[46px] rounded-[13px] bg-surface-container-low text-primary mb-[9px]" aria-hidden>
                {t.icon}
              </span>
              <span className="block text-[14px] leading-[18px] font-bold text-on-background">{t.label}</span>
              <span className="block mt-0.5 text-[11.5px] leading-4 text-secondary max-w-full truncate">{t.small}</span>
            </Link>
          );
        })}
      </nav>

      {/* home: the latest three announcements */}
      {!view && (
        <section className="rounded-2xl border border-[#e8e4da] bg-white px-[18px] py-4 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <h2 className="font-title text-[18px] leading-6 text-on-background">Latest announcements</h2>
            {announcements.length > 0 && (
              <Link href={`${base}?view=announcements`} className="font-label-md text-[12.5px] font-semibold text-primary hover:underline underline-offset-4">
                See all
              </Link>
            )}
          </div>
          {announcements.length === 0 ? (
            <p className="font-body-md text-body-md text-secondary">No announcements yet.</p>
          ) : (
            <ul>
              {announcements.slice(0, 3).map((a) => (
                <li key={a.id} className="flex gap-3 py-2.5 border-t border-[#e8e4da] first:border-t-0 first:pt-0">
                  <span className="grid place-items-center shrink-0 w-8 h-8 rounded-[9px] bg-surface-container-low text-primary" aria-hidden>
                    <IconMegaphone size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] leading-5 text-on-background whitespace-pre-wrap break-words line-clamp-3">
                      <LinkedText text={a.body} />
                    </p>
                    <small className="block text-[12px] leading-4 text-secondary">
                      {a.pinned ? "Pinned · " : ""}
                      {a.author_name ?? "SPARC team"} · {shortDate(a.created_at)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* a section */}
      {view && (
        <section className="flex flex-col gap-4 min-w-0">
          <div className="flex flex-col gap-2">
            <Link href={base} scroll={false} className="inline-flex items-center gap-1 self-start font-label-md text-label-md text-primary hover:underline underline-offset-4">
              <IconArrowLeft /> Project home
            </Link>
            <h2 className="font-title text-[22px] leading-8 text-on-background">{SECTION_TITLE[view]}</h2>
          </div>

          {view === "tasks" && <FinalistTasks projectId={projectId} rows={taskRows} canMark={canMark} />}

          {view === "files" && (
            <div className="rounded-2xl border border-[#e8e4da] bg-white p-5 flex flex-col gap-3 max-w-xl">
              <h3 className="font-title text-[20px] leading-7 text-on-background">Your project files</h3>
              <p className="font-body-md text-body-md text-secondary">Proposal, AI review, project info, budget and readiness checklist.</p>
              {sharedFolderUrl ? (
                <>
                  <div>
                    <a
                      href={sharedFolderUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary inline-flex items-center gap-1.5 px-5 py-3 rounded-[10px] text-[13px] font-bold leading-5"
                    >
                      Open in Box <IconExternal />
                    </a>
                  </div>
                  <p className="font-body-sm text-body-sm text-secondary">
                    Don&apos;t see the folder? Accept the Box invite email, or email{" "}
                    <a href={`mailto:${COLABOFEST_CONTACT_EMAIL}`} className="text-primary underline underline-offset-4">
                      {COLABOFEST_CONTACT_EMAIL}
                    </a>{" "}
                    to request access.
                  </p>
                </>
              ) : (
                <p className="font-body-md text-body-md text-on-background">Your files will appear here soon.</p>
              )}
            </div>
          )}

          {view === "announcements" && announcementsNode}

          {view === "team" && teamNode}

          {view === "timeline" && (
            <ol className="flex flex-col gap-2.5 max-w-xl" aria-label="Program dates">
              {COLABOFEST_STAGES.map((st, i) => {
                const cur = currentStageIndex(today);
                const on = i === cur;
                const past = i < cur;
                return (
                  <li
                    key={st.key}
                    aria-current={on ? "step" : undefined}
                    className={`flex items-center gap-3 rounded-2xl bg-white px-4 py-3 ${on ? "border-2 border-primary" : "border border-[#e8e4da]"}`}
                  >
                    <span className={`w-3 h-3 rounded-full shrink-0 ${on || past ? "bg-primary" : "bg-outline-variant"}`} aria-hidden />
                    <span className={`flex-1 min-w-0 text-[14px] leading-5 ${on ? "font-bold text-primary" : "text-on-background"}`}>{st.label}</span>
                    <span className="text-[13px] leading-5 text-secondary shrink-0">{st.shown}</span>
                  </li>
                );
              })}
              <li className="text-[12.5px] leading-5 text-secondary px-1">Finalist tasks are due {FINALIST_DUE.long}.</li>
            </ol>
          )}

          {view === "manage" && showManage && (
            <div className="flex flex-col gap-4">
              <nav aria-label="Manage sections" className="flex gap-1.5 overflow-x-auto -mx-0.5 px-0.5">
                {MANAGE_SECTIONS.filter((s) => s !== "proposal" || hasProposal).map((s) => {
                  const on = s === manageSection;
                  return (
                    <Link
                      key={s}
                      href={`${base}?view=manage&section=${s}`}
                      scroll={false}
                      aria-current={on ? "page" : undefined}
                      className={
                        "whitespace-nowrap rounded-full border px-3 py-2 text-[12.5px] font-semibold leading-4 " +
                        (on ? "bg-[#1d1d1b] border-[#1d1d1b] text-white" : "bg-white border-[#e8e4da] text-secondary hover:text-on-background")
                      }
                    >
                      {MANAGE_LABEL[s]}
                    </Link>
                  );
                })}
              </nav>
              {manageNode}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
