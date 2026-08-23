// lib/server/projects.ts — the team project workspace (projects, membership,
// creation, Team + Proposal sections of the detail page). Checklist,
// Resources and Shared Folder are step 2b and are NOT in this file yet — see
// frontend/design/projects/STRUCTURE.md.
//
// AUTH: goes through lib/auth.ts and never imports @supabase directly, same
// rule as lib/server/collab.ts. getDb() carries the caller's session, so
// every query below is subject to the is_project_member()/is_project_lead()
// RLS policies in database/migrations/2026-08-04_projects.sql — that is the
// REAL gate. Nothing in this file trusts a client-supplied id over RLS, and
// nothing here ever sends lead_id or a member's user_id to the browser: a
// caller gets computed booleans (`is_lead`) instead, the same pattern
// lib/server/collab.ts uses for `is_owner`.
//
// TWO RULES RLS CANNOT ENFORCE, both checked in code here:
//   1. Only the lead may set project_proposals.submitted_at. RLS's
//      "Project proposals: member update" policy allows ANY member to
//      update the row (title/category/summary/file_path are all
//      member-editable by design), so submitProposal() re-derives the
//      caller from the session and compares against projects.lead_id
//      itself — the column is read here for that comparison, but (per the
//      rule above) never returned to a caller of this module.
//   2. The submission deadline. RLS has no notion of "now" vs.
//      projects.deadline; both upsertProposal() and submitProposal() compare
//      the caller's server clock against it before writing anything. A
//      client-side deadline check is a courtesy for the UI, never the gate.

import { getCurrentUser, getDb, requireCurrentUser, type Db } from "@/lib/auth";
import type { CreateProjectInput, MyProjectSummary } from "@/lib/projectTypes";
import { classifyChecklistItem } from "@/lib/server/checklistClassify";

const PROJECT_SELECT =
  "id, name, description, lead_id, deadline, challenge_key, created_at";

const PROPOSALS_BUCKET = "project-proposals";

// ── result types ─────────────────────────────────────────────────────────────
//
// Discriminated, matching lib/server/collab.ts's ActionResult idiom: a caller
// checks `.status` and TypeScript narrows the rest, so a query failure can
// never be silently read as "zero projects" / "project not found".

export type ListMyProjectsResult =
  | { status: "ok"; projects: MyProjectSummary[] }
  | { status: "error"; error: string };

export type CreateProjectResult =
  | { status: "ok"; id: string }
  | { status: "error"; error: string };

export type ProjectMember = {
  id: string;
  email: string;
  user_id: string | null;
  role: "lead" | "member";
  created_at: string;
  // Resolved via project_member_names() (2026-08-07_project_member_names.sql),
  // NOT a join on public.users — that table's own SELECT policy
  // (`is_public = true`) would blank out a private-profile member instead of
  // falling back to email. Both null for a pending (user_id-less) member,
  // and profile_slug is null whenever the profile isn't public even if name
  // resolved — same rule as CollabOwner/ShowcaseOwner.
  name: string | null;
  profile_slug: string | null;
};

// One project's proposal draft/submission. At most one per project — see
// upsertProposal(), which selects the existing row (if any) rather than
// relying on a DB-level uniqueness constraint (project_proposals has none;
// this file is what keeps it to one).
export type ProjectProposal = {
  id: string;
  title: string | null;
  category: string | null;
  summary: string | null;
  // Storage object path, e.g. "<project_id>/My_Proposal.pdf" — never a URL.
  // Turn this into something clickable via getProposalFileUrl(), which
  // mints a short-lived signed URL; the bucket is private, so file_path
  // alone is not enough to view the file.
  file_path: string | null;
  submitted_at: string | null;
  updated_at: string;
};

export type ChecklistStatus = "not_yet" | "in_progress" | "ready";

export type ChecklistItem = {
  id: string;
  label: string;
  status: ChecklistStatus;
  position: number;
  updated_at: string;
  // The Collaborate bridge: null until someone has hit "Ask for help" on
  // this item. Once set, the row shows "Posted to Collaborate · N
  // responses" instead of (in addition to) the "Ask for help" link — see
  // STRUCTURE.md's Checklist section. Resolved via a plain query on
  // collab_posts.checklist_item_id, count via the existing
  // collab_post_interest_counts() RPC (lib/server/collab.ts already uses
  // it for the board; this is the same function, not a new one).
  collab_post_id: string | null;
  collab_post_responses: number;
  // The post's own title (collab_posts.title, publicly selectable per
  // "collab_posts_public_select" — not gated the way responder identity
  // is). Null whenever collab_post_id is. Not rendered on this page today
  // (the Checklist row only shows "Posted to Collaborate · N responses"),
  // but resolved here anyway so any consumer of getProject() — the
  // chatbot included — has it without a second query.
  collab_post_title: string | null;
  // The STORED result of classifying this item's label against the
  // provider catalog's capability vocabulary (see
  // lib/server/checklistClassify.ts and
  // database/migrations/2026-08-19_checklist_matched_capabilities.sql).
  // Computed once, at add/edit time — never here at read time, and never
  // per-render — so a checklist page load costs zero LLM calls. Non-empty
  // -> the item shows "Find a service provider"; empty (including every
  // item from before this column existed, and any item whose
  // classification failed) -> "Ask for help". Exactly one of those two
  // ever renders for a given item — see ChecklistSection.tsx.
  matched_capabilities: string[];
};

// projects.shared_folder_url/_set_by/_set_at — a team pastes a link to
// whatever their institution already runs (Box, Drive, ...); we store the
// link, never files. set_by is resolved to a display name the same way
// team members are (project_member_names()), not a raw user_id.
export type SharedFolder = {
  url: string;
  set_by_name: string | null;
  set_at: string;
};

// The project agent's persisted prior-art digest
// (2026-08-19_project_digests.sql) — one row per project, replaced on each
// run, never a history. Only the digest is persisted, never the proposed
// resources/checklist items (see that migration's own header for why: a
// stale proposal would confuse, a stale digest is still a useful,
// honestly-dated research summary). `generated_at` is the BACKEND's own
// generation timestamp, not when the row was saved — that's what "the date
// it was generated" on the frontend actually shows.
export type ProjectDigest = {
  markdown: string;
  generated_at: string;
  counts: Record<string, number>;
  goal_text: string;
};

export type ProjectDetail = {
  id: string;
  name: string;
  description: string | null;
  deadline: string | null;
  challenge_key: string | null;
  target: string | null;
  indication: string | null;
  modality: string | null;
  stage: string | null;
  // "Any lead" — project_members.role = 'lead' for the viewer. Gates the
  // Team section's controls (add member, promote, remove, step down).
  // NOT the same as is_creator: co-leads are real leads for every purpose
  // EXCEPT deleting the project itself.
  is_lead: boolean;
  // The ORIGINAL creator (projects.lead_id). Gates project deletion ONLY —
  // see database/migrations/2026-08-08_project_co_leads.sql: proposal
  // submission used to be creator-only too but is now "any lead"
  // (lib/server/projects.ts:submitProposal), so deletion is the one thing
  // left that checks this instead of is_lead.
  is_creator: boolean;
  members: ProjectMember[];
  // Null for every project without challenge_key set, AND for a
  // challenge project that hasn't saved any proposal fields yet — both
  // render as "no Proposal section" / "nothing saved yet" to the caller,
  // which is the distinction the Proposal section's own gating (on
  // challenge_key, not on this) actually needs.
  proposal: ProjectProposal | null;
  checklist: ChecklistItem[];
  shared_folder: SharedFolder | null;
  // null when the agent has never been run for this project, or the run
  // never produced a digest (search failed entirely — see
  // run_project_agent_async's own docstring), or the save itself failed
  // (best-effort — see saveProjectDigest below).
  digest: ProjectDigest | null;
};

