// Run with `npm test`. The email-join rules: the pure layer in emailJoin.ts,
// plus checks that the migration's SQL function enforces what the app assumes
// (the SQL can't run here, so these read the file).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EMAIL_PATTERN,
  JOINED_MESSAGE,
  normalizeJoinEmail,
  runEmailJoin,
} from "./emailJoin.ts";
import { createRateLimiter } from "../rateLimit.ts";

// ── email validation ─────────────────────────────────────────────────────────

test("normalizeJoinEmail: trims and lowercases", () => {
  assert.deepEqual(normalizeJoinEmail("  Ada.Lovelace@Example.ORG "), { ok: true, email: "ada.lovelace@example.org" });
});

test("normalizeJoinEmail: rejects empty, malformed and over-long addresses", () => {
  for (const bad of ["", "   ", "nope", "a@b", "a@@b.com", "a b@c.com", "a@b..com", "@x.com", "a@x.c", undefined, null, 42]) {
    assert.equal(normalizeJoinEmail(bad).ok, false, String(bad));
  }
  assert.equal(normalizeJoinEmail("a".repeat(250) + "@x.com").ok, false);
});

// ── the flow ─────────────────────────────────────────────────────────────────

const answer = (data: unknown, error: unknown = null) => async () => ({ data, error });

test("runEmailJoin: a good email on an open community joins", async () => {
  let seen: [string, string] | null = null;
  const res = await runEmailJoin({
    communityId: "c1",
    email: "Person@Example.org",
    ip: "1.1.1.1",
    limiter: createRateLimiter(1000, 5),
    rpc: async (id, email) => {
      seen = [id, email];
      return { data: "joined", error: null };
    },
  });
  assert.deepEqual(res, { ok: true, message: JOINED_MESSAGE });
  assert.deepEqual(seen, ["c1", "person@example.org"], "the function gets the lowercased email");
});

test("runEmailJoin: an existing member looks exactly like a new one", async () => {
  const res = await runEmailJoin({ communityId: "c1", email: "a@b.org", ip: "x", limiter: createRateLimiter(1000, 5), rpc: answer("already_member") });
  assert.deepEqual(res, { ok: true, message: JOINED_MESSAGE });
});

test("runEmailJoin: a request-to-join community is refused", async () => {
  const res = await runEmailJoin({ communityId: "c1", email: "a@b.org", ip: "x", limiter: createRateLimiter(1000, 5), rpc: answer("not_open") });
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.reason, "closed");
});

test("runEmailJoin: a bad email never reaches the database", async () => {
  let called = false;
  const res = await runEmailJoin({
    communityId: "c1",
    email: "not-an-email",
    ip: "x",
    limiter: createRateLimiter(1000, 5),
    rpc: async () => {
      called = true;
      return { data: "joined", error: null };
    },
  });
  assert.equal(!res.ok && res.reason, "invalid");
  assert.equal(called, false);
});

test("runEmailJoin: rate limited per IP, other IPs unaffected", async () => {
  const limiter = createRateLimiter(60_000, 3);
  const go = (ip: string) => runEmailJoin({ communityId: "c1", email: "a@b.org", ip, limiter, rpc: answer("joined") });
  for (let i = 0; i < 3; i++) assert.equal((await go("9.9.9.9")).ok, true);
  const blocked = await go("9.9.9.9");
  assert.equal(!blocked.ok && blocked.reason, "rate_limited");
  assert.equal((await go("8.8.8.8")).ok, true);
});

test("runEmailJoin: invalid attempts count against the limit too", async () => {
  const limiter = createRateLimiter(60_000, 2);
  const bad = () => runEmailJoin({ communityId: "c1", email: "x", ip: "z", limiter, rpc: answer("joined") });
  await bad();
  await bad();
  const third = await bad();
  assert.equal(!third.ok && third.reason, "rate_limited");
});

