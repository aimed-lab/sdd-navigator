// Projects list — /projects.
//
// Layout follows frontend/design/projects/STRUCTURE.md, screen 1: ColaboFest
// banner, then "Your projects" header + grid, then the empty state. Nav/
// Footer come from the root layout — the Stitch file's own header/footer
// (with invented "Ethics Policy"/"Methodology"/etc. links) are discarded, per
// that same doc's fix #1.
//
// SERVER component, and a REDIRECT rather than a gate panel for a signed-out
// visitor, matching app/inbox/page.tsx: there is no public project browsing
// (unlike Collaborate), so a stranger has nothing to see here at all.
//
// Two enforcement layers, deliberately unequal in importance, same note as
// inbox: the redirect below is a courtesy so nobody lands on a blank page;
// listMyProjects() (via is_project_member() RLS) is the actual guarantee.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listMyProjects } from "@/lib/server/projects";
import ColabofestBanner from "@/components/projects/ColabofestBanner";
import ProjectCard from "@/components/projects/ProjectCard";

export const dynamic = "force-dynamic"; // depends on the session

export const metadata = { title: "Your projects · SmartDrugDiscovery" };

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=%2Fprojects");

  const result = await listMyProjects();

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-20 flex flex-col gap-12">
      <ColabofestBanner />

      <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 border-b border-outline-variant/30 pb-6">
        <h1 className="font-display-lg text-[40px] leading-tight text-on-background">
          Your projects
        </h1>
        <Link
          href="/projects/new"
          className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          New project
        </Link>
      </section>

      {result.status === "error" && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {result.error}
        </p>
      )}

      {result.status === "ok" && result.projects.length > 0 && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
          {result.projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </section>
      )}

      {result.status === "ok" && result.projects.length === 0 && (
        <section className="glass-card rounded-xl p-16 flex flex-col items-center justify-center text-center max-w-3xl mx-auto">
          <div className="w-24 h-24 bg-surface-container-low rounded-full flex items-center justify-center mb-6 shadow-sm border border-outline-variant/30">
            <span
              className="material-symbols-outlined text-primary text-[48px]"
              style={{ fontVariationSettings: "'wght' 200" }}
            >
              biotech
            </span>
          </div>
          <h3 className="font-headline-md text-headline-md text-on-background mb-4">
            No projects yet
          </h3>
          <p className="font-body-lg text-body-lg text-secondary max-w-lg mb-8">
            Start a new pharmaceutical research program to track progress, manage
            molecular data, and collaborate with your team in a centralized
            workspace.
          </p>
          <Link
            href="/projects/new"
            className="btn-primary px-8 py-4 rounded-lg font-label-md text-label-md flex items-center gap-2 shadow-sm"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            Create your first project
          </Link>
        </section>
      )}
    </div>
  );
}