export type GetProjectResult =
  | { status: "ok"; project: ProjectDetail }
  // Covers BOTH "no such project" and "exists but the caller isn't a member".
  // This is deliberate, not a shortcut: RLS returns zero rows for both cases
  // identically (see the ACCESS CONTROL note in 2026-08-04_projects.sql —
  // "never sent to a non-member at all, not merely hidden"), and the only way
  // to tell them apart would be a service-role lookup that bypasses that same
  // RLS — which would leak "yes, this project exists, you're just not on it"
  // to someone the schema says should see nothing. Callers get a single,
  // honest "not_found" instead of a distinction this app cannot make safely.
  | { status: "not_found" }
  | { status: "error"; error: string };

export type AddMemberResult =
  | { status: "ok"; member: ProjectMember }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

export type RemoveMemberResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

export type PromoteMemberResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "error"; error: string };

export type StepDownResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  // The last-lead guard. The REAL gate is the enforce_min_one_lead()
  // trigger (2026-08-08_project_co_leads.sql) — this status exists so the
  // pre-check below (done for a friendly message) and the trigger's own
  // raised exception (if the pre-check ever races or is bypassed) both
  // surface the same way to a caller.
  | { status: "last_lead"; error: string }
  | { status: "error"; error: string };

export type UpsertProposalResult = { status: "ok" } | { status: "error"; error: string };

export type SubmitProposalResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "deadline_passed"; error: string }
  | { status: "error"; error: string };

export type SignedUrlResult = { status: "ok"; url: string } | { status: "error"; error: string };

export type AddChecklistItemResult =
  | { status: "ok"; item: ChecklistItem; classificationFailed: boolean }
  | { status: "error"; error: string };

export type ChecklistWriteResult = { status: "ok" } | { status: "error"; error: string };

// A label edit can change which action a checklist item should show (a
// re-worded item might now — or no longer — map to a service capability),
// so this carries the freshly re-classified matched_capabilities back to
// the client rather than the client guessing/keeping the stale value from
// before the edit. See updateChecklistItemLabel below.
export type UpdateChecklistLabelResult =
  | { status: "ok"; matched_capabilities: string[]; classificationFailed: boolean }
  | { status: "error"; error: string };

export type SetSharedFolderResult =
  | { status: "ok"; shared_folder: SharedFolder }
  | { status: "error"; error: string };

export type DeleteProjectResult = { status: "ok" } | { status: "error"; error: string };

// Internal only — lead_id (the CREATOR, not "any lead" — see
// 2026-08-08_project_co_leads.sql) and deadline, read for a permission/
// deadline check, never returned from an exported function. null covers
// BOTH "no such project" and "not a member" (same RLS-driven ambiguity as
// GetProjectResult above): a plain select on `projects` returns nothing in
// either case.
async function loadProjectGate(
  db: Db,
  projectId: string
): Promise<{ creatorId: string; deadline: string | null } | null> {
  const { data, error } = await db
    .from("projects")
    .select("lead_id, deadline")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data) return null;
  return { creatorId: data.lead_id as string, deadline: (data.deadline as string | null) ?? null };
}

// Internal only — "is this uid A lead (any lead) of this project", the
// app-layer mirror of is_project_lead() for call sites that want a plain
// boolean rather than relying solely on RLS to reject an insert/update.
async function isCallerLead(db: Db, projectId: string, userId: string): Promise<boolean> {
  const { data } = await db
    .from("project_members")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("role", "lead")
    .maybeSingle();
  return !!data;
}

function deadlineHasPassed(deadline: string | null): boolean {
  return !!deadline && new Date(deadline).getTime() < Date.now();
}

// ── reads ────────────────────────────────────────────────────────────────────

/** Every project the current user is a member of (lead or member). Signed-out
 *  callers get an empty list — there is no public project browsing, unlike
 *  the Collaborate board. */
export async function listMyProjects(): Promise<ListMyProjectsResult> {
  const db = await getDb();
  if (!db) return { status: "error", error: "Service not configured." };

  const viewer = await getCurrentUser();
  if (!viewer) return { status: "ok", projects: [] };

  // RECONCILIATION: claim any project_members row still unlinked
  // (user_id IS NULL) whose email matches THIS caller's own verified
  // email, before reading "my projects" below — RLS on `projects` gates
  // visibility through project_members.user_id = auth.uid(), so an
  // unclaimed row is invisible here no matter how long ago it was added.
  // See 2026-08-19_link_existing_accounts.sql for the full reasoning: this
  // is the backstop for the reverse-ordering case (added while they had no
  // account) and for anything addProjectMember's own insert-time lookup
  // ever misses — it's what lets this feature stop depending on signup
  // timing at all. IDEMPOTENT and CHEAP (a single UPDATE over a partial
  // index of just the still-pending rows) — safe to call on every load.
  // Best-effort: a failed claim here should degrade to "maybe still shows
  // as pending this load" rather than blocking the whole page.
  const { error: claimError } = await db.rpc("claim_pending_project_memberships");
  if (claimError) {
    console.error("listMyProjects: claim_pending_project_memberships failed", claimError);
  }

  const { data, error } = await db
    .from("projects")
    .select(PROJECT_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("listMyProjects: projects query failed", error);
    return { status: "error", error: "Couldn't load your projects." };
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return { status: "ok", projects: [] };

  const ids = rows.map((r) => r.id as string);

  // Member counts and proposal-submitted flags, both via plain selects —
  // RLS on project_members/project_proposals already restricts these to rows
  // belonging to the viewer's own projects (is_project_member()), so no
  // extra .in("project_id", ids) filter is needed for authorization; it's
  // still added below to keep the query scoped to exactly this page's rows.
  const [membersRes, proposalsRes] = await Promise.all([
    db.from("project_members").select("project_id, user_id, role").in("project_id", ids),
    db.from("project_proposals").select("project_id, submitted_at").in("project_id", ids),
  ]);

  if (membersRes.error) {
    console.error("listMyProjects: project_members query failed", membersRes.error);
    return { status: "error", error: "Couldn't load your projects." };
  }
  if (proposalsRes.error) {
    console.error("listMyProjects: project_proposals query failed", proposalsRes.error);
    return { status: "error", error: "Couldn't load your projects." };
  }

  const memberCounts = new Map<string, number>();
  // "Any lead" (project_members.role = 'lead' for the viewer) — matches
  // is_project_lead()'s new meaning, see 2026-08-08_project_co_leads.sql.
  const viewerIsLeadOf = new Set<string>();
  for (const row of (membersRes.data ?? []) as {
    project_id: string;
    user_id: string | null;
    role: "lead" | "member";
  }[]) {
    memberCounts.set(row.project_id, (memberCounts.get(row.project_id) ?? 0) + 1);
    if (row.user_id === viewer.id && row.role === "lead") viewerIsLeadOf.add(row.project_id);
  }

  const proposalSubmitted = new Set<string>();
  for (const row of (proposalsRes.data ?? []) as { project_id: string; submitted_at: string | null }[]) {
    if (row.submitted_at) proposalSubmitted.add(row.project_id);
  }

  const projects: MyProjectSummary[] = rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    member_count: memberCounts.get(row.id as string) ?? 0,
    // Computed here, from the session — never a raw id sent to the client,
    // just this yes/no. "Any lead", not creator — see
    // 2026-08-08_project_co_leads.sql.
    is_lead: viewerIsLeadOf.has(row.id as string),
    deadline: (row.deadline as string | null) ?? null,
    challenge_key: (row.challenge_key as string | null) ?? null,
    proposal_submitted: proposalSubmitted.has(row.id as string),
  }));

  return { status: "ok", projects };
}

