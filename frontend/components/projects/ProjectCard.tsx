// One project card on /projects. Pill treatment follows
// components/collaborate/PostCard.tsx (filled pill backgrounds, not the
// bare-text-plus-dot variant the ColaboFest Stitch screen used for its
// header chips — see the AGREE/DIVERGE note in STRUCTURE.md: we standardize
// on the pill).
//
// Server component — no interactivity here, the whole card is a Link.

import Link from "next/link";
import type { MyProjectSummary } from "@/lib/projectTypes";

const ABSOLUTE_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export default function ProjectCard({ project }: { project: MyProjectSummary }) {
  const isColabofest = !!project.challenge_key;
  const days = project.deadline ? daysUntil(project.deadline) : null;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="glass-card group flex flex-col gap-6 rounded-xl p-8 cursor-pointer"
    >
      <div className="flex justify-between items-start gap-4">
        <h2 className="font-headline-md text-headline-md text-on-background group-hover:text-primary transition-colors line-clamp-2">
          {project.name}
        </h2>
        <span className="shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-surface-container-low text-secondary font-label-sm text-label-sm whitespace-nowrap">
          <span className="material-symbols-outlined text-[14px]">group</span>
          {project.member_count} {project.member_count === 1 ? "member" : "members"}
        </span>
      </div>

      {project.description && (
        <p className="font-body-md text-body-md text-secondary line-clamp-2 -mt-2">
          {project.description}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-auto pt-4 border-t border-outline-variant/30">
        {isColabofest && (
          <span className="px-3 py-1 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm">
            ColaboFest
          </span>
        )}

        {/* Submission status only means something for a project with a
            proposal to submit — an ordinary project never shows this pill. */}
        {isColabofest && (
          <span
            className={
              "inline-flex items-center gap-1 px-3 py-1 rounded-full font-label-sm text-label-sm " +
              (project.proposal_submitted
                ? "bg-primary-container/20 text-on-primary-container"
                : "bg-surface-dim text-secondary")
            }
          >
            <span className="material-symbols-outlined text-[14px]">
              {project.proposal_submitted ? "check_circle" : "pending"}
            </span>
            {project.proposal_submitted ? "Proposal submitted" : "Not submitted"}
          </span>
        )}

        {days !== null && (
          <span className="ml-auto font-body-sm text-body-sm text-secondary flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px]">schedule</span>
            {days >= 0
              ? `Due in ${days} ${days === 1 ? "day" : "days"}`
              : `Deadline was ${ABSOLUTE_DATE.format(new Date(project.deadline as string))}`}
          </span>
        )}
      </div>
    </Link>
  );
}
