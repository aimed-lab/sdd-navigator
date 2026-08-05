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
  is_lead: boolean;
  members: ProjectMember[];
  // Null for every project without challenge_key set, AND for a
  // challenge project that hasn't saved any proposal fields yet — both
  // render as "no Proposal section" / "nothing saved yet" to the caller,
  // which is the distinction the Proposal section's own gating (on
  // challenge_key, not on this) actually needs.
  proposal: ProjectProposal | null;
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

export type UpsertProposalResult = { status: "ok" } | { status: "error"; error: string };

export type SubmitProposalResult =
  | { status: "ok" }
  | { status: "forbidden"; error: string }
  | { status: "deadline_passed"; error: string }
  | { status: "error"; error: string };

export type SignedUrlResult = { status: "ok"; url: string } | { status: "error"; error: string };

// Internal only — lead_id and deadline read for a permission/deadline check,
// never returned from an exported function. null covers BOTH "no such
// project" and "not a member" (same RLS-driven ambiguity as GetProjectResult
// above): a plain select on `projects` returns nothing in either case.
async function loadProjectGate(
  db: Db,
  projectId: string
): Promise<{ leadId: string; deadline: string | null } | null> {
  const { data, error } = await db
    .from("projects")
    .select("lead_id, deadline")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data) return null;
  return { leadId: data.lead_id as string, deadline: (data.deadline as string | null) ?? null };
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
    db.from("project_members").select("project_id").in("project_id", ids),
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
  for (const row of (membersRes.data ?? []) as { project_id: string }[]) {
    memberCounts.set(row.project_id, (memberCounts.get(row.project_id) ?? 0) + 1);
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
    // Computed here, from the session — lead_id itself is never returned to
    // the caller of this function, only this yes/no.
    is_lead: row.lead_id === viewer.id,
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
      "id, name, description, lead_id, deadline, challenge_key, target, indication, modality, stage"
    )
    .eq("id", id)
    .maybeSingle();

  if (projectErr) {
    console.error("getProject: projects query failed", projectErr);
    return { status: "error", error: "Couldn't load this project." };
  }
  if (!projectRow) return { status: "not_found" };

  const [membersRes, proposalRes] = await Promise.all([
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
  ]);

  if (membersRes.error) {
    console.error("getProject: project_members query failed", membersRes.error);
    return { status: "error", error: "Couldn't load this project's team." };
  }
  if (proposalRes.error) {
    console.error("getProject: project_proposals query failed", proposalRes.error);
    return { status: "error", error: "Couldn't load this project's proposal." };
  }

  const row = projectRow as Record<string, unknown>;
  const proposalRow = proposalRes.data as Record<string, unknown> | null;

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
      is_lead: row.lead_id === viewer.id,
      members: ((membersRes.data ?? []) as Record<string, unknown>[]).map((m) => ({
        id: m.id as string,
        email: m.email as string,
        user_id: (m.user_id as string | null) ?? null,
        role: m.role as "lead" | "member",
        created_at: m.created_at as string,
      })),
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

/** Add a member by email. LEAD ONLY — enforced twice: the
 *  "Project members: lead insert" RLS policy (the real gate) AND the
 *  explicit lead_id check below, which exists purely to return a clear
 *  { status: "forbidden" } instead of making a non-lead caller decode a raw
 *  42501 from Postgres.
 *
 *  Email is lowercased before insert. The unique index is on
 *  (project_id, lower(email)) — inserting mixed-case would still collide
 *  with an existing lowercase row and fail as a duplicate anyway, just with
 *  a less honest-looking value stored; normalizing here means the stored
 *  value and the constraint agree, and the 23505 case below reads as
 *  "already a member" rather than a raw constraint-name error. */
export async function addProjectMember(
  projectId: string,
  email: string
): Promise<AddMemberResult> {
  const { user, db } = await requireCurrentUser();

  const gate = await loadProjectGate(db, projectId);
  if (!gate) return { status: "error", error: "Project not found." };
  if (gate.leadId !== user.id) {
    return { status: "forbidden", error: "Only the project lead can add members." };
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized) return { status: "error", error: "An email address is required." };

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
    },
  };
}

/** Remove a member. LEAD ONLY, and the lead may not remove themselves — RLS
 *  ("Project members: lead delete") enforces the first half but has no way
 *  to express the second: a lead deleting their OWN project_members row is
 *  a delete they're fully permitted to make, so "can't remove yourself" has
 *  to be a code-level check, done here by comparing the target row's
 *  user_id to the caller's own id before deleting anything. */
export async function removeProjectMember(
  projectId: string,
  memberId: string
): Promise<RemoveMemberResult> {
  const { user, db } = await requireCurrentUser();

  const gate = await loadProjectGate(db, projectId);
  if (!gate) return { status: "error", error: "Project not found." };
  if (gate.leadId !== user.id) {
    return { status: "forbidden", error: "Only the project lead can remove members." };
  }

  const { data: member, error: memberErr } = await db
    .from("project_members")
    .select("id, user_id")
    .eq("id", memberId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (memberErr) {
    console.error("removeProjectMember: lookup failed", memberErr);
    return { status: "error", error: "Couldn't verify that member." };
  }
  if (!member) return { status: "error", error: "That member no longer exists." };

  if (member.user_id === user.id) {
    return { status: "forbidden", error: "The project lead can't remove themselves." };
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

/** Submit the proposal — sets submitted_at. LEAD ONLY, and only before the
 *  deadline. Both are checked here because RLS cannot express either:
 *  "Project proposals: member update" lets any member write submitted_at
 *  just as freely as title/category/summary (it is, after all, the same
 *  UPDATE policy on the same row), and RLS has no concept of "now" to
 *  compare against projects.deadline at all. A client-side deadline check
 *  is a courtesy for the UI; this is the actual rule. */
export async function submitProposal(projectId: string): Promise<SubmitProposalResult> {
  const { user, db } = await requireCurrentUser();

  const gate = await loadProjectGate(db, projectId);
  if (!gate) return { status: "error", error: "Project not found." };

  if (gate.leadId !== user.id) {
    return { status: "forbidden", error: "Only the project lead can submit the proposal." };
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