/** One project + its members. See GetProjectResult for why "not found" and
 *  "not permitted" are one status, not two. */
export async function getProject(id: string): Promise<GetProjectResult> {
  const db = await getDb();
  if (!db) return { status: "error", error: "Service not configured." };

  const viewer = await getCurrentUser();
  if (!viewer) return { status: "not_found" };

  const { data: projectRow, error: projectErr } = await db
    .from("projects")
    .select(
      "id, name, description, lead_id, deadline, challenge_key, target, indication, modality, stage, " +
        "shared_folder_url, shared_folder_set_by, shared_folder_set_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (projectErr) {
    console.error("getProject: projects query failed", projectErr);
    return { status: "error", error: "Couldn't load this project." };
  }
  if (!projectRow) return { status: "not_found" };

  const [membersRes, proposalRes, namesRes, checklistRes, checklistPostsRes, interestCountsRes, digestRes] =
    await Promise.all([
      db
        .from("project_members")
        .select("id, email, user_id, role, created_at")
        .eq("project_id", id)
        .order("created_at", { ascending: true }),
      // Fetched regardless of challenge_key — a leadless-cost lookup, and the
      // section's own gate is challenge_key, not "does a proposal row exist".
      db
        .from("project_proposals")
        .select("id, title, category, summary, file_path, submitted_at, updated_at")
        .eq("project_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Public identity for linked members AND the shared-folder setter —
      // see project_member_names() in 2026-08-07_project_member_names.sql
      // for why this can't be a plain join on public.users (its own SELECT
      // policy blanks out a private-profile member instead of falling back
      // to their email).
      db.rpc("project_member_names", { project_ids: [id] }),
      db
        .from("checklist_items")
        .select("id, label, status, position, created_at, updated_at, matched_capabilities")
        .eq("project_id", id)
        .order("position", { ascending: true }),
      // Which checklist items already have a Collaborate post attached —
      // one row per post, not per item, since a post either has this
      // project's checklist_item_id or it doesn't.
      db
        .from("collab_posts")
        .select("id, title, checklist_item_id")
        .not("checklist_item_id", "is", null),
      // Same SECURITY DEFINER aggregate lib/server/collab.ts's board view
      // uses — connection_requests SELECT is own-rows-only, so counting
      // responses cannot be done with a normal query.
      db.rpc("collab_post_interest_counts"),
      // The project agent's persisted digest (2026-08-19_project_digests.sql)
      // — one row per project, PRIMARY KEY project_id, so a plain
      // .eq().maybeSingle() is exact, no ordering/limit needed the way
      // proposal's "most recent of several" lookup above does.
      db
        .from("project_digests")
        .select("markdown, generated_at, counts, goal_text")
        .eq("project_id", id)
        .maybeSingle(),
    ]);

  if (membersRes.error) {
    console.error("getProject: project_members query failed", membersRes.error);
    return { status: "error", error: "Couldn't load this project's team." };
  }
  if (proposalRes.error) {
    console.error("getProject: project_proposals query failed", proposalRes.error);
    return { status: "error", error: "Couldn't load this project's proposal." };
  }
  if (checklistRes.error) {
    console.error("getProject: checklist_items query failed", checklistRes.error);
    return { status: "error", error: "Couldn't load this project's checklist." };
  }
  // Degrades to null on failure, unlike the hard-fails above — persistence
  // is a convenience, not a dependency (per the digest feature's own
  // spec): a digest-read hiccup should render the page without a stored
  // digest, never take down the whole project detail page over it.
  if (digestRes.error) {
    console.error("getProject: project_digests query failed", digestRes.error);
  }
  // Degrades to an empty map on failure — same stance as collab.ts's
  // ownerMap(): a names lookup failing should leave rows showing email,
  // not blank the whole team list.
  const names = new Map<string, { name: string | null; profile_slug: string | null }>();
  if (!namesRes.error && Array.isArray(namesRes.data)) {
    for (const row of namesRes.data as { user_id: string; name: string | null; profile_slug: string | null }[]) {
      names.set(row.user_id, { name: row.name, profile_slug: row.profile_slug });
    }
  } else if (namesRes.error) {
    console.error("getProject: project_member_names RPC failed", namesRes.error);
  }

  // checklist_item_id -> post id, and post id -> response count. Both
  // degrade to empty maps on failure, same reasoning as `names` above: a
  // Collaborate-bridge lookup failing should leave the checklist showing
  // plain items, not blank the whole section.
  const postByChecklistItem = new Map<string, { id: string; title: string }>();
  if (!checklistPostsRes.error && Array.isArray(checklistPostsRes.data)) {
    for (const row of checklistPostsRes.data as {
      id: string;
      title: string;
      checklist_item_id: string | null;
    }[]) {
      if (row.checklist_item_id) postByChecklistItem.set(row.checklist_item_id, { id: row.id, title: row.title });
    }
  } else if (checklistPostsRes.error) {
    console.error("getProject: collab_posts (checklist bridge) query failed", checklistPostsRes.error);
  }
  const responseCounts = new Map<string, number>();
  if (!interestCountsRes.error && Array.isArray(interestCountsRes.data)) {
    for (const row of interestCountsRes.data as { post_id: string; interested: number }[]) {
      responseCounts.set(row.post_id, Number(row.interested) || 0);
    }
  } else if (interestCountsRes.error) {
    console.error("getProject: collab_post_interest_counts RPC failed", interestCountsRes.error);
  }

  const row = projectRow as Record<string, unknown>;
  const proposalRow = proposalRes.data as Record<string, unknown> | null;

  const sharedFolderUrl = (row.shared_folder_url as string | null) ?? null;
  const sharedFolderSetBy = (row.shared_folder_set_by as string | null) ?? null;
  const sharedFolderSetAt = (row.shared_folder_set_at as string | null) ?? null;

  return {
    status: "ok",
    project: {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      deadline: (row.deadline as string | null) ?? null,
      challenge_key: (row.challenge_key as string | null) ?? null,
      target: (row.target as string | null) ?? null,
      indication: (row.indication as string | null) ?? null,
      modality: (row.modality as string | null) ?? null,
      stage: (row.stage as string | null) ?? null,
      // "Any lead" — computed from the members list we already fetched,
      // no extra query needed. NOT the same as is_creator below; see
      // 2026-08-08_project_co_leads.sql for why the two diverge.
      is_lead: ((membersRes.data ?? []) as { user_id: string | null; role: string }[]).some(
        (m) => m.user_id === viewer.id && m.role === "lead"
      ),
      is_creator: row.lead_id === viewer.id,
      members: ((membersRes.data ?? []) as Record<string, unknown>[]).map((m) => {
        const userId = (m.user_id as string | null) ?? null;
        const identity = userId ? names.get(userId) : undefined;
        return {
          id: m.id as string,
          email: m.email as string,
          user_id: userId,
          role: m.role as "lead" | "member",
          created_at: m.created_at as string,
          name: identity?.name ?? null,
          profile_slug: identity?.profile_slug ?? null,
        };
      }),
      proposal: proposalRow
        ? {
            id: proposalRow.id as string,
            title: (proposalRow.title as string | null) ?? null,
            category: (proposalRow.category as string | null) ?? null,
            summary: (proposalRow.summary as string | null) ?? null,
            file_path: (proposalRow.file_path as string | null) ?? null,
            submitted_at: (proposalRow.submitted_at as string | null) ?? null,
            updated_at: proposalRow.updated_at as string,
          }
        : null,
      checklist: ((checklistRes.data ?? []) as Record<string, unknown>[]).map((c) => {
        const itemId = c.id as string;
        const post = postByChecklistItem.get(itemId) ?? null;
        return {
          id: itemId,
          label: c.label as string,
          status: c.status as ChecklistStatus,
          position: c.position as number,
          updated_at: c.updated_at as string,
          collab_post_id: post?.id ?? null,
          collab_post_responses: post ? responseCounts.get(post.id) ?? 0 : 0,
          collab_post_title: post?.title ?? null,
          matched_capabilities: Array.isArray(c.matched_capabilities)
            ? (c.matched_capabilities as string[])
            : [],
        };
      }),
      shared_folder: sharedFolderUrl
        ? {
            url: sharedFolderUrl,
            set_by_name: sharedFolderSetBy ? names.get(sharedFolderSetBy)?.name ?? null : null,
            set_at: sharedFolderSetAt as string,
          }
        : null,
      digest: digestRes.data
        ? {
            markdown: digestRes.data.markdown as string,
            generated_at: digestRes.data.generated_at as string,
            counts: (digestRes.data.counts as Record<string, number> | null) ?? {},
            goal_text: digestRes.data.goal_text as string,
          }
        : null,
    },
  };
}

// ── writes ───────────────────────────────────────────────────────────────────

/** Create a project as the signed-in user, who becomes both `lead_id` on the
 *  row AND a project_members row with role 'lead'.
 *
 *  BOTH INSERTS MUST SUCCEED, OR NEITHER SHOULD SURVIVE. Without the
 *  project_members row, is_project_member() (and therefore every SELECT
 *  policy on `projects`) returns false for its own creator — the project
 *  would exist in the database but be invisible to the one person who just
 *  made it, which reads exactly like "creation silently failed."
 *
 *  This used to be two sequential PostgREST inserts with a compensating
 *  DELETE if the second one failed. That shipped a real bug: a plain insert
 *  sends `Prefer: return=representation` (INSERT ... RETURNING) by default,
 *  and Postgres evaluates that RETURNING against the `projects` SELECT
 *  policy — is_project_member(id, auth.uid()) — which is false at that exact
 *  instant, because the project_members row hasn't been inserted yet. The
 *  denied RETURNING read surfaces as the same 42501 "new row violates
 *  row-level security policy" text a failed INSERT itself would use, which
 *  is what made this look like a broken INSERT policy during verification —
 *  it wasn't; pg_policy confirmed "Projects: authenticated insert" is exactly
 *  right. Same root cause as the documented feedback-table gotcha (see
 *  database/migrations/2026-07-29_feedback.sql), just not fixable the same
 *  way: feedback.ts's fix is "don't ask for the row back"; this function
 *  genuinely needs the new row's id, to insert the member row against it.
 *
 *  Fixed at the root: both inserts now happen inside
 *  create_project_with_lead(), a single SECURITY DEFINER function
 *  (database/migrations/2026-08-06_create_project_with_lead.sql) that runs
 *  them in one transaction and never has to satisfy RLS on its own writes.
 *  lead_id is taken from auth.uid() INSIDE that function, never from an
 *  argument this code passes — that's what makes bypassing RLS safe here. No
 *  compensating delete: one transaction means there is no partial state to
 *  roll back. */
export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const { db } = await requireCurrentUser();

  const name = input.name.trim();
  if (!name) return { status: "error", error: "A project name is required." };

  const { data, error } = await db.rpc("create_project_with_lead", {
    p_name: name,
    p_description: input.description?.trim() || null,
    p_deadline: input.deadline || null,
    p_challenge_key: input.challenge_key || null,
    p_target: input.target?.trim() || null,
    p_indication: input.indication?.trim() || null,
    p_modality: input.modality || null,
    p_stage: input.stage || null,
  });

  if (error || !data) {
    console.error("createProject: create_project_with_lead RPC failed", error);
    return { status: "error", error: "Couldn't create the project." };
  }

  return { status: "ok", id: data as string };
}

