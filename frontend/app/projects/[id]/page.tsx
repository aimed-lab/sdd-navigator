// Project workspace — /projects/[id].
//
// A left sidebar (project name, label, team size, then the sections) and the
// selected section on the right; on a phone the sidebar is a tab bar across the
// top. The section is the URL's ?tab= (overview, wiki, tasks, files, team,
// proposal), so links and the back button work. The existing sections are the
// same components as before, moved into tabs:
//   Overview  progress, next items and team on the right, wiki pages on the left
//   Wiki      this project's wiki pages (public.pages), "Earlier notes" (the
//             August project wiki, read only), the project agent, saved resources
//   Tasks     ChecklistSection and WhoCanHelpSection
//   Files     SharedFolderSection
//   Team      TeamSection
//   Proposal  ProposalSection (challenge projects only)
//
// SERVER component: redirects to /login when signed out (matches /projects
// and /inbox), then reads through lib/server/projects.ts, whose
// GetProjectResult collapses "doesn't exist" and "exists but you're not a
// member" into one `not_found`. Either way this page 404s, exactly like a
// mistyped id would, rather than leaking which case it was. Only the data the
// selected tab needs is read.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getProject, getProposalFileUrl } from "@/lib/server/projects";
import { getCommunityById } from "@/lib/server/communities";
import { listProjectResources } from "@/lib/server/projectResources";
import { listProjectPages } from "@/lib/server/pages/projectPages";
import { listWikiNoteSummaries } from "@/lib/server/wikiNotes";
import { parseTab, TAB_LABEL } from "@/lib/server/projectWorkspace/workspace";
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
import WhoCanHelpSection from "@/components/projects/WhoCanHelpSection";
import SharedFolderSection from "@/components/projects/SharedFolderSection";
import ResourcesSection from "@/components/projects/ResourcesSection";
import AgentSection from "@/components/projects/AgentSection";
import ProjectChatbot from "@/components/projects/ProjectChatbot";
import DeleteProjectButton from "@/components/projects/DeleteProjectButton";
import ProjectSidebar from "@/components/projects/workspace/ProjectSidebar";
import OverviewTab from "@/components/projects/workspace/OverviewTab";
import WikiList from "@/components/projects/workspace/WikiList";
import EarlierNotes from "@/components/projects/workspace/EarlierNotes";
import NewProjectWikiPage from "@/components/projects/workspace/NewProjectWikiPage";