test("runEmailJoin: a database error or a throw becomes a plain error", async () => {
  const a = await runEmailJoin({ communityId: "c1", email: "a@b.org", ip: "q1", limiter: createRateLimiter(1000, 5), rpc: answer(null, { code: "x" }) });
  assert.equal(!a.ok && a.reason, "error");
  const b = await runEmailJoin({
    communityId: "c1",
    email: "a@b.org",
    ip: "q2",
    limiter: createRateLimiter(1000, 5),
    rpc: async () => {
      throw new Error("down");
    },
  });
  assert.equal(!b.ok && b.reason, "error");
});

// ── the SQL function's rules ────────────────────────────────────────────────

const sql = readFileSync(new URL("../../../../database/migrations/2026-10-23_community_email_join_checklist.sql", import.meta.url), "utf8");
const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.join_open_community_by_email"), sql.indexOf("-- ── community_member_progress"));

test("join function: only when the community is open", () => {
  assert.match(fn, /SELECT c\.is_open INTO v_open/);
  assert.match(fn, /IF v_open IS NOT TRUE THEN\s+RETURN 'not_open'/);
});

test("join function: never makes anyone admin or lead, and inserts only an active member", () => {
  const insert = fn.slice(fn.indexOf("INSERT INTO"), fn.indexOf("DO NOTHING"));
  assert.match(insert, /'member', 'active', false/);
  assert.doesNotMatch(insert, /admin|lead/);
  assert.doesNotMatch(fn, /p_role|p_status/, "role and status are not parameters");
});

test("join function: lowercases the email, ignores duplicates, marks the row unverified", () => {
  assert.match(fn, /lower\(btrim\(COALESCE\(p_email, ''\)\)\)/);
  assert.match(fn, /ON CONFLICT \(community_id, lower\(email\)\) WHERE email IS NOT NULL\s+DO NOTHING/);
  assert.match(fn, /RETURN 'already_member'/);
  assert.match(sql, /email_verified BOOLEAN NOT NULL DEFAULT true/);
  assert.match(fn, /VALUES \(p_community_id, NULL, v_email, 'member', 'active', false\)/);
});

test("join function: validates with the same pattern as the app", () => {
  // JS string "\\." is the two characters \. , which is what the SQL has.
  assert.ok(fn.includes(EMAIL_PATTERN), "SQL email pattern matches EMAIL_PATTERN");
  assert.match(fn, /length\(v_email\) > 254/);
});

test("join function: callable by the service role only (no anon, no authenticated)", () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.join_open_community_by_email\(UUID, TEXT\) FROM PUBLIC;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.join_open_community_by_email\(UUID, TEXT\) FROM anon;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.join_open_community_by_email\(UUID, TEXT\) FROM authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.join_open_community_by_email\(UUID, TEXT\) TO service_role;/);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.join_open_community_by_email[^;]*(anon|authenticated)/);
});