// ── team ─────────────────────────────────────────────────────────────────────

/** Add a member by email. ANY LEAD — enforced twice: the
 *  "Project members: lead insert" RLS policy (the real gate, and now "any
 *  lead" since is_project_lead() checks project_members.role, see
 *  2026-08-08_project_co_leads.sql) AND the explicit isCallerLead() check
 *  below, which exists purely to return a clear { status: "forbidden" }
 *  instead of making a non-lead caller decode a raw 42501 from Postgres.
 *
 *  Email is lowercased before insert. The unique index is on
 *  (project_id, lower(email)) — inserting mixed-case would still collide
 *  with an existing lowercase row and fail as a duplicate anyway, just with
 *  a less honest-looking value stored; normalizing here means the stored
 *  value and the constraint agree, and the 23505 case below reads as
 *  "already a member" rather than a raw constraint-name error.
 *
 *  LINKS AN EXISTING ACCOUNT IMMEDIATELY, not just at signup.
 *  handle_new_user() (2026-08-04_projects.sql) only claims a pending row
 *  when its email signs up AFTER being added — the common case is the
 *  reverse, someone already has an account. find_account_id_by_email_for_
 *  project (2026-08-19_link_existing_accounts.sql) looks that up in the
 *  database (never by the app reading auth.users directly) and, if found,
 *  the row is inserted ALREADY linked — no waiting on a trigger, no
 *  "Awaiting invitation acceptance" limbo for someone who could see the
 *  project the moment they're added. A lookup failure (RPC error, no
 *  match) degrades to the old pending-by-email behavior rather than
 *  blocking the add — the reconciliation in listMyProjects() (see
 *  claim_pending_project_memberships) is the backstop if this ever misses. */
export async function addProjectMember(
  projectId: string,
  email: string
): Promise<AddMemberResult> {
  const { user, db } = await requireCurrentUser();

  const gate = await loadProjectGate(db, projectId);
  if (!gate) return { status: "error", error: "Project not found." };
  if (!(await isCallerLead(db, projectId, user.id))) {
    return { status: "forbidden", error: "Only a project lead can add members." };
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized) return { status: "error", error: "An email address is required." };

  let existingUserId: string | null = null;
  const { data: lookupData, error: lookupError } = await db.rpc(
    "find_account_id_by_email_for_project",
    { p_project_id: projectId, p_email: normalized }
  );
  if (lookupError) {
    // Degrade, don't block — same stance as everywhere else in this file.
    // Worst case the row is added pending and the projects-list
    // reconciliation links it the next time the invitee loads their list.
    console.error("addProjectMember: existing-account lookup failed", lookupError);
  } else {
    existingUserId = (lookupData as string | null) ?? null;
  }

  // The inserter (the lead) is already a member of this project, so the
  // RETURNING read below is evaluated against a row the caller can already
  // see — unlike create_project_with_lead's bootstrapping problem, there is
  // no chicken-and-egg here and a plain .select() is safe.
  const { data, error } = await db
    .from("project_members")
    .insert({
      project_id: projectId,
      email: normalized,
      role: "member",
      added_by: user.id,
      user_id: existingUserId,
    })
    .select("id, email, user_id, role, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { status: "error", error: "That person is already a member of this project." };
    }
    console.error("addProjectMember: insert failed", error);
    return { status: "error", error: "Couldn't add that member." };
  }

  return {
    status: "ok",
    member: {
      id: data.id as string,
      email: data.email as string,
      user_id: (data.user_id as string | null) ?? null,
      role: data.role as "lead" | "member",
      created_at: data.created_at as string,
      // Linked immediately when an existing account was found above; name/
      // profile_slug aren't resolved here either way (a fresh add has no
      // caller-visible reason to also call project_member_names() for one
      // row — the next full project_members read does that as usual).
      name: null,
      profile_slug: null,
    },
  };
}

