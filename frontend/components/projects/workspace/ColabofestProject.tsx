// A ColaboFest project (projects.program = 'colabofest_2026'), laid out like the CFDE
// conference app: one centered column (about 720px) with a quiet top row ("Welcome, <name>"
// and "← My projects"), the green hero (label, ★ Finalist, title, avatars), a thin row
// "⌂ Project home" with the next key date, and then either the HOME (a green call-to-action
// banner for finalists, six icon tiles, a Progress card, the latest announcements) or ONE
// VIEW (Tasks, Files, Announcements, Team, Timeline, Manage) with its title and content.
// A footer card is on every screen. Server-safe.

import Link from "next/link";
import {
  IconArrowLeft,
  IconChecklist,
  IconClock,
  IconExternal,
  IconFolder,
  IconMegaphone,
  IconSettings,
  IconUsers,
} from "@/components/communities/CommunityIcons";
import { COLABOFEST_CONTACT_EMAIL, COLABOFEST_STAGES, FINALIST_DUE } from "@/lib/colabofestConfig";
import { initials, shortDate } from "@/lib/server/communityHome/communityHome";
import { ctaBanner, timelineState } from "@/lib/server/projectWorkspace/cfTasks";
import type { ProjectView } from "@/lib/server/projectWorkspace/finalistTasks";
import LinkedText from "./LinkedText";

const SECTION_TITLE: Record<ProjectView, string> = {
  tasks: "Tasks",
  files: "Project files",
  announcements: "Announcements",
  team: "Team",
  timeline: "Timeline",
  manage: "Manage",
};

const TILE =
  "relative text-center min-w-0 flex flex-col items-center basis-[calc((100%-20px)/3)] grow-0 shrink-0 rounded-2xl bg-white px-1.5 pt-4 pb-3.5 " +
  "transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

type Tile = { key: ProjectView; label: string; badge?: string | null; icon: React.ReactNode; dashed?: boolean };

