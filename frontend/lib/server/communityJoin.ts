// lib/server/communityJoin.ts — the community "join" extras:
//   * admin switch between "anyone can join" and "request to join" (is_open);
//   * email-only join for signed-out visitors of an OPEN community;
//   * the welcome checklist's per-member progress.
// The pure rules live in lib/server/communityHome/ (emailJoin.ts, checklist.ts)
// and are tested there. The database is the real gate for all three
// (2026-10-23_community_email_join_checklist.sql and the existing communities
// "admin update" policy).

import { createClient } from "@supabase/supabase-js";
import { getSession, requireCurrentUser } from "@/lib/auth";
import { getMembership } from "@/lib/server/communities";
import { canEmailJoinAsCommunity, type CommunityKind } from "@/lib/server/teams/teamRules";
import { createRateLimiter } from "@/lib/server/rateLimit";
import {
  EMAIL_JOIN_MAX_PER_IP,
  EMAIL_JOIN_WINDOW_MS,
  runEmailJoin,
  type EmailJoinResult,
} from "@/lib/server/communityHome/emailJoin";
import { cleanProgress, type ChecklistProgress, type TrackedStep } from "@/lib/server/communityHome/checklist";

// ── open vs request to join ─────────────────────────────────────────────────

export type SetOpenResult = { status: "ok" } | { status: "error"; error: string };

/** Switch a community between "anyone can join" (is_open) and "request to
 *  join". Admin only: "Communities: admin update" (RLS) is the real gate, the
 *  getMembership check gives a readable message. Existing members and pending
 *  requests are left exactly as they are. */
export async function updateCommunityIsOpen(communityId: string, isOpen: boolean): Promise<SetOpenResult> {
  const { db } = await requireCurrentUser();

  const membership = await getMembership(communityId);
  if (!membership.isAdmin) {
    return { status: "error", error: "Only a community admin can change who can join." };
  }

  const { error } = await db.from("communities").update({ is_open: isOpen }).eq("id", communityId);
  if (error) {
    console.error("updateCommunityIsOpen: update failed", error);
    return {
      status: "error",
      error: "Couldn't save this setting — this is a server-side problem. Check the server log (code: " + (error.code ?? "unknown") + ").",
    };
  }
  return { status: "ok" };
}

// ── email-only join ─────────────────────────────────────────────────────────

const emailJoinLimiter = createRateLimiter(EMAIL_JOIN_WINDOW_MS, EMAIL_JOIN_MAX_PER_IP);

/** SERVER-ONLY service-role client for the one RPC below, built the same way
 *  as lib/server/pages/pagesDb.ts's (the key is read from process.env, never
 *  NEXT_PUBLIC_, never reaches the browser). The function is granted to
 *  service_role alone so the per-IP limit can't be skipped by calling the RPC
 *  with the public anon key. Null when unconfigured. */
function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Add a visitor to an OPEN community by email: no account, no password. The
 *  database function checks is_open, forces role member, lowercases the email,
 *  ignores duplicates and marks the row unverified. */
export async function joinOpenCommunityByEmail(
  communityId: string,
  email: unknown,
  ip: string,
  /** The kind of the row `communityId` came from. A team is refused here (and
   *  again in the SQL function): teams join only when signed in (join_team). */
  kind: CommunityKind
): Promise<EmailJoinResult> {
  if (!canEmailJoinAsCommunity(kind)) {
    return { ok: false, reason: "error", error: "Community not found." };
  }
  return runEmailJoin({
    communityId,
    email,
    ip,
    limiter: emailJoinLimiter,
    rpc: async (id, normalized) => {
      const db = serviceClient();
      if (!db) throw new Error("service role key not configured");
      return db.rpc("join_open_community_by_email", { p_community_id: id, p_email: normalized });
    },
  });
}

// ── welcome checklist progress ──────────────────────────────────────────────

export type MyOnboarding = {
  /** When this member's row became active (approval time, else join time). */
  joinedAt: string | null;
  focus: string | null;
  progress: ChecklistProgress;
  dismissed: boolean;
  ownsLivingPage: boolean;
};

/** The signed-in member's checklist inputs, or null when there is no session or
 *  the progress table isn't there yet (the migration not applied): the page
 *  then simply doesn't show the checklist. */
export async function getMyOnboarding(communityId: string): Promise<MyOnboarding | null> {
  const session = await getSession();
  if (!session) return null;
  const { user, db } = session;

  const [rowRes, progressRes, pageRes] = await Promise.all([
    db
      .from("community_members")
      .select("requested_at, approved_at, focus")
      .eq("community_id", communityId)
      .eq("user_id", user.id)
      .maybeSingle(),
    db
      .from("community_member_progress")
      .select("steps, dismissed_at")
      .eq("community_id", communityId)
      .eq("user_id", user.id)
      .maybeSingle(),
    db.from("pages").select("slug", { count: "exact", head: true }).eq("owner_id", user.id),
  ]);

  if (rowRes.error || !rowRes.data) return null;
  if (progressRes.error) return null; // table missing: no checklist

  const row = rowRes.data as { requested_at: string | null; approved_at: string | null; focus: string | null };
  const prog = (progressRes.data ?? null) as { steps: unknown; dismissed_at: string | null } | null;
  return {
    joinedAt: row.approved_at ?? row.requested_at,
    focus: row.focus,
    progress: cleanProgress(prog?.steps),
    dismissed: !!prog?.dismissed_at,
    ownsLivingPage: !pageRes.error && (pageRes.count ?? 0) > 0,
  };
}

export type ProgressResult = { status: "ok" } | { status: "error"; error: string };

async function upsertProgress(
  communityId: string,
  build: (current: { steps: Record<string, unknown>; dismissed_at: string | null }) => {
    steps: Record<string, unknown>;
    dismissed_at: string | null;
  }
): Promise<ProgressResult> {
  const { user, db } = await requireCurrentUser();

  const { data, error: readError } = await db
    .from("community_member_progress")
    .select("steps, dismissed_at")
    .eq("community_id", communityId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) {
    console.error("upsertProgress: read failed", readError);
    return { status: "error", error: "Couldn't save your progress." };
  }

  const current = {
    steps: cleanProgress((data as { steps?: unknown } | null)?.steps) as Record<string, unknown>,
    dismissed_at: ((data as { dismissed_at?: string | null } | null)?.dismissed_at ?? null) as string | null,
  };
  const next = build(current);

  const { error } = await db.from("community_member_progress").upsert(
    {
      community_id: communityId,
      user_id: user.id,
      steps: next.steps,
      dismissed_at: next.dismissed_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "community_id,user_id" }
  );
  if (error) {
    console.error("upsertProgress: write failed", error);
    return { status: "error", error: "Couldn't save your progress." };
  }
  return { status: "ok" };
}

/** Records that this member did a tracked step. Own row only (RLS). */
export function recordOnboardingStep(communityId: string, step: TrackedStep): Promise<ProgressResult> {
  return upsertProgress(communityId, (c) => ({ steps: { ...c.steps, [step]: true }, dismissed_at: c.dismissed_at }));
}

/** Hides the checklist for this member. */
export function dismissOnboarding(communityId: string): Promise<ProgressResult> {
  return upsertProgress(communityId, (c) => ({ steps: c.steps, dismissed_at: new Date().toISOString() }));
}
