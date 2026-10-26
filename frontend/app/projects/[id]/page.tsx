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
// ACCESS (invite-only): the link alone is never enough. Before anything about the
// project is read:
//   signed out        a bare sign-in page (no title, no data) that returns here
//   signed in         claim_pending_project_memberships() runs first, so a first
//                     sign-in with the invited email gets straight in
//   not a member      "Restricted access" (no title, no data); getProject's
//                     `not_found` covers "no such project" and "not on it" alike,
//                     so the page never says which
//   member            the workspace
// Only the data the selected tab needs is read.

import Link from "next/link";
import { headers } from "next/headers";
import { getCurrentUser, getDb } from "@/lib/auth";
import { getProject, getProposalFileUrl } from "@/lib/server/projects";
import { getCommunityById } from "@/lib/server/communities";
import { listProjectResources } from "@/lib/server/projectResources";
import { listProjectPages } from "@/lib/server/pages/projectPages";
import { listWikiNoteSummaries } from "@/lib/server/wikiNotes";
import { parseTab, tabHref, TAB_LABEL } from "@/lib/server/projectWorkspace/workspace";
import { LIST_LABEL, todayIso, visibleLists } from "@/lib/server/projectWorkspace/status";
import { COLABOFEST_CHALLENGE_KEY, COLABOFEST_PROGRAM } from "@/lib/projectTypes";
import { listOpenHelp, listProjectUpdates } from "@/lib/server/projectWorkspace/updates";
import { getThread, listThreads } from "@/lib/server/projectWorkspace/discussions";
import { isWelcomeDismissed } from "@/lib/server/projectWorkspace/welcome";
import { viewerIsSiteAdmin } from "@/lib/server/projectWorkspace/colabofestOps";
import { arrangeAnnouncements, decideAccess, firstName, hasProjectMemberRow, showWelcome } from "@/lib/server/projectWorkspace/colabofest";
import AnnouncementsTab from "@/components/projects/workspace/AnnouncementsTab";
import { DiscussionsList, ThreadView } from "@/components/projects/workspace/DiscussionsTab";
import { RestrictedAccess, SignInGate } from "@/components/projects/workspace/AccessScreens";
import FinalistToggle from "@/components/projects/workspace/FinalistToggle";
import GithubLinkSection from "@/components/projects/workspace/GithubLinkSection";
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
  const { id } = await params;
  const sp = await searchParams;
  const returnPath = `/projects/${encodeURIComponent(id)}`;

  const user = await getCurrentUser();
  if (!user || decideAccess({ signedIn: !!user, isMember: false }) === "sign_in") {
    return <SignInGate returnPath={returnPath} />;
  }

  // A first sign-in with the invited email: link the invitation to this account
  // before deciding. Best effort; a failure just means "not linked yet".
  const db = await getDb();
  if (db) {
    const { error: claimErr } = await db.rpc("claim_pending_project_memberships");
    if (claimErr) console.error("claim_pending_project_memberships failed", claimErr);
  }

  if (!db) {
    return (
      <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-16">
        <p className="font-body-md text-body-md text-error" role="alert">
          Service not configured.
        </p>
      </div>
    );
  }

  // Membership is a project_members row for this person, never "the project row
  // can be read": a member of the project's community can read the row too.
  const isMember = await hasProjectMemberRow(db, id, user.id);
  const access = decideAccess({ signedIn: true, isMember });
  const result = access === "allowed" ? await getProject(id) : ({ status: "not_found" } as const);

  if (access === "restricted" || result.status === "not_found") {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    const projectLink = host ? `${proto}://${host}${returnPath}` : returnPath;
    return <RestrictedAccess returnPath={returnPath} projectLink={projectLink} email={user.email} />;
  }
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

  // The wiki pages are needed by the Wiki tab.
  const pagesResult = tab === "wiki" ? await listProjectPages(project.id) : null;
  const pages = pagesResult?.status === "ok" ? pagesResult.pages : [];

  let content: React.ReactNode = null;
  const today = todayIso();
  // People who can own an item: members with an account, named when we can.
  const owners = project.members
    .filter((m): m is typeof m & { user_id: string } => !!m.user_id)
    .map((m) => ({ user_id: m.user_id, label: m.name || m.email }));

  // The ColaboFest project home follows projects.program. Registration things
  // (Proposal tab, submission, deadline, the registration checklist note) stay on
  // projects.challenge_key.
  const isColabofest = project.program === COLABOFEST_PROGRAM;
  const needsAdminFlag = tab === "team" || tab === "announcements" || tab === "discussions";
  const isSiteAdmin = needsAdminFlag && db ? await viewerIsSiteAdmin(db) : false;

  if (tab === "overview") {
    const [helpPosts, upd, thr, dismissed] = await Promise.all([
      listOpenHelp(project.id),
      listProjectUpdates(project.id),
      listThreads(project.id, 10),
      isColabofest ? isWelcomeDismissed(project.id, user.id) : Promise.resolve(true),
    ]);
    const me = project.members.find((m) => m.user_id === user.id);
    content = (
      <>
        {(upd.status === "error" || thr.status === "error") && (
          <p className="mb-4 font-body-sm text-body-sm text-error" role="alert">
            {upd.status === "error" ? upd.error : thr.status === "error" ? thr.error : ""}
          </p>
        )}
        <OverviewTab
          projectId={project.id}
          isColabofest={isColabofest}
          showWelcome={showWelcome({ isColabofest, dismissed })}
          firstName={firstName(me?.name, user.email)}
          today={today}
          role={project.viewer_role}
          description={project.description}
          sharedFolderUrl={project.shared_folder?.url ?? null}
          checklist={project.checklist}
          members={project.members}
          announcements={upd.status === "ok" ? arrangeAnnouncements(upd.updates.filter((u) => u.kind === "announcement")) : []}
          threads={thr.status === "ok" ? thr.threads : []}
          helpPosts={helpPosts}
        />
      </>
    );
  } else if (tab === "announcements") {
    const upd = await listProjectUpdates(project.id);
    content =
      upd.status === "ok" ? (
        <AnnouncementsTab projectId={project.id} role={project.viewer_role} isSiteAdmin={isSiteAdmin} updates={upd.updates} />
      ) : (
        <p className="font-body-md text-body-md text-error" role="alert">
          {upd.error}
        </p>
      );
  } else if (tab === "discussions") {
    const threadId = typeof sp.thread === "string" ? sp.thread : null;
    if (threadId) {
      const one = await getThread(project.id, threadId);
      if (one.status === "ok") {
        content = (
          <ThreadView projectId={project.id} thread={one.thread} replies={one.replies} role={project.viewer_role} isSiteAdmin={isSiteAdmin} />
        );
      } else {
        content = (
          <p className="font-body-md text-body-md text-secondary" role={one.status === "error" ? "alert" : undefined}>
            {one.status === "error" ? one.error : "That discussion no longer exists."}{" "}
            <Link href={tabHref(project.id, "discussions")} className="text-primary underline underline-offset-4">
              All discussions
            </Link>
          </p>
        );
      }
    } else {
      const thr = await listThreads(project.id);
      content =
        thr.status === "ok" ? (
          <DiscussionsList projectId={project.id} threads={thr.threads} startOpen={sp.new === "1"} />
        ) : (
          <p className="font-body-md text-body-md text-error" role="alert">
            {thr.error}
          </p>
        );
    }
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
    // Up to three lists: the two partner checklists (challenge projects only),
    // then Team tasks. Each has its own Add item and progress count.
    content = (
      <div className="flex flex-col gap-4">
        {visibleLists(!!project.challenge_key || isColabofest).map((key) => (
          <ChecklistSection
            key={key}
            listKey={key}
            title={LIST_LABEL[key]}
            members={owners}
            today={today}
            projectId={project.id}
            projectTarget={project.target}
            projectIndication={project.indication}
            projectModality={project.modality}
            projectStage={project.stage}
            items={project.checklist.filter((i) => i.list_key === key)}
            isColabofest={key === "team" && project.challenge_key === COLABOFEST_CHALLENGE_KEY}
          />
        ))}
        <hr className="border-t border-outline-variant/30 w-full mb-12" />
        <WhoCanHelpSection projectId={project.id} />
      </div>
    );
  } else if (tab === "files") {
    content = (
      <>
        <SharedFolderSection projectId={project.id} sharedFolder={project.shared_folder} />
        <GithubLinkSection projectId={project.id} githubUrl={project.github_url} />
      </>
    );
  } else if (tab === "team") {
    content = (
      <div className="flex flex-col gap-8">
        <TeamSection
          projectId={project.id}
          members={project.members}
          isLead={project.is_lead}
          showAffiliation={isColabofest}
          viewerUserId={user.id}
        />
        {isSiteAdmin && isColabofest && <FinalistToggle projectId={project.id} finalist={project.finalist} />}
      </div>
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
          program={project.program}
          memberCount={project.members.length}
          finalist={project.finalist}
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
