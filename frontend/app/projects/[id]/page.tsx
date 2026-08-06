// Project detail — /projects/[id]. Step 2b, part 2: adds Resources.
// Project-scoped Explore itself (a dedicated saved-resources listing page)
// is still out of scope — see components/projects/ResourcesSection.tsx for
// what "clickable" tiles actually route to instead.
// Order follows STRUCTURE.md: Header & status → Team → Resources →
// Checklist → Shared Folder → Proposal → Promote.
//
// SERVER component: redirects to /login when signed out (matches /projects
// and /inbox), then reads through lib/server/projects.ts, whose
// GetProjectResult collapses "doesn't exist" and "exists but you're not a
// member" into one `not_found` — see that type's own comment for why. Either
// way this page 404s, exactly like a mistyped id would, rather than leaking
// which case it was.

import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getProject, getProposalFileUrl } from "@/lib/server/projects";
import { listProjectResources } from "@/lib/server/projectResources";
import {
  MODALITY_LABEL,
  PROJECT_STAGE_LABEL,
  buildProjectExploreHref,
  type Modality,
  type ProjectStage,
} from "@/lib/projectTypes";
import TeamSection from "@/components/projects/TeamSection";
import ProposalSection from "@/components/projects/ProposalSection";
import ChecklistSection from "@/components/projects/ChecklistSection";
import SharedFolderSection from "@/components/projects/SharedFolderSection";
import ResourcesSection from "@/components/projects/ResourcesSection";
import DeleteProjectButton from "@/components/projects/DeleteProjectButton";

export const dynamic = "force-dynamic"; // depends on the session

function chip(label: string) {
  return (
    <span
      key={label}
      className="px-3 py-1 rounded-full bg-primary/5 text-primary font-label-sm text-label-sm"
    >
      {label}
    </span>
  );
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?callbackUrl=%2Fprojects`);

  const { id } = await params;
  const result = await getProject(id);

  if (result.status === "not_found") notFound();
  if (result.status === "error") {
    return (
      <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-16">
        <p className="font-body-md text-body-md text-error" role="alert">
          {result.error}
        </p>
      </div>
    );
  }

  const project = result.project;

  const chips = [
    project.target,
    project.indication,
    project.modality ? MODALITY_LABEL[project.modality as Modality] ?? project.modality : null,
    project.stage ? PROJECT_STAGE_LABEL[project.stage as ProjectStage] ?? project.stage : null,
  ].filter((v): v is string => !!v);

  const deadlinePassed = !!project.deadline && new Date(project.deadline).getTime() < Date.now();

  // Resolved here (server-side) because the bucket is private — a client
  // component can't mint its own signed URL. Regenerated on every render,
  // which is fine: this page is already force-dynamic.
  let fileUrl: string | null = null;
  if (project.proposal?.file_path) {
    const signed = await getProposalFileUrl(project.id, project.proposal.file_path);
    fileUrl = signed.status === "ok" ? signed.url : null;
  }

  const resourcesResult = await listProjectResources(project.id);
  const resources =
    resourcesResult.status === "ok"
      ? resourcesResult.resources
      : { total: 0, tiles: [], recent: [], items: [] };
  const exploreHref = buildProjectExploreHref(project);

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16">
      {/* Header & status */}
      <section className="mb-16">
        <div className="flex items-start justify-between gap-8 mb-6">
          <div>
            <h1 className="font-display-lg text-display-lg text-on-background mb-4">
              {project.name}
            </h1>
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-4">{chips.map(chip)}</div>
            )}
            {project.description && (
              <p className="font-body-lg text-body-lg text-secondary max-w-3xl">
                {project.description}
              </p>
            )}
          </div>
          {project.is_creator && (
            <DeleteProjectButton
              projectId={project.id}
              projectName={project.name}
              memberCount={project.members.length}
              proposalSubmitted={!!project.proposal?.submitted_at}
            />
          )}
        </div>

        {/* Status strip — members always; checklist progress and resource
            count join ONLY when there's something to report, per
            STRUCTURE.md: a new project must never read "0 of 0" or
            "0 resources saved". */}
        <div className="inline-flex items-center gap-6 font-label-md text-label-md text-secondary bg-surface-container-low/50 px-6 py-3 rounded-lg border border-outline-variant/30">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">group</span>
            {project.members.length} {project.members.length === 1 ? "member" : "members"}
          </div>
          {resources.total > 0 && (
            <>
              <div className="w-px h-4 bg-outline-variant/50" />
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">bookmark</span>
                {resources.total} {resources.total === 1 ? "resource" : "resources"} saved
              </div>
            </>
          )}
          {project.checklist.length > 0 && (
            <>
              <div className="w-px h-4 bg-outline-variant/50" />
              <div className="flex items-center gap-2 text-primary">
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                {project.checklist.filter((c) => c.status === "ready").length} of{" "}
                {project.checklist.length} ready
              </div>
            </>
          )}
        </div>
      </section>

      <hr className="border-t border-outline-variant/30 w-full mb-16" />

      <TeamSection
        projectId={project.id}
        members={project.members}
        isLead={project.is_lead}
        viewerUserId={user.id}
      />

      <hr className="border-t border-outline-variant/30 w-full mb-16" />

      <ResourcesSection projectId={project.id} exploreHref={exploreHref} resources={resources} />

      <hr className="border-t border-outline-variant/30 w-full mb-16" />

      <ChecklistSection
        projectId={project.id}
        projectName={project.name}
        projectDescription={project.description}
        items={project.checklist}
      />

      <hr className="border-t border-outline-variant/30 w-full mb-16" />

      <SharedFolderSection projectId={project.id} sharedFolder={project.shared_folder} />

      {/* Only exists at all for a ColaboFest project — not merely empty or
          disabled for an ordinary one. */}
      {project.challenge_key && (
        <>
          <hr className="border-t border-outline-variant/30 w-full mb-16" />
          <ProposalSection
            projectId={project.id}
            proposal={project.proposal}
            // Submission is ANY LEAD now, not creator-only — see
            // lib/server/projects.ts:submitProposal(). Passing is_lead
            // (not is_creator) keeps this button's visibility consistent
            // with what the server action actually allows.
            isLead={project.is_lead}
            deadlinePassed={deadlinePassed}
            fileUrl={fileUrl}
          />
        </>
      )}
    </div>
  );
}