test("progress table: only the member can read or write their own row", () => {
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  const policies = sql.match(/CREATE POLICY "Member progress:[\s\S]*?;\r?\n/g) ?? [];
  assert.equal(policies.length, 3);
  for (const p of policies) assert.match(p, /user_id = auth\.uid\(\)/);
  assert.doesNotMatch(sql, /GRANT[^;]*community_member_progress[^;]*\banon\b/);
});

// ── teams: the email join takes a slug, never an id ──────────────────────────

import { runTeamEmailJoin } from "./emailJoin.ts";
import { canEmailJoinAsCommunity } from "../teams/teamRules.ts";

const teamsSql = readFileSync(new URL("../../../../database/migrations/2026-10-28_teams.sql", import.meta.url), "utf8");
const communityFn = teamsSql.slice(
  teamsSql.indexOf("CREATE OR REPLACE FUNCTION public.join_open_community_by_email"),
  teamsSql.indexOf("CREATE OR REPLACE FUNCTION public.join_team_by_email")
);
const teamFn = teamsSql.slice(
  teamsSql.indexOf("CREATE OR REPLACE FUNCTION public.join_team_by_email"),
  teamsSql.indexOf("-- 4. community_members self-insert")
);

test("a team id sent to the community email join is refused (app guard and SQL)", () => {
  assert.equal(canEmailJoinAsCommunity("community"), true);
  assert.equal(canEmailJoinAsCommunity("team"), false);
  assert.equal(canEmailJoinAsCommunity(undefined), false);
  assert.equal(canEmailJoinAsCommunity(null), false);
  // The SQL function keeps its signature and refuses kind = 'team' before anything is written.
  assert.match(communityFn, /join_open_community_by_email\(p_community_id UUID, p_email TEXT\)/);
  assert.match(communityFn, /IF v_kind = 'team' THEN\s+RETURN 'not_found';/);
  assert.ok(communityFn.indexOf("v_kind = 'team'") < communityFn.indexOf("INSERT INTO"), "refused before the insert");
  assert.match(teamsSql, /GRANT EXECUTE ON FUNCTION public\.join_open_community_by_email\(UUID, TEXT\) TO service_role;/);
  assert.doesNotMatch(teamsSql, /GRANT EXECUTE ON FUNCTION public\.join_open_community_by_email[^;]*(anon|authenticated)/);
});

test("the team email join works only with a slug: the database function resolves it, for teams only", () => {
  assert.match(teamFn, /join_team_by_email\(p_slug TEXT, p_email TEXT\)/);
  assert.match(teamFn, /WHERE c\.slug = p_slug AND c\.kind = 'team'/);
  assert.doesNotMatch(teamFn, /p_community_id|p_team_id|UUID,/, "no id parameter");
  assert.match(teamsSql, /REVOKE ALL ON FUNCTION public\.join_team_by_email\(TEXT, TEXT\) FROM anon;/);
  assert.match(teamsSql, /REVOKE ALL ON FUNCTION public\.join_team_by_email\(TEXT, TEXT\) FROM authenticated;/);
  assert.match(teamsSql, /GRANT EXECUTE ON FUNCTION public\.join_team_by_email\(TEXT, TEXT\) TO service_role;/);
  assert.doesNotMatch(teamsSql, /GRANT EXECUTE ON FUNCTION public\.join_team_by_email[^;]*(anon|authenticated)/);
});

test("runTeamEmailJoin: hands the slug (not an id) to the database, validates and limits first", async () => {
  const seen: string[] = [];
  const rpc = async (slug: string, email: string) => (seen.push(`${slug}|${email}`), { data: "joined", error: null });
  const ok = await runTeamEmailJoin({ slug: "kras-a1b2c3", email: " Ada@X.org ", ip: "t1", limiter: createRateLimiter(1000, 5), rpc });
  assert.deepEqual(ok, { ok: true, message: JOINED_MESSAGE });
  assert.deepEqual(seen, ["kras-a1b2c3|ada@x.org"]);

  const none = await runTeamEmailJoin({ slug: "", email: "a@b.org", ip: "t2", limiter: createRateLimiter(1000, 5), rpc });
  assert.equal(none.ok, false);
  const bad = await runTeamEmailJoin({ slug: "s", email: "nope", ip: "t3", limiter: createRateLimiter(1000, 5), rpc });
  assert.equal(!bad.ok && bad.reason, "invalid");
  assert.equal(seen.length, 1, "bad input never reaches the database");

  const lim = createRateLimiter(1000, 1);
  await runTeamEmailJoin({ slug: "s", email: "a@b.org", ip: "t4", limiter: lim, rpc });
  const limited = await runTeamEmailJoin({ slug: "s", email: "a@b.org", ip: "t4", limiter: lim, rpc });
  assert.equal(!limited.ok && limited.reason, "rate_limited");

  const missing = await runTeamEmailJoin({
    slug: "nope",
    email: "a@b.org",
    ip: "t5",
    limiter: createRateLimiter(1000, 5),
    rpc: async () => ({ data: "not_found", error: null }),
  });
  assert.equal(!missing.ok && missing.error, "Team not found.");
});