/** Remove a member. ANY LEAD may remove a MEMBER; no one may remove a lead
 *  (including themselves — that's "step down", a role UPDATE, not this).
 *
 *  As of 2026-08-08_project_co_leads.sql, "Project members: lead delete"
 *  itself now enforces "never a lead row" at the database layer (its
 *  USING clause requires role = 'member' on the TARGET row) — so the old
 *  app-layer "lead can't remove themselves" check is no longer the only
 *  thing stopping that; RLS backs it up structurally, for any caller, not
 *  just a lead targeting their own row. The lookup below still runs first
 *  so a caller gets "that member no longer exists" or a clear forbidden
 *  reason instead of a silent zero-rows-affected delete. */
export async function removeProjectMember(
  projectId: string,
  memberId: string
): Promise<RemoveMemberResult> {
  const { user, db } = await requireCurrentUser();

  const gate = await loadProjectGate(db, projectId);
  if (!gate) return { status: "error", error: "Project not found." };
  if (!(await isCallerLead(db, projectId, user.id))) {
    return { status: "forbidden", error: "Only a project lead can remove members." };
  }

  const { data: member, error: memberErr } = await db
    .from("project_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (memberErr) {
    console.error("removeProjectMember: lookup failed", memberErr);
    return { status: "error", error: "Couldn't verify that member." };
  }
  if (!member) return { status: "error", error: "That member no longer exists." };

  if (member.role === "lead") {
    return { status: "forbidden", error: "A lead can't be removed — they'd need to step down first." };
  }

  const { error } = await db
    .from("project_members")
    .delete()
    .eq("id", memberId)
    .eq("project_id", projectId);

  if (error) {
    console.error("removeProjectMember: delete failed", error);
    return { status: "error", error: "Couldn't remove that member." };
  }

  return { status: "ok" };
}

/** Promote a member to lead. ANY LEAD may do this, to ANY member —
 *  "Project members: promote or self-demote" RLS enforces it (its WITH
 *  CHECK allows role = 'lead' unconditionally for any caller who is
 *  already a lead per the USING clause). The isCallerLead() check below is
 *  the same "clear forbidden message instead of a raw 42501" courtesy as
 *  addProjectMember()'s.
 *
 *  Courtesy guard, app-layer only: refuses to promote a PENDING row
 *  (user_id null) — nothing in RLS stops this at the SQL layer (the policy
 *  has no opinion on it), but a person who hasn't signed up yet can't
 *  exercise lead powers, so promoting them here would just be a role label
 *  with nothing behind it. */
export async function promoteProjectMember(
  projectId: string,
  memberId: string
): Promise<PromoteMemberResult> {
  const { user, db } = await requireCurrentUser();

  const gate = await loadProjectGate(db, projectId);
  if (!gate) return { status: "error", error: "Project not found." };
  if (!(await isCallerLead(db, projectId, user.id))) {
    return { status: "forbidden", error: "Only a project lead can promote members." };
  }

  const { data: member, error: memberErr } = await db
    .from("project_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (memberErr) {
    console.error("promoteProjectMember: lookup failed", memberErr);
    return { status: "error", error: "Couldn't verify that member." };
  }
  if (!member) return { status: "error", error: "That member no longer exists." };
  if (member.role === "lead") return { status: "ok" }; // already a lead — idempotent
  if (!member.user_id) {
    return {
      status: "error",
      error: "This person hasn't accepted their invitation yet — they can't be made a lead until they do.",
    };
  }

  const { error } = await db
    .from("project_members")
    .update({ role: "lead" })
    .eq("id", memberId)
    .eq("project_id", projectId);

  if (error) {
    console.error("promoteProjectMember: update failed", error);
    return { status: "error", error: "Couldn't promote that member." };
  }

  return { status: "ok" };
}

/** Step down from lead to member — the ONLY way a lead row ever becomes a
 *  member row again; no one (not even another lead) can demote someone
 *  else. Targets the CALLER'S OWN row, always — there is deliberately no
 *  memberId parameter, so there's no way to even attempt this against
 *  anyone else's row from this function's own interface.
 *
 *  The pre-check below (counting other leads) exists ONLY for a friendly
 *  error message. The REAL, authoritative gate against the last lead
 *  stepping down is the enforce_min_one_lead() trigger
 *  (2026-08-08_project_co_leads.sql) — it fires on every UPDATE to this
 *  table regardless of caller, so even if this pre-check raced with
 *  another step-down and came back stale, the trigger still refuses the
 *  write. This function's own contribution beyond the trigger is purely
 *  UX: turning a raised-exception 500 into a clean { status: "last_lead" }
 *  most of the time. */
export async function stepDownFromLead(projectId: string): Promise<StepDownResult> {
  const { user, db } = await requireCurrentUser();

  const gate = await loadProjectGate(db, projectId);
  if (!gate) return { status: "error", error: "Project not found." };

  const { data: myRow, error: myRowErr } = await db
    .from("project_members")
    .select("id, role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (myRowErr) {
    console.error("stepDownFromLead: lookup failed", myRowErr);
    return { status: "error", error: "Couldn't verify your membership." };
  }
  if (!myRow || myRow.role !== "lead") {
    return { status: "forbidden", error: "You're not a lead on this project." };
  }

  const { count, error: countErr } = await db
    .from("project_members")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("role", "lead");

  if (countErr) {
    console.error("stepDownFromLead: lead count failed", countErr);
    return { status: "error", error: "Couldn't verify the project's leads." };
  }
  if ((count ?? 0) <= 1) {
    return { status: "last_lead", error: "A project must always have at least one lead." };
  }

  const { error } = await db
    .from("project_members")
    .update({ role: "member" })
    .eq("id", myRow.id);

  if (error) {
    // The trigger's own rejection lands here too (e.g. a race with another
    // concurrent step-down) — Postgres reports it as a plain update error,
    // not a distinct code worth special-casing; the message already says
    // enough ("A project must always have at least one lead.").
    console.error("stepDownFromLead: update failed", error);
    return { status: "error", error: "Couldn't step down. Please try again." };
  }

  return { status: "ok" };
}

// ── proposal ─────────────────────────────────────────────────────────────────

const MAX_PROPOSAL_FILE_BYTES = 50 * 1024 * 1024; // 50 MB, per the form's own copy
const ALLOWED_PROPOSAL_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/zip",
  "application/x-zip-compressed",
]);

/** Keep only the basename and a conservative character set. The upload path
 *  is `<project_id>/<this>` — sanitizing here is what stops a crafted file
 *  name from writing outside the project's own storage folder or breaking
 *  the (storage.foldername(name))[1] parsing the bucket's RLS policies key
 *  off (database/migrations/2026-08-04_projects_storage.sql). */
function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() || "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return (cleaned || "file").slice(0, 150);
}

