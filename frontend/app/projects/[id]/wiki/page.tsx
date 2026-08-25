// /projects/[id]/wiki — stage 2 of the project wiki: the graph view over
// what stage 1 built (wiki_notes) and this stage added (project_evidence_items,
// wiki_note_evidence). See database/migrations/2026-08-24_wiki_evidence.sql.
//
// SERVER component, same shape as the parent /projects/[id] page: redirects
// signed-out callers to /login, then calls getProject(id) FIRST — not
// getProjectWikiGraph(id) alone — specifically so a non-member gets the
// exact same 404 the parent page already gives, rather than a distinct
// "empty wiki" page a non-member could use to fingerprint whether a project
// id exists. getProjectWikiGraph's own not_found can't tell "not a member"
// apart from "a member whose project has zero notes yet" (RLS returns zero
// rows for both), which is exactly why membership is confirmed here first.

import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getProject } from "@/lib/server/projects";
import { getProjectWikiGraph } from "@/lib/server/wikiEvidence";
import { listProjectResources } from "@/lib/server/projectResources";
import WikiGraph from "@/components/projects/WikiGraph";

export const dynamic = "force-dynamic";

export default async function ProjectWikiPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?callbackUrl=%2Fprojects`);

  const { id } = await params;
  const projectResult = await getProject(id);
  if (projectResult.status === "not_found") notFound();
  if (projectResult.status === "error") {
    return (
      <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-16">
        <p className="font-body-md text-body-md text-error" role="alert">
          {projectResult.error}
        </p>
      </div>
    );
  }
  const project = projectResult.project;

  const graphResult = await getProjectWikiGraph(id);
  if (graphResult.status !== "ok") {
    return (
      <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-16">
        <p className="font-body-md text-body-md text-error" role="alert">
          {graphResult.status === "error" ? graphResult.error : "Nothing's been found for this project yet."}
        </p>
      </div>
    );
  }

  // Best-effort, same stance as everywhere else this pattern shows up: a
  // failure here degrades to "nothing looks saved yet," never blocks the
  // page — this only feeds the save button's already-saved state below.
  const resourcesResult = await listProjectResources(id);
  const savedItemIds =
    resourcesResult.status === "ok" ? resourcesResult.resources.items.map((i) => i.id) : [];

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16">
      <div className="mb-8">
        <a
          href={`/projects/${project.id}`}
          className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          {project.name}
        </a>
        <h1 className="font-display-lg text-display-lg text-on-background mt-2 mb-2">What we found</h1>
        <p className="font-body-md text-body-md text-secondary max-w-2xl">
          These are the pieces the agent found this project depends on — concepts and entities
          it has evidence for, and open questions it couldn&apos;t yet answer — plus every item
          its runs have retrieved.
          {graphResult.totalItems > 0 && (() => {
            const notFiled = graphResult.unfiled.length + graphResult.projectLevel.length;
            const pct = Math.round((100 * notFiled) / graphResult.totalItems);
            return notFiled > 0
              ? ` ${pct}% of what it found (${notFiled} of ${graphResult.totalItems}) isn't filed under any note yet.`
              : null;
          })()}
        </p>
      </div>

      {graphResult.notes.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center">
          <p className="font-body-md text-body-md text-secondary">
            Nothing found yet — run the project agent from the project page to start filling this in.
          </p>
        </div>
      ) : (
        <WikiGraph
          projectId={project.id}
          notes={graphResult.notes}
          unfiled={graphResult.unfiled}
          projectLevel={graphResult.projectLevel}
          ghostLinks={graphResult.ghostLinks}
          missingNoteSuggestions={graphResult.missingNoteSuggestions}
          savedItemIds={savedItemIds}
        />
      )}
    </div>
  );
}