export default function ColabofestProject({
  projectId,
  name,
  label,
  finalist,
  firstName,
  memberNames,
  memberCount,
  view,
  today,
  role,
  showManage,
  hasTasks,
  finalistDone,
  finalistTotal,
  progress,
  sharedFolderUrl,
  announcements,
  announcementsNew,
  tasksNode,
  announcementsNode,
  teamNode,
  manageNode,
  nextDate,
}: {
  projectId: string;
  name: string;
  /** The project's description line (e.g. "ColaboFest 2026 · C-103"), above the title. */
  label: string | null;
  finalist: boolean;
  firstName: string;
  memberNames: string[];
  memberCount: number;
  view: ProjectView | null;
  today: string;
  role: string;
  showManage: boolean;
  /** Whether the Tasks tile and view exist for this project. */
  hasTasks: boolean;
  finalistDone: number;
  finalistTotal: number;
  progress: { done: number; total: number; percent: number };
  sharedFolderUrl: string | null;
  /** The newest announcements first (pinned first); the home shows three. */
  announcements: { id: string; body: string; created_at: string; author_name: string | null; pinned: boolean }[];
  announcementsNew: number;
  tasksNode: React.ReactNode;
  announcementsNode: React.ReactNode;
  teamNode: React.ReactNode;
  manageNode: React.ReactNode;
  nextDate: { label: string; shown: string } | null;
}) {
  const base = `/projects/${projectId}`;
  const cta = ctaBanner({ finalist, finalistDone, finalistTotal });

  const tiles: Tile[] = [];
  if (hasTasks) {
    const pending = finalist ? finalistTotal - finalistDone : 0;
    tiles.push({ key: "tasks", label: "Tasks", badge: pending > 0 ? String(pending) : null, icon: <IconChecklist /> });
  }
  tiles.push({ key: "files", label: "Files", icon: <IconFolder /> });
  tiles.push({ key: "announcements", label: "Announcements", badge: announcementsNew > 0 ? `${announcementsNew} new` : null, icon: <IconMegaphone /> });
  tiles.push({ key: "team", label: "Team", icon: <IconUsers /> });
  tiles.push({ key: "timeline", label: "Timeline", icon: <IconClock /> });
  if (showManage) tiles.push({ key: "manage", label: "Manage", icon: <IconSettings />, dashed: true });

  const compact = !!view;

  return (
    <div className="mx-auto w-full max-w-[720px] flex flex-col gap-4">
      {/* quiet top row */}
      <div className="flex items-center justify-between gap-3 text-[12.5px] leading-5 text-secondary">
        <span className="truncate">Welcome, {firstName}</span>
        <Link href="/projects" className="inline-flex items-center gap-1 shrink-0 hover:text-primary transition-colors">
          <IconArrowLeft size={14} /> My projects
        </Link>
      </div>

      {/* hero */}
      <header className={`rounded-[20px] bg-primary text-on-primary ${compact ? "px-5 py-4" : "px-5 py-5 sm:px-7 sm:py-6"}`}>
        {!compact && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] leading-4 font-bold tracking-[0.1em] opacity-80 break-words">{(label || "ColaboFest 2026").toUpperCase()}</span>
            {finalist && <span className="rounded-full bg-white px-2.5 py-0.5 text-[11.5px] font-bold leading-4 text-primary">★ Finalist</span>}
          </div>
        )}
        <h1 className={`font-title text-on-primary break-words ${compact ? "text-[20px] leading-6" : "mt-2 text-[26px] sm:text-[32px] leading-[1.15]"}`}>{name}</h1>
        {!compact && (
          <div className="mt-3.5 flex items-center gap-2.5 text-[13px]">
            <div className="flex -space-x-1.5" aria-hidden>
              {memberNames.slice(0, 5).map((n, i) => (
                <span key={i} className="grid place-items-center w-6 h-6 rounded-full bg-white text-primary border-2 border-primary text-[9px] font-bold">
                  {initials(n)}
                </span>
              ))}
            </div>
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </div>
        )}
      </header>

      {/* ⌂ Project home · next key date */}
      <div className="flex items-center justify-between gap-3 border-b border-[#e8e4da] pb-2.5 text-[13px] leading-5">
        <Link href={base} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline underline-offset-4">
          <span aria-hidden>⌂</span> Project home
        </Link>
        {nextDate && (
          <span className="text-secondary truncate">
            {nextDate.shown} · {nextDate.label}
          </span>
        )}
      </div>

      {/* HOME */}
      {!view && (
        <>
          {cta && (
            <Link
              href={`${base}?view=tasks`}
             
              className="rounded-[18px] bg-primary text-on-primary px-4 py-3.5 flex items-center gap-3.5 hover:bg-[#033319] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <span className="grid place-items-center shrink-0 w-11 h-11 rounded-xl bg-white/15" aria-hidden>
                <IconChecklist size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-5 font-bold">{cta.title}</span>
                <span className="block text-[12.5px] leading-5 opacity-85">{cta.sub}</span>
              </span>
              <span className="text-[20px] leading-none shrink-0" aria-hidden>
                →
              </span>
            </Link>
          )}

          <nav aria-label="Project sections" className="flex flex-wrap justify-center gap-2.5">
            {tiles.map((t) => (
              <Link
                key={t.key}
                href={`${base}?view=${t.key}`}
               
                className={`${TILE} ${t.dashed ? "border border-dashed border-outline" : "border border-[#e8e4da]"}`}
              >
                {t.badge && (
                  <span className="absolute top-2.5 right-2.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-[14px] text-on-primary">{t.badge}</span>
                )}
                <span className="grid place-items-center shrink-0 w-[46px] h-[46px] rounded-[13px] bg-surface-container-low text-primary mb-2" aria-hidden>
                  {t.icon}
                </span>
                <span className="block text-[13.5px] leading-[18px] font-bold text-on-background">{t.label}</span>
              </Link>
            ))}
          </nav>

          {progress.total > 0 && (
            <section className="rounded-2xl border border-[#e8e4da] bg-white px-[18px] py-4" aria-label="Progress">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-title text-[18px] leading-6 text-on-background">Progress</h2>
                <span className="text-[12.5px] leading-5 text-secondary">
                  {progress.done} of {progress.total} tasks done
                </span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-surface-container overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                <div className="h-full bg-primary" style={{ width: `${progress.percent}%` }} />
              </div>
            </section>
          )}

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
        </>
      )}

      {/* ONE VIEW */}
      {view && (
        <section id="cf-section" className="flex flex-col gap-4 min-w-0 scroll-mt-4">
          <h2 className="font-title text-[24px] leading-8 text-on-background">{SECTION_TITLE[view]}</h2>

          {view === "tasks" && tasksNode}

          {view === "files" && (
            <div className="rounded-2xl border border-[#e8e4da] bg-white p-5 flex flex-col gap-3">
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
            <ol className="flex flex-col gap-2.5" aria-label="Program dates">
              {COLABOFEST_STAGES.map((st, i) => {
                const state = timelineState(COLABOFEST_STAGES, today)[i];
                return (
                  <li
                    key={st.key}
                    aria-current={state === "next" ? "step" : undefined}
                    className={`flex items-center gap-3 rounded-2xl bg-white px-4 py-3 ${state === "next" ? "border-2 border-primary" : "border border-[#e8e4da]"} ${state === "past" ? "opacity-55" : ""}`}
                  >
                    <span className={`w-3 h-3 rounded-full shrink-0 ${state === "next" ? "bg-primary ring-4 ring-surface-container" : state === "past" ? "bg-secondary" : "bg-outline-variant"}`} aria-hidden />
                    <span className={`flex-1 min-w-0 text-[14px] leading-5 ${state === "next" ? "font-bold text-primary" : "text-on-background"}`}>{st.label}</span>
                    <span className="text-[13px] leading-5 text-secondary shrink-0">{st.shown}</span>
                  </li>
                );
              })}
              <li className="text-[12.5px] leading-5 text-secondary px-1">Finalist tasks are due {FINALIST_DUE.long}.</li>
            </ol>
          )}

          {view === "manage" && showManage && manageNode}
        </section>
      )}

      {/* footer card */}
      <footer className="rounded-2xl border border-[#e8e4da] bg-white px-[18px] py-4 grid grid-cols-2 gap-4 text-[13px] leading-5">
        <div>
          <h2 className="font-title text-[15px] leading-6 text-on-background mb-1">Contact us</h2>
          <a href={`mailto:${COLABOFEST_CONTACT_EMAIL}`} className="text-primary underline underline-offset-4 break-all">
            {COLABOFEST_CONTACT_EMAIL}
          </a>
        </div>
        <div>
          <h2 className="font-title text-[15px] leading-6 text-on-background mb-1">Quick links</h2>
          <ul className="flex flex-col gap-0.5">
            <li>
              <Link href={base} className="text-primary hover:underline underline-offset-4">
                Project home
              </Link>
            </li>
            <li>
              <Link href="/projects" className="text-primary hover:underline underline-offset-4">
                My projects
              </Link>
            </li>
            <li>
              <Link href={`${base}?view=timeline`} className="text-primary hover:underline underline-offset-4">
                ColaboFest timeline
              </Link>
            </li>
          </ul>
        </div>
      </footer>

    </div>
  );
}