/** Upload a proposal file to the project's folder in the private
 *  project-proposals bucket, OVERWRITING any previous upload for this
 *  project (upsert: true). There is exactly one active proposal file per
 *  project (project_proposals.file_path is a single column, not a list),
 *  so keeping the path fixed at `<project_id>/<original filename>` — rather
 *  than a fresh random name per upload — means a revised upload replaces
 *  the old file instead of orphaning it, AND lets the UI show the real
 *  filename without a column this table doesn't have.
 *
 *  Returns null (never throws) on anything not usable — an upload failure
 *  must not block saving the text fields, same stance as
 *  lib/server/showcase.ts:uploadImage(). */
async function uploadProposalFile(
  db: Db,
  projectId: string,
  file: File
): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_PROPOSAL_FILE_BYTES) return null;
  if (!ALLOWED_PROPOSAL_TYPES.has(file.type)) return null;

  const path = `${projectId}/${sanitizeFileName(file.name)}`;

  const { error } = await db.storage
    .from(PROPOSALS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true });

  if (error) {
    console.error("uploadProposalFile: upload failed", error);
    return null;
  }

  return path;
}

/** Create or update the project's proposal draft. ANY MEMBER may call this
 *  (matches "Project proposals: member insert/update" RLS) — only
 *  submitProposal() below is lead-gated. Blocked once submitted, or once
 *  the deadline has passed, per the spec: "editable until submitted or the
 *  deadline passes." Both checks are server-side; nothing here trusts a
 *  client's own idea of whether the deadline has passed.
 *
 *  `file` is optional — omit it (or pass null) to update text fields only
 *  and leave file_path exactly as it was. */
export async function upsertProposal(
  projectId: string,
  input: { title?: string; category?: string; summary?: string },
  file?: File | null
): Promise<UpsertProposalResult> {
  const { db } = await requireCurrentUser();

  const gate = await loadProjectGate(db, projectId);
  if (!gate) return { status: "error", error: "Project not found." };

  if (deadlineHasPassed(gate.deadline)) {
    return {
      status: "error",
      error: "The deadline for this project has passed — the proposal can no longer be edited.",
    };
  }

  const { data: existing, error: existingErr } = await db
    .from("project_proposals")
    .select("id, submitted_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingErr) {
    console.error("upsertProposal: lookup failed", existingErr);
    return { status: "error", error: "Couldn't load the current proposal." };
  }
  if (existing?.submitted_at) {
    return {
      status: "error",
      error: "This proposal has already been submitted and can no longer be edited.",
    };
  }

  // Uploaded AFTER the submitted/deadline checks above, and only once we
  // know we're actually going to write — no point spending a storage call
  // on a save that's about to be rejected anyway.
  const uploaded = file ? await uploadProposalFile(db, projectId, file) : null;

  const fields = {
    title: input.title?.trim() || null,
    category: input.category?.trim() || null,
    summary: input.summary?.trim() || null,
  };

  if (existing) {
    // Inserter/updater is already a project member (requireCurrentUser +
    // the gate check above), so this row already satisfies the SELECT
    // policy the RETURNING half of an update would need — same reasoning
    // as addProjectMember, no bootstrapping problem here either.
    const patch: Record<string, unknown> = { ...fields };
    if (uploaded) patch.file_path = uploaded;

    const { error } = await db.from("project_proposals").update(patch).eq("id", existing.id);
    if (error) {
      console.error("upsertProposal: update failed", error);
      return { status: "error", error: "Couldn't save the proposal." };
    }
  } else {
    const { error } = await db.from("project_proposals").insert({
      project_id: projectId,
      ...fields,
      file_path: uploaded,
    });
    if (error) {
      console.error("upsertProposal: insert failed", error);
      return { status: "error", error: "Couldn't save the proposal." };
    }
  }

  return { status: "ok" };
}

/** Submit the proposal — sets submitted_at. ANY LEAD, not creator-only.
 *  Deleting a project is destructive and irreversible (everyone's work,
 *  gone) — that stays creator-only, see deleteProject() below. Submitting
 *  a proposal is operational, not destructive: if the creator is
 *  unreachable the week of the deadline, a co-lead being unable to submit
 *  is exactly the failure co-leads exist to prevent. Only before the
 *  deadline, still. Both are checked here because RLS cannot express
 *  either: "Project proposals: member update" lets any member write
 *  submitted_at just as freely as title/category/summary (it is, after
 *  all, the same UPDATE policy on the same row), and RLS has no concept of
 *  "now" to compare against projects.deadline at all. A client-side
 *  deadline check is a courtesy for the UI; this is the actual rule. */
export async function submitProposal(projectId: string): Promise<SubmitProposalResult> {
  const { user, db } = await requireCurrentUser();

  const gate = await loadProjectGate(db, projectId);
  if (!gate) return { status: "error", error: "Project not found." };

  if (!(await isCallerLead(db, projectId, user.id))) {
    return { status: "forbidden", error: "Only a project lead can submit the proposal." };
  }

  if (deadlineHasPassed(gate.deadline)) {
    return {
      status: "deadline_passed",
      error: "The deadline has passed — this proposal can no longer be submitted.",
    };
  }

  const { data: existing, error: existingErr } = await db
    .from("project_proposals")
    .select("id, submitted_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingErr) {
    console.error("submitProposal: lookup failed", existingErr);
    return { status: "error", error: "Couldn't load the proposal." };
  }
  if (!existing) {
    return { status: "error", error: "Add proposal details before submitting." };
  }
  if (existing.submitted_at) return { status: "ok" }; // already submitted — idempotent

  const { error } = await db
    .from("project_proposals")
    .update({ submitted_at: new Date().toISOString() })
    .eq("id", existing.id);

  if (error) {
    console.error("submitProposal: update failed", error);
    return { status: "error", error: "Couldn't submit the proposal." };
  }

  return { status: "ok" };
}

/** A short-lived signed URL for a proposal file — the bucket is private, so
 *  file_path alone is never viewable. The `path.startsWith` check is
 *  defense-in-depth, not the gate: the real one is
 *  "project_proposals_member_select" on storage.objects (see
 *  2026-08-04_projects_storage.sql), which createSignedUrl() itself is
 *  subject to via the request-scoped client — a non-member's call fails at
 *  Supabase Storage regardless of what path they ask for. */
export async function getProposalFileUrl(
  projectId: string,
  path: string
): Promise<SignedUrlResult> {
  const db = await getDb();
  if (!db) return { status: "error", error: "Service not configured." };

  if (!path.startsWith(`${projectId}/`)) {
    return { status: "error", error: "Invalid file path." };
  }

  const { data, error } = await db.storage
    .from(PROPOSALS_BUCKET)
    .createSignedUrl(path, 60 * 10); // 10 minutes — long enough to view/download once

  if (error || !data?.signedUrl) {
    console.error("getProposalFileUrl: createSignedUrl failed", error);
    return { status: "error", error: "Couldn't generate a link to that file." };
  }

  return { status: "ok", url: data.signedUrl as string };
}

// ── checklist ────────────────────────────────────────────────────────────────
//
// ANY MEMBER may add/edit/reorder/change-status/delete — unlike Team and
// Proposal, nothing here is lead-gated. "Checklist items: member *" RLS
// (2026-08-04_projects.sql) already permits exactly this for every command,
// so these functions don't add an extra permission check the way
// addProjectMember()/removeProjectMember() do for lead-only actions —
// requireCurrentUser() + RLS is the whole gate.

const CHECKLIST_STATUSES: readonly ChecklistStatus[] = ["not_yet", "in_progress", "ready"];

