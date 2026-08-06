-- =============================================================================
-- Migration: project_co_leads  (2026-08-08)
-- =============================================================================
-- Adds co-leads to projects. project_members.role already allows 'lead' or
-- 'member' (2026-08-04_projects.sql), so multiple lead rows were already
-- possible — but is_project_lead() checked projects.lead_id, a single
-- column, so the two disagreed. This migration makes them agree, and adds
-- the promote/demote/step-down rules a second lead actually needs.
--
-- THE RULES THIS ENCODES
--   - Any lead can promote a member to lead.
--   - Any lead can remove a MEMBER.
--   - A lead can NOT remove another lead.
--   - A lead can NOT demote another lead.
--   - A lead CAN step down to member themselves, unless they are the last
--     lead. A project must always have at least one lead.
--   - Project DELETE stays with the CREATOR only (projects.lead_id) — not
--     any lead. Promoting a collaborator must not hand them the ability to
--     destroy a submitted proposal.
--
-- RIPPLE EFFECT, worth being explicit about: is_project_lead() is also what
-- "Project proposals: lead delete" (deleting the DRAFT PROPOSAL ROW, not the
-- project) is built on. Changing is_project_lead()'s meaning to "any lead"
-- means any lead can now delete that draft row too — smaller blast radius
-- than deleting the whole project, and consistent with "any lead" being the
-- new general rule everywhere except the one explicit carve-out above
-- (project deletion, which now uses the new is_project_creator() instead).
-- Proposal SUBMISSION is a separate, unaffected app-layer check in
-- lib/server/projects.ts:submitProposal() — it compares against
-- projects.lead_id directly, not is_project_lead(), and this migration does
-- not touch it. Whether co-leads should also be able to submit isn't one of
-- the rules stated for this task, so it deliberately stays creator-only;
-- flagging this as a decision, not an oversight.
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

-- =============================================================================
-- 1. is_project_lead() — now checks project_members.role = 'lead', not
--    projects.lead_id. Same signature, so CREATE OR REPLACE works without a
--    DROP. Every existing caller (project_members insert/delete,
--    project_proposals delete) automatically picks up "any lead" — that's
--    the point.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_project_lead(p_project_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.project_members pm
        WHERE pm.project_id = p_project_id
          AND pm.user_id = p_uid
          AND pm.role = 'lead'
    );
$$;

-- =============================================================================
-- 2. is_project_creator() — the OLD body of is_project_lead(): checks
--    projects.lead_id specifically. This is what project deletion now uses,
--    so promoting a co-lead never hands them delete power.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_project_creator(p_project_id UUID, p_uid UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.projects p
        WHERE p.id = p_project_id
          AND p.lead_id = p_uid
    );
$$;

DROP POLICY IF EXISTS "Projects: lead delete" ON public.projects;
CREATE POLICY "Projects: lead delete"
    ON public.projects FOR DELETE
    USING (public.is_project_creator(id, auth.uid()));

-- =============================================================================
-- 3. project_members DELETE — "any lead can remove a MEMBER, never a lead"
--    is fully expressible in RLS: gate on the caller being a lead AND the
--    TARGET ROW's own role already being 'member'. A lead row can now never
--    be deleted via this policy at all, self or otherwise — stepping down
--    is a role UPDATE (below), not a delete. That also makes the app-layer
--    "a lead can't remove themselves" check that used to live in
--    lib/server/projects.ts:removeProjectMember() structurally redundant —
--    the database no longer allows deleting a lead row under ANY caller.
-- =============================================================================

DROP POLICY IF EXISTS "Project members: lead delete" ON public.project_members;
CREATE POLICY "Project members: lead delete"
    ON public.project_members FOR DELETE
    USING (
        public.is_project_lead(project_id, auth.uid())
        AND role = 'member'
    );

