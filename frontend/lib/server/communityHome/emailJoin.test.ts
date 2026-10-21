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