/** Add an item at the end of the list (max existing position + 1, or 0 for
 *  the first item). */
export async function addChecklistItem(
  projectId: string,
  label: string
): Promise<AddChecklistItemResult> {
  const { user, db } = await requireCurrentUser();

  const trimmed = label.trim();
  if (!trimmed) return { status: "error", error: "A checklist item needs a label." };

  const { data: lastRow, error: lastErr } = await db
    .from("checklist_items")
    .select("position")
    .eq("project_id", projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastErr) {
    console.error("addChecklistItem: position lookup failed", lastErr);
    return { status: "error", error: "Couldn't add that item." };
  }
  const nextPosition = ((lastRow?.position as number | undefined) ?? -1) + 1;

  // Classify BEFORE the insert so matched_capabilities can ride along in
  // one write, rather than an insert followed by a second update. Never
  // throws — see classifyChecklistItem's own "safe fallback" contract: a
  // classification hiccup here degrades to [] (Ask for help), it never
  // blocks or fails the add itself.
  const trimmedLabel = trimmed.slice(0, 300);
  const { capabilities: matchedCapabilities, classificationFailed } =
    await classifyChecklistItem(trimmedLabel);

  const { data, error } = await db
    .from("checklist_items")
    .insert({
      project_id: projectId,
      label: trimmedLabel,
      position: nextPosition,
      updated_by: user.id,
      matched_capabilities: matchedCapabilities,
    })
    .select("id, label, status, position, updated_at, matched_capabilities")
    .single();

  if (error || !data) {
    console.error("addChecklistItem: insert failed", error);
    return { status: "error", error: "Couldn't add that item." };
  }

  return {
    status: "ok",
    item: {
      id: data.id as string,
      label: data.label as string,
      status: data.status as ChecklistStatus,
      position: data.position as number,
      updated_at: data.updated_at as string,
      // Brand new — no Collaborate post can exist for an item that didn't
      // exist a moment ago.
      collab_post_id: null,
      collab_post_responses: 0,
      collab_post_title: null,
      matched_capabilities: Array.isArray(data.matched_capabilities)
        ? (data.matched_capabilities as string[])
        : [],
    },
    classificationFailed,
  };
}

/** Change an item's status (Not yet / In progress / Ready). The CLIENT does
 *  the optimistic UI update; this is what makes it real or reverts it — see
 *  ChecklistSection.tsx for the revert-on-failure side. */
export async function updateChecklistItemStatus(
  projectId: string,
  itemId: string,
  status: ChecklistStatus
): Promise<ChecklistWriteResult> {
  const { user, db } = await requireCurrentUser();

  if (!CHECKLIST_STATUSES.includes(status)) {
    return { status: "error", error: "Invalid status." };
  }

  const { error } = await db
    .from("checklist_items")
    .update({ status, updated_by: user.id })
    .eq("id", itemId)
    .eq("project_id", projectId);

  if (error) {
    console.error("updateChecklistItemStatus: update failed", error);
    return { status: "error", error: "Couldn't update that item." };
  }
  return { status: "ok" };
}

/** Edit an item's label. Re-classifies against the capability vocabulary
 *  (same as addChecklistItem — see classifyChecklistItem's own docstring
 *  for why this runs here, once, rather than at read/click time): a
 *  re-worded item may now match a service capability it didn't before, or
 *  stop matching one it used to. Never blocks the rename on a
 *  classification failure — that degrades to [] (Ask for help), same safe
 *  fallback as everywhere else in this feature. */
export async function updateChecklistItemLabel(
  projectId: string,
  itemId: string,
  label: string
): Promise<UpdateChecklistLabelResult> {
  const { user, db } = await requireCurrentUser();

  const trimmed = label.trim();
  if (!trimmed) return { status: "error", error: "A checklist item needs a label." };

  const trimmedLabel = trimmed.slice(0, 300);
  const { capabilities: matchedCapabilities, classificationFailed } =
    await classifyChecklistItem(trimmedLabel);

  const { error } = await db
    .from("checklist_items")
    .update({
      label: trimmedLabel,
      updated_by: user.id,
      matched_capabilities: matchedCapabilities,
    })
    .eq("id", itemId)
    .eq("project_id", projectId);

  if (error) {
    console.error("updateChecklistItemLabel: update failed", error);
    return { status: "error", error: "Couldn't rename that item." };
  }
  return { status: "ok", matched_capabilities: matchedCapabilities, classificationFailed };
}

/** Move an item up or down one position, swapping with its neighbor. Moving
 *  past either end is a no-op (not an error) — there's nowhere further for
 *  the top item to go up, or the bottom item to go down. */
export async function moveChecklistItem(
  projectId: string,
  itemId: string,
  direction: "up" | "down"
): Promise<ChecklistWriteResult> {
  const { db } = await requireCurrentUser();

  const { data: items, error } = await db
    .from("checklist_items")
    .select("id, position")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (error || !items) {
    console.error("moveChecklistItem: lookup failed", error);
    return { status: "error", error: "Couldn't reorder the checklist." };
  }

  const rows = items as { id: string; position: number }[];
  const idx = rows.findIndex((i) => i.id === itemId);
  if (idx === -1) return { status: "error", error: "That item no longer exists." };

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= rows.length) return { status: "ok" }; // already at the edge

  const a = rows[idx];
  const b = rows[swapIdx];

  const [r1, r2] = await Promise.all([
    db.from("checklist_items").update({ position: b.position }).eq("id", a.id).eq("project_id", projectId),
    db.from("checklist_items").update({ position: a.position }).eq("id", b.id).eq("project_id", projectId),
  ]);

  if (r1.error || r2.error) {
    console.error("moveChecklistItem: swap failed", r1.error, r2.error);
    return { status: "error", error: "Couldn't reorder the checklist." };
  }
  return { status: "ok" };
}

/** Delete a checklist item. Confirmation lives in the UI; RLS
 *  ("Checklist items: member delete") is the real gate — any member, not
 *  lead-only. collab_posts.checklist_item_id is ON DELETE SET NULL
 *  (2026-08-04_projects.sql), so an attached Collaborate post survives —
 *  it just stops showing as "posted" against an item that no longer
 *  exists. */
export async function deleteChecklistItem(
  projectId: string,
  itemId: string
): Promise<ChecklistWriteResult> {
  const { db } = await requireCurrentUser();

  const { error } = await db
    .from("checklist_items")
    .delete()
    .eq("id", itemId)
    .eq("project_id", projectId);

  if (error) {
    console.error("deleteChecklistItem: delete failed", error);
    return { status: "error", error: "Couldn't delete that item." };
  }
  return { status: "ok" };
}

// ── shared folder ────────────────────────────────────────────────────────────

/** http(s) only — same rule and same reasoning as
 *  lib/server/showcase.ts:safeLink(): a raw user-supplied string rendered
 *  as an href is an XSS vector, and a `javascript:` URL is exactly what
 *  this rejects. Checked HERE, server-side — a browser-side check on the
 *  input is a courtesy, not the rule; a raw PostgREST/curl caller with a
 *  valid session could otherwise write anything into shared_folder_url. */
