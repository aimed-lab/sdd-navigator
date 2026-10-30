// ColaboFest 2026 projects — /programs/colabofest-2026.
//
// For anyone who is a lead or manager on at least one ColaboFest project (the
// program manager across the winner projects, and each team's leads). Lists the
// ColaboFest projects the viewer is a member of, one card each: team size, a
// status pill, checklist progress per list, how many items are overdue, the last
// update, and links to the project's Overview and Updates. All reads use the
// viewer's own session, so row-level security decides which projects come back.
// Anyone else gets a 404.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PageHeader, { PageShell } from "@/components/PageHeader";
import { getCurrentUser } from "@/lib/auth";
import { getColabofestProgram } from "@/lib/server/projectWorkspace/program";
import { PILL_LABEL, type StatusPill } from "@/lib/server/projectWorkspace/status";
import { tabHref } from "@/lib/server/projectWorkspace/workspace";
import { formatDay } from "@/lib/server/pages/pageViewHelpers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ColaboFest 2026 projects | SmartDrugDiscovery", robots: { index: false } };

const PILL_CLASS: Record<StatusPill, string> = {
  on_track: "bg-surface-container-low text-primary",
  needs_help: "bg-error/10 text-error",
  quiet: "bg-amber-100 text-amber-800",
};

export default async function ColabofestProgramPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=%2Fprograms%2Fcolabofest-2026");

  const result = await getColabofestProgram();
  if (result.status === "no_access") notFound();
  if (result.status === "error") {
    return (
      <PageShell>
        <p className="font-body-md text-body-md text-error" role="alert">
          {result.error}
        </p>
      </PageShell>
    );
  }

  const needsHelp = result.cards.filter((c) => c.pill === "needs_help").length;

  return (
    <PageShell>
      <Link
        href="/projects"
        className="inline-flex items-center gap-1 mb-6 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Your projects
      </Link>
      <PageHeader
        title="ColaboFest 2026 projects"
        subtitle="How each winner project is doing: checklists, overdue items and the latest updates, in one place."
        statsLine={
          result.cards.length > 0
            ? `${result.cards.length} ${result.cards.length === 1 ? "project" : "projects"}${needsHelp > 0 ? ` · ${needsHelp} asking for help` : ""}`
            : undefined
        }
      />

      {result.cards.length === 0 ? (
        <div className="tile p-8 max-w-xl" style={{ background: "var(--type-other-bg)" }}>
          <p className="font-body-md text-body-md text-secondary">
            No ColaboFest projects yet. When a team is added as a ColaboFest 2026 project and you are on it, it shows up here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {result.cards.map((c) => {
            const last = formatDay(c.lastUpdate);
            return (
              <article key={c.id} className="rounded-2xl bg-white shadow-[0_1px_2px_rgba(40,36,28,0.05)] p-6 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-title text-[22px] leading-tight font-medium text-on-background break-words min-w-0">{c.name}</h2>
                  <span className={`shrink-0 px-3 py-1 rounded-full font-label-sm text-label-sm ${PILL_CLASS[c.pill]}`}>
                    {PILL_LABEL[c.pill]}
                  </span>
                </div>
                <p className="font-body-sm text-body-sm text-secondary">
                  {c.teamSize} {c.teamSize === 1 ? "member" : "members"}
                </p>

                <ul className="flex flex-col gap-2">
                  {c.progress.map((p) => (
                    <li key={p.list} className="flex items-center justify-between gap-3 font-body-md text-body-md">
                      <span className="text-on-background">{p.label}</span>
                      <span className="text-secondary shrink-0">{p.total === 0 ? "No items" : `${p.ready} of ${p.total} ready`}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-body-sm text-body-sm">
                  <span className={c.overdue > 0 ? "text-error font-medium" : "text-secondary"}>
                    {c.overdue === 0 ? "Nothing overdue" : `${c.overdue} overdue`}
                  </span>
                  <span className="text-secondary">{last ? `Last update ${last}` : "No updates yet"}</span>
                </div>

                <div className="mt-auto pt-2 flex items-center gap-4">
                  <Link href={tabHref(c.id, "overview")} className="btn-outline px-4 py-2 rounded-lg font-label-md text-label-md">
                    Overview
                  </Link>
                  <Link href={tabHref(c.id, "announcements")} className="font-label-md text-label-md text-primary hover:underline underline-offset-4">
                    Updates
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