-- =============================================================================
-- 4. project_members UPDATE — role changes. No UPDATE policy existed on
--    this table before now.
--
--    USING (evaluated against the OLD row, i.e. "may the caller touch this
--    row at all"): the caller must be A lead of the project. A plain
--    member can't reach this policy at all, which is exactly "no controls
--    for non-leads" — matches TeamSection's own UI rule.
--
--    WITH CHECK (evaluated against the proposed NEW row, i.e. "is the
--    result allowed"):
--      - NEW.role = 'lead'                        -> promotion. Any lead
--        may promote ANY member (including a pending, not-yet-linked one,
--        though the app only offers this for linked members — nothing
--        stops a lead from promoting a pending row at the SQL layer, this
--        policy has no opinion on that).
--      - NEW.role = 'member' AND NEW.user_id = caller -> a lead stepping
--        down, and ONLY over their own row. This is what makes "a lead
--        can NOT demote another lead" hold at the database layer: a lead
--        attempting to flip someone ELSE's row to 'member' fails the
--        WITH CHECK (their user_id isn't the caller's), so the whole
--        UPDATE statement is rejected — Postgres does not silently skip
--        the disallowed row, it errors the statement.
--
--    WHAT RLS CANNOT EXPRESS HERE, AND WHY (per the task's own ask to say
--    so plainly): the LAST-LEAD GUARD. "Unless they are the last lead"
--    requires counting sibling rows (other role='lead' rows for the same
--    project) at the moment of the demotion — a well-formed check
--    conceptually, but not something a USING/WITH CHECK clause on THIS row
--    can safely express without either re-implementing counting logic
--    prone to races, or leaning on a subquery whose visibility already
--    depends on the very RLS this policy is part of. This is exactly the
--    kind of invariant Postgres recommends a CONSTRAINT TRIGGER or a plain
--    per-row BEFORE trigger for instead of RLS — see enforce_min_one_lead()
--    below, which is what actually enforces it, checked EVERY time a
--    demotion is attempted regardless of caller (RLS role, service_role,
--    raw PostgREST, anything), not just from this app's UI.
-- =============================================================================

DROP POLICY IF EXISTS "Project members: promote or self-demote" ON public.project_members;
CREATE POLICY "Project members: promote or self-demote"
    ON public.project_members FOR UPDATE
    USING (public.is_project_lead(project_id, auth.uid()))
    WITH CHECK (
        role = 'lead'
        OR (role = 'member' AND user_id = auth.uid())
    );

-- =============================================================================
-- 5. THE LAST-LEAD GUARD — a BEFORE UPDATE trigger, not an RLS policy and
--    not just an app check. Chosen over an app-only check specifically
--    because the app check would NOT hold against a raw PostgREST call
--    that skips this codebase entirely; a trigger fires on every UPDATE to
--    this table regardless of what issued it. Chosen over trying to force
--    it into RLS because RLS's WITH CHECK evaluates ONE proposed row at a
--    time — it has no clean way to say "and also, count how many OTHER
--    rows for this project still have role='lead' after this one changes,"
--    without real risk of getting the concurrency semantics wrong.
--
--    SECURITY DEFINER so its own COUNT query is never itself subject to
--    the RLS it's trying to enforce a guarantee underneath — same
--    reasoning as is_project_member()/is_project_lead() being SECURITY
--    DEFINER in the first place.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_min_one_lead()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
AS $$
BEGIN
    IF OLD.role = 'lead' AND NEW.role = 'member' THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.project_members
            WHERE project_id = OLD.project_id
              AND role = 'lead'
              AND id <> OLD.id
        ) THEN
            RAISE EXCEPTION 'A project must always have at least one lead.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_min_one_lead ON public.project_members;
CREATE TRIGGER trg_enforce_min_one_lead
    BEFORE UPDATE ON public.project_members
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_min_one_lead();

-- =============================================================================
-- 6. EXPLICIT REVOKES. Supabase's project-wide default privileges grant
--    EXECUTE on every newly created function to `anon` (and `authenticated`)
--    at CREATE TIME, via a project-level ALTER DEFAULT PRIVILEGES rule that
--    predates any of these migrations. `REVOKE ALL ... FROM PUBLIC` — the
--    pattern used everywhere else in this codebase so far — only revokes
--    the PUBLIC pseudo-role's own grant; it does NOT touch a grant already
--    made directly to `anon` by that default-privileges rule. Verified this
--    empirically on project_member_names() (2026-08-07): anon could still
--    call it and get `200 []`, execution ALLOWED, not permission-denied,
--    despite that migration's own "FROM PUBLIC" revoke. Fixed here for both
--    functions this migration touches by revoking from `anon` explicitly,
--    not just `PUBLIC`.
--
--    KNOWN TRADE-OFF: an anon (signed-out) caller attempting a mutation
--    that would evaluate one of these functions inside a policy (e.g. a
--    raw DELETE on `projects`) now gets a Postgres "permission denied for
--    function" error instead of RLS's usual clean "matched nothing."
--    Either way anon cannot perform the action — this only changes the
--    shape of the failure, and there is no legitimate anon UI path that
--    would ever trigger it, so an ugly permission error here is an
--    acceptable, arguably clearer, outcome.
--
--    NOTE: is_project_member() and project_member_names() are NOT re-
--    granted here — neither is new or replaced by this migration, so both
--    are out of this migration's stated scope. Both likely carry the same
--    anon-default-grant gap today and are worth a follow-up migration of
--    their own; flagging rather than silently fixing them as a drive-by.
-- =============================================================================

REVOKE ALL ON FUNCTION public.is_project_lead(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_lead(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_project_lead(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.is_project_creator(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_creator(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_project_creator(UUID, UUID) TO authenticated;

-- Not meant to be called directly at all (it only ever fires as a trigger),
-- but revoked explicitly anyway for the same hygiene reason as the two
-- above — nothing should be able to invoke it as an RPC.
REVOKE ALL ON FUNCTION public.enforce_min_one_lead() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_min_one_lead() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_min_one_lead() FROM authenticated;