function safeFolderUrl(v: string): string | null {
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Set or change the shared folder link. ANY MEMBER may call this — RLS
 *  ("Projects: member update") already permits any member to update the
 *  project row, and this is just one more field on it. */
export async function setSharedFolder(
  projectId: string,
  url: string
): Promise<SetSharedFolderResult> {
  const { user, db } = await requireCurrentUser();

  const safe = safeFolderUrl(url);
  if (!safe) {
    return { status: "error", error: "Please paste a valid http:// or https:// link." };
  }

  const setAt = new Date().toISOString();
  const { error } = await db
    .from("projects")
    .update({
      shared_folder_url: safe,
      shared_folder_set_by: user.id,
      shared_folder_set_at: setAt,
    })
    .eq("id", projectId);

  if (error) {
    console.error("setSharedFolder: update failed", error);
    return { status: "error", error: "Couldn't save the folder link." };
  }

  // Best-effort name resolution for the immediate UI update — a lookup
  // failure here still means the link saved fine; the next full load
  // resolves the name normally via getProject().
  let setByName: string | null = null;
  const { data: namesData } = await db.rpc("project_member_names", { project_ids: [projectId] });
  if (Array.isArray(namesData)) {
    const mine = (namesData as { user_id: string; name: string | null }[]).find(
      (n) => n.user_id === user.id
    );
    setByName = mine?.name ?? null;
  }

  return { status: "ok", shared_folder: { url: safe, set_by_name: setByName, set_at: setAt } };
}

// ── project agent digest ──────────────────────────────────────────────────────

export type SaveDigestResult = { status: "ok" } | { status: "error"; error: string };

/** Persist the project agent's digest — called ONLY from
 *  app/api/project-agent/status/route.ts, server-side, once a run's status
 *  poll comes back done with a digest. There is deliberately no client-
 *  reachable action for this: the browser never posts a digest back, it
 *  only ever receives one from the backend via that same route (see this
 *  feature's own spec — "that's a write path we don't need").
 *
 *  ONE ROW PER PROJECT, REPLACED ON EACH RUN: upsert on the project_id
 *  primary key (2026-08-19_project_digests.sql), never an insert that
 *  accumulates history.
 *
 *  ANY MEMBER may call this — same "any member" gate as checklist writes,
 *  enforced by RLS ("Project digests: member insert/update"), not an
 *  app-layer isCallerLead check; running the agent isn't lead-gated either.
 *  A caller who isn't a member gets a normal RLS-denied write (0 rows
 *  affected / a 42501), which surfaces here as a plain error result — this
 *  function does not itself re-verify membership, exactly like
 *  addChecklistItem() above relies on "Checklist items: member insert".
 *
 *  BEST-EFFORT BY DESIGN: the caller (the status route) MUST treat any
 *  non-"ok" result as "log it, still return the run's result to the
 *  client" — persistence is a convenience, not a dependency. A failed save
 *  must never fail or even delay the agent run itself. */
export async function saveProjectDigest(
  projectId: string,
  digest: { markdown: string; generated_at: string; counts: Record<string, number>; goal_text: string }
): Promise<SaveDigestResult> {
  const { db } = await requireCurrentUser();

  const { error } = await db
    .from("project_digests")
    .upsert(
      {
        project_id: projectId,
        markdown: digest.markdown,
        generated_at: digest.generated_at,
        counts: digest.counts,
        goal_text: digest.goal_text,
      },
      { onConflict: "project_id" }
    );

  if (error) {
    console.error("saveProjectDigest: upsert failed", error);
    return { status: "error", error: "Couldn't save the digest." };
  }
  return { status: "ok" };
}

// ── delete ───────────────────────────────────────────────────────────────────

/** Delete a project as its CREATOR — not any lead, even after
 *  2026-08-08_project_co_leads.sql made everything else "any lead can".
 *  Promoting a collaborator to co-lead must never hand them the power to
 *  destroy a submitted proposal, so this checks projects.lead_id
 *  specifically (via is_project_creator() in RLS, gate.creatorId here),
 *  not is_project_lead(). Same pattern as
 *  lib/server/collab.ts:deleteCollabPost and
 *  lib/server/showcase.ts:deleteShowcaseEntry otherwise — session-derived
 *  user, .eq() on id (plus lead_id as belt-and-suspenders, matching those
 *  two's owner_id check), RLS ("Projects: lead delete", now
 *  is_project_creator()) as the real gate. A non-creator's call — even a
 *  co-lead's — matches zero rows silently, same as those two functions'
 *  own forged-caller case.
 *
 *  The database's ON DELETE CASCADE (2026-08-04_projects.sql) removes
 *  project_members, checklist_items and the project_proposals row for
 *  free. It does NOT remove a proposal FILE from storage — that's a
 *  separate lifecycle (storage.objects), same gap deleteShowcaseEntry
 *  handles for showcase-images.
 *
 *  STORAGE CLEANUP RUNS BEFORE THE ROW DELETE HERE — the opposite order
 *  from deleteShowcaseEntry, and worth being explicit about why: this
 *  bucket's RLS ("project_proposals_member_delete" on storage.objects,
 *  2026-08-04_projects_storage.sql) gates the delete on
 *  is_project_member(project_id, auth.uid()) — a DB lookup against
 *  project_members. showcase-images' delete policy gates on the uid
 *  embedded IN THE PATH ITSELF and needs no such lookup. Verified this the
 *  hard way: deleting the project row first (matching showcase's order
 *  literally) cascades away every project_members row for it, including
 *  the creator's own — so by the time the storage delete ran,
 *  is_project_member() was already false for the very caller who just
 *  deleted their own project, and the storage delete silently no-op'd (no
 *  error, file left behind). Cleaning up storage FIRST, while the caller
 *  is still a real member of a project that still exists, is what makes
 *  it actually succeed. The spirit of "log rather than throw, so a
 *  cleanup failure can't block the delete" is preserved either way — only
 *  the ordering changed, and only because this bucket's policy needed it
 *  to.
 *
 *  ONE MORE THING THAT ORDERING CHANGE OPENS UP: the storage delete policy
 *  checks MEMBERSHIP, not CREATORSHIP — so doing it before the
 *  projects-row delete (which is where creatorship actually gets
 *  enforced, via .eq("lead_id", user.id) + RLS) would let any non-creator
 *  MEMBER (including a co-lead!) delete the proposal file by calling this
 *  function, even though their attempt on the project row itself would
 *  then fail. That's a real gap a member shouldn't get just because
 *  storage now runs first — closed below with an explicit creator check
 *  (loadProjectGate) BEFORE touching storage at all, not left for the row
 *  delete to catch after the fact. */
export async function deleteProject(projectId: string): Promise<DeleteProjectResult> {
  const { user, db } = await requireCurrentUser();

  const gate = await loadProjectGate(db, projectId);
  if (!gate) return { status: "error", error: "Couldn't delete the project." };
  if (gate.creatorId !== user.id) {
    return { status: "error", error: "Couldn't delete the project." };
  }

  const { data: proposalRow } = await db
    .from("project_proposals")
    .select("file_path")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const filePath = (proposalRow?.file_path as string | null) ?? null;

  if (filePath) {
    const { error: storageError } = await db.storage.from(PROPOSALS_BUCKET).remove([filePath]);
    if (storageError) {
      console.error("deleteProject: proposal file cleanup failed", storageError, filePath);
    }
  }

  const { data: deleted, error } = await db
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("lead_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("deleteProject: delete failed", error);
    return { status: "error", error: "Couldn't delete the project." };
  }
  if (!deleted) {
    // RLS silently matched zero rows — not the lead, or the project
    // doesn't exist. Same non-distinction as GetProjectResult's
    // "not_found": telling the two apart isn't this function's call to make.
    return { status: "error", error: "Couldn't delete the project." };
  }

  return { status: "ok" };
}
