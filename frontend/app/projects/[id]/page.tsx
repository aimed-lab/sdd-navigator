// Project detail — /projects/[id]. Step 2a: Team and Proposal sections only
// — Checklist, Resources and Shared Folder are step 2b, not built here (see
// frontend/design/projects/STRUCTURE.md).
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
import { MODALITY_LABEL, PROJECT_STAGE_LABEL, type Modality, type ProjectStage } from "@/lib/projectTypes";
import TeamSection from "@/components/projects/TeamSection";
import ProposalSection from "@/components/projects/ProposalSection";
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
          {project.is_lead && (
            <DeleteProjectButton
              projectId={project.id}
              projectName={project.name}
              memberCount={project.members.length}
              proposalSubmitted={!!project.proposal?.submitted_at}
            />
          )}
        </div>

        {/* Status strip — members only for now (step 2a). Resources and
            checklist progress join this once those sections exist (step
            2b); until then this never reads "0 of 0" because there's
            nothing to hide a zero behind yet. */}
        <div className="inline-flex items-center gap-6 font-label-md text-label-md text-secondary bg-surface-container-low/50 px-6 py-3 rounded-lg border border-outline-variant/30">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">group</span>
            {project.members.length} {project.members.length === 1 ? "member" : "members"}
          </div>
        </div>
      </section>

      <hr className="border-t border-outline-variant/30 w-full mb-16" />

      <TeamSection projectId={project.id} members={project.members} isLead={project.is_lead} />

      {/* Only exists at all for a ColaboFest project — not merely empty or
          disabled for an ordinary one. */}
      {project.challenge_key && (
        <>
          <hr className="border-t border-outline-variant/30 w-full mb-16" />
          <ProposalSection
            projectId={project.id}
            proposal={project.proposal}
            isLead={project.is_lead}
            deadlinePassed={deadlinePassed}
            fileUrl={fileUrl}
          />
        </>
      )}
    </div>
  );
}