export const dynamic = "force-dynamic"; // depends on the session
// "New wiki page" researches the topic before it returns (about a minute).
export const maxDuration = 300;

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?callbackUrl=%2Fprojects`);

  const { id } = await params;
  const sp = await searchParams;
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
  const tab = parseTab(sp.tab, !!project.challenge_key);

  const chips = [
    project.target,
    project.indication,
    project.modality ? MODALITY_LABEL[project.modality as Modality] ?? project.modality : null,
    project.stage ? PROJECT_STAGE_LABEL[project.stage as ProjectStage] ?? project.stage : null,
  ].filter((v): v is string => !!v);

  const exploreHref = buildProjectExploreHref(project);

  // Way back to the project's community — null for a personal project, and
  // also for a community_id that no longer resolves.
  const community = project.community_id ? await getCommunityById(project.community_id) : null;

  // The wiki pages are needed by Overview and Wiki.
  const pagesResult = tab === "overview" || tab === "wiki" ? await listProjectPages(project.id) : null;
  const pages = pagesResult?.status === "ok" ? pagesResult.pages : [];

  let content: React.ReactNode = null;

  if (tab === "overview") {
    content = (
      <>
        {pagesResult?.status === "error" && (
          <p className="mb-4 font-body-sm text-body-sm text-error" role="alert">
            {pagesResult.error}
          </p>
        )}
        <OverviewTab
          projectId={project.id}
          description={project.description}
          chips={chips}
          checklist={project.checklist}
          members={project.members}
          pages={pages}
        />
      </>
    );
  } else if (tab === "wiki") {
    const [resourcesResult, earlier] = await Promise.all([listProjectResources(project.id), listWikiNoteSummaries(project.id)]);
    const resources =
      resourcesResult.status === "ok" ? resourcesResult.resources : { total: 0, tiles: [], recent: [], items: [] };
    content = (
      <div className="flex flex-col gap-12">
        <section className="flex flex-col gap-4">
          <p className="font-body-md text-body-md text-secondary max-w-2xl">
            Wiki pages for your team. Each one collects the latest papers and trials on a topic and keeps itself up to
            date.
          </p>
          <div>
            <NewProjectWikiPage projectId={project.id} />
          </div>
          {pagesResult?.status === "error" && (
            <p className="font-body-sm text-body-sm text-error" role="alert">
              {pagesResult.error}
            </p>
          )}
          {pages.length > 0 ? (
            <WikiList projectId={project.id} pages={pages} />
          ) : (
            <p className="font-body-md text-body-md text-secondary max-w-2xl">
              No wiki pages yet. Click New wiki page and type the topic.
            </p>
          )}
        </section>

        {earlier.status === "ok" && <EarlierNotes projectId={project.id} notes={earlier.notes} />}

        <hr className="border-t border-outline-variant/30 w-full" />

        {/* The project agent: a prior-art digest, resources to review and, for an
            ordinary project, checklist suggestions, from a single Run agent click. */}
        <AgentSection
          projectId={project.id}
          projectName={project.name}
          isChallenge={!!project.challenge_key}
          storedDigest={project.digest}
          exploreHref={exploreHref}
        />

        <hr className="border-t border-outline-variant/30 w-full" />

        <ResourcesSection
          projectId={project.id}
          projectName={project.name}
          exploreHref={exploreHref}
          resources={resources}
        />
      </div>
    );
  } else if (tab === "tasks") {
    content = (
      <div className="flex flex-col gap-4">
        <ChecklistSection
          projectId={project.id}
          projectTarget={project.target}
          projectIndication={project.indication}
          projectModality={project.modality}
          projectStage={project.stage}
          items={project.checklist}
          isColabofest={project.challenge_key === "colabofest_2026"}
        />
        <hr className="border-t border-outline-variant/30 w-full mb-12" />
        <WhoCanHelpSection projectId={project.id} />
      </div>
    );
  } else if (tab === "files") {
    content = <SharedFolderSection projectId={project.id} sharedFolder={project.shared_folder} />;
  } else if (tab === "team") {
    content = (
      <TeamSection
        projectId={project.id}
        members={project.members}
        isLead={project.is_lead}
        viewerUserId={user.id}
      />
    );
  } else if (tab === "proposal" && project.challenge_key) {
    const deadlinePassed = !!project.deadline && new Date(project.deadline).getTime() < Date.now();
    // The bucket is private, so the signed URL is made here on the server.
    let fileUrl: string | null = null;
    if (project.proposal?.file_path) {
      const signed = await getProposalFileUrl(project.id, project.proposal.file_path);
      fileUrl = signed.status === "ok" ? signed.url : null;
    }
    content = (
      <ProposalSection
        projectId={project.id}
        proposal={project.proposal}
        // Submission is ANY LEAD (lib/server/projects.ts:submitProposal).
        isLead={project.is_lead}
        deadlinePassed={deadlinePassed}
        fileUrl={fileUrl}
      />
    );
  }

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-6 pb-16">
      {community && (
        <div className="mb-4">
          <Link
            href={`/communities/${community.slug}`}
            className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            {community.name}
          </Link>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
        <ProjectSidebar
          projectId={project.id}
          name={project.name}
          challengeKey={project.challenge_key}
          memberCount={project.members.length}
          active={tab}
        />

        <main className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 mb-8 pb-4 border-b border-outline-variant/30">
            <h2 className="font-display-lg text-[32px] leading-tight text-on-background">{TAB_LABEL[tab]}</h2>
            {project.is_creator && (
              <DeleteProjectButton
                projectId={project.id}
                projectName={project.name}
                memberCount={project.members.length}
                proposalSubmitted={!!project.proposal?.submitted_at}
              />
            )}
          </div>
          {content}
        </main>
      </div>

      {/* Floating, out of normal flow, on every tab. Pull-based: a member asks,
          nothing is proposed unprompted. */}
      <ProjectChatbot projectId={project.id} projectName={project.name} />
    </div>
  );
}
