// Run with `npm test`. The external agent's tool API: authentication, preview,
// not-found behaviour, rate limiting, logging, and that the published tool list
// matches the endpoints that exist.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAgentCall, type AgentContext, type AgentDeps, type AgentLogEntry } from "./agentCore.ts";
import { makeAgentHandlers, type AgentServices } from "./agentHandlers.ts";
import { isOwnerAccount } from "../pages/pageViewHelpers.ts";
import { shapePage } from "./agentShapes.ts";
import { TOOL_SPECS, validateInput } from "./agentTools.ts";

const ORIGIN = "https://example.test";
// Two different ids per person, as in the real system:
//   LOGIN id   = the JWT sub = auth.uid(); what pages.owner_id and
//                page_members.added_by hold, and what ctx.user.id is.
//   ACCOUNT id = what the email lookup (find_account_id_by_email_for_page)
//                returns and page_members.user_id stores.
// The two are deliberately never equal, so a comparison of one kind against
// the other fails a test instead of passing by accident.
const ALICE = "11111111-aaaa-aaaa-aaaa-111111111111";
const ALICE_ACCT = "11111111-cccc-cccc-cccc-cccccccc4539";
const BOB = "22222222-bbbb-bbbb-bbbb-222222222222";
const BOB_ACCT = "22222222-dddd-dddd-dddd-dddddddd4539";

// ── fakes ────────────────────────────────────────────────────────────────────

type Write = { table: string; op: string };

/** A database stand-in that answers reads for one page and RECORDS any write. */
function fakeDb(page: { owner_id: string; visibility: string } | null) {
  const writes: Write[] = [];
  const db = {
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const op of ["insert", "update", "delete", "upsert"]) {
        b[op] = () => (writes.push({ table, op }), b);
      }
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({
        data:
          table === "pages" && page
            ? { id: "page-1", slug: "egfr-abc12", title: "EGFR", refresh_enabled: true, ...page }
            : table === "page_members"
              ? { user_id: BOB_ACCT, role: "viewer" }
              : null,
        error: null,
      });
      return b;
    },
    rpc: async (_name: string, args: { p_email?: string }) => ({
      data: ({ "bob@x.org": BOB_ACCT, "alice@x.org": ALICE_ACCT } as Record<string, string>)[args.p_email ?? ""] ?? null,
      error: null,
    }),
  };
  return { db, writes };
}

type Calls = string[];

const MEMBERS = [{ user_id: BOB_ACCT, name: "Bob Jones", email: "bob@x.org", role: "viewer" as const }];

// Two communities: one open, one by request. `membersOf` is who is already in what.
const COMMUNITIES = [
  { id: "c-open", slug: "kras-pdac", name: "KRAS in PDAC", purpose: "KRAS in pancreatic cancer", memberCount: 12, isOpen: true, why: ["pancreatic cancer", "KRAS"] },
  { id: "c-closed", slug: "by-request", name: "Private lab group", purpose: "A closed group", memberCount: 4, isOpen: false, why: ["KRAS"] },
];

// Whether the fake caller is a site admin, and the kind the last create asked for.
let FAKE_SITE_ADMIN = false;
let LAST_CREATE_KIND = "";

function fakeCommunities(calls: Calls, membersOf: Record<string, "active" | "pending"> = {}): AgentServices["communities"] {
  return {
    search: async (_db, query, limit) => (calls.push(`communities.search:${query}`), COMMUNITIES.slice(0, limit)),
    find: async (_db, slug) => {
      const c = COMMUNITIES.find((x) => x.slug === slug);
      return c ? { id: c.id, slug: c.slug, name: c.name, isOpen: c.isOpen } : null;
    },
    membership: async (_db, userId, communityId) => membersOf[`${userId}|${communityId}`] ?? null,
    join: async (_db, _user, c) => (calls.push(`communities.join:${c.id}:${c.isOpen ? "active" : "pending"}`), { ok: true, status: c.isOpen ? "active" : "pending" }),
    create: async (_db, name, _purpose, kind) => {
      calls.push(`communities.create:${name}`);
      LAST_CREATE_KIND = kind;
      return { ok: true, id: "new-id", slug: "new-community" };
    },
    isSiteAdmin: async () => FAKE_SITE_ADMIN,
  };
}

const PROJECT_ID = "5b1f6a52-0c1e-4c58-9e0a-3f1d2a9c7b10";

function fakeServices(
  calls: Calls,
  visiblePageFor: (userId: string) => boolean,
  membersOf: Record<string, "active" | "pending"> = {}
): AgentServices {
  const rec = <T,>(name: string, value: T) => async (): Promise<T> => (calls.push(name), value);
  return {
    communities: fakeCommunities(calls, membersOf),
    projects: {
      list: async () => (calls.push("projects.list"), [{ id: PROJECT_ID, name: "CD38 Fibrosis", label: "ColaboFest 2026", challenge_key: null, program: "colabofest_2026", my_role: "lead", team_size: 3 }]),
      status: async (_db: unknown, id: string) => (calls.push("projects.status"), id === PROJECT_ID ? ({ id, project: "CD38 Fibrosis", status: "On track", checklists: [], overdue_items: [], open_help_requests: [], latest_updates: [], wiki_pages: [] } as never) : null),
    },
    listMyPages: rec("listMyPages", { status: "ok", pages: [] }),
    getPageView: (async (_slug: string, ctx?: { user: { id: string } }) => {
      calls.push("getPageView");
      if (!ctx || !visiblePageFor(ctx.user.id)) return { status: "not_found" };
      return {
        status: "ok",
        view: {
          page: { id: "page-1", slug: "egfr-abc12", title: "EGFR", created_at: null, visibility: "private", refresh_enabled: true, last_refreshed_at: null },
          viewer: { signedIn: true, isOwner: ctx.user.id === ALICE, role: ctx.user.id === ALICE ? "owner" : "viewer" },
          notes: [],
          evidence: [],
          updates: [],
          members: [],
        },
      };
    }) as unknown as AgentServices["getPageView"],
    createLivingPage: rec("createLivingPage", { ok: true, pageId: "p", slug: "new-slug", visibility: "private", notes: 1, evidence: 7, references: [], citationReport: null }) as unknown as AgentServices["createLivingPage"],
    addPageMember: rec("addPageMember", { status: "ok", member: { page_id: "p", user_id: BOB_ACCT, role: "viewer" }, active: true }) as unknown as AgentServices["addPageMember"],
    removePageMember: (async (pageId: string, userId: string) => (calls.push(`removePageMember:${userId}`), { status: "ok" })) as unknown as AgentServices["removePageMember"],
    listPageMemberDetails: (async () => (calls.push("listPageMemberDetails"), MEMBERS)) as unknown as AgentServices["listPageMemberDetails"],
    setPageVisibility: rec("setPageVisibility", { status: "ok" }) as unknown as AgentServices["setPageVisibility"],
    setPageRefreshEnabled: rec("setPageRefreshEnabled", { status: "ok" }) as unknown as AgentServices["setPageRefreshEnabled"],
    findSimilarPublicPage: rec("findSimilarPublicPage", { slug: "other-page", title: "Same topic" }) as unknown as AgentServices["findSimilarPublicPage"],
    exploreSearch: async () => ({
      sections: [{ kind: "paper", items: [1, 2, 3, 4].map((i) => ({ title: `P${i}`, url: `https://x/${i}`, kind: "paper", date_iso: "2026-10-01T00:00:00Z" })) }],
    }),
  };
}

function makeDeps(
  opts: {
    page?: { owner_id: string; visibility: string } | null;
    writeLimit?: number;
    members?: Record<string, "active" | "pending">;
  } = {}
) {
  const calls: Calls = [];
  const logs: AgentLogEntry[] = [];
  const dbs = new Map<string, ReturnType<typeof fakeDb>>();
  const dbFor = (id: string) => {
    if (!dbs.has(id)) dbs.set(id, fakeDb(opts.page === undefined ? { owner_id: ALICE, visibility: "private" } : opts.page));
    return dbs.get(id)!;
  };
  let writes = 0;
  const limit = opts.writeLimit ?? 30;
  const deps: AgentDeps = {
    authenticate: async (token) => {
      if (token === "alice-token") return { user: { id: ALICE, email: "alice@x.org" }, db: dbFor(ALICE).db } as AgentContext;
      if (token === "bob-token") return { user: { id: BOB, email: "bob@x.org" }, db: dbFor(BOB).db } as AgentContext;
      if (token === "explodes") throw new Error("auth service down");
      return null;
    },
    handlers: makeAgentHandlers(fakeServices(calls, (id) => id === ALICE, opts.members)),
    writeLimited: () => ++writes > limit,
    searchLimited: () => false,
    log: (e) => logs.push(e),
  };
  return { deps, calls, logs, dbFor };
}

const call = (deps: AgentDeps, tool: string, body: unknown, token: string | null = "alice-token", ip = "1.1.1.1") =>
  handleAgentCall(deps, tool, {
    authorization: token ? `Bearer ${token}` : null,
    ip,
    origin: ORIGIN,
    rawBody: body === undefined ? "" : JSON.stringify(body),
  });

const VALID_BODIES: Record<string, Record<string, unknown>> = {
  list_my_pages: {},
  list_my_projects: {},
  get_project_status: { project_id: PROJECT_ID },
  get_page: { slug: "egfr-abc12" },
  create_page: { title: "EGFR in lung cancer", seed_input: "EGFR lung cancer", visibility: "private" },
  add_member: { slug: "egfr-abc12", email: "bob@x.org", role: "viewer" },
  remove_member: { slug: "egfr-abc12", user_id: BOB_ACCT },
  set_visibility: { slug: "egfr-abc12", visibility: "public" },
  set_auto_update: { slug: "egfr-abc12", enabled: false },
  search_communities: { query: "KRAS pancreatic cancer" },
  join_community: { slug: "kras-pdac" },
  create_community: { name: "KRAS in Pancreatic Cancer", purpose: "Researchers working on KRAS in PDAC." },
};

const TOKEN_TOOLS = TOOL_SPECS.filter((t) => t.needs_user_token).map((t) => t.name);
const WRITE_TOOLS = TOOL_SPECS.filter((t) => t.changes_data).map((t) => t.name);

// ── authentication ───────────────────────────────────────────────────────────

test("no token -> 401 on every tool that needs one, and nothing runs", async () => {
  for (const tool of TOKEN_TOOLS) {
    const { deps, calls } = makeDeps();
    for (const header of [null, "", "Basic abc", "Bearer"]) {
      const res = await handleAgentCall(deps, tool, {
        authorization: header,
        ip: "1.1.1.1",
        origin: ORIGIN,
        rawBody: JSON.stringify(VALID_BODIES[tool]),
      });
      assert.equal(res.status, 401, `${tool} with header ${JSON.stringify(header)}`);
      assert.deepEqual(Object.keys(res.body), ["error"]);
      assert.equal((res.body.error as { code: string }).code, "unauthorized");
    }
    assert.deepEqual(calls, [], `${tool} must not run`);
  }
});

test("bad token -> 401 (also when the auth service itself fails)", async () => {
  for (const tool of TOKEN_TOOLS) {
    const { deps, calls } = makeDeps();
    assert.equal((await call(deps, tool, VALID_BODIES[tool], "not-a-real-token")).status, 401);
    assert.equal((await call(deps, tool, VALID_BODIES[tool], "explodes")).status, 401);
    assert.deepEqual(calls, []);
  }
});

test("401 comes before input validation, so a stranger learns nothing about inputs", async () => {
  const { deps } = makeDeps();
  const res = await call(deps, "create_page", { nonsense: true }, null);
  assert.equal(res.status, 401);
});

test("search needs no token", async () => {
  const { deps } = makeDeps();
  const res = await call(deps, "search", { query: "EGFR lung cancer" }, null);
  assert.equal(res.status, 200);
  const sources = res.body.sources as { count: number; top_results: unknown[] }[];
  assert.equal(sources[0].count, 4);
  assert.equal(sources[0].top_results.length, 3);
});

test("search is limited per IP", async () => {
  const { deps } = makeDeps();
  deps.searchLimited = () => true;
  const res = await call(deps, "search", { query: "EGFR" }, null);
  assert.equal(res.status, 429);
  assert.equal((res.body.error as { code: string }).code, "rate_limited");
});

test("bad input -> 400 with the error shape", async () => {
  const { deps } = makeDeps();
  for (const body of [{}, { slug: 5 }, { slug: "a", extra: 1 }]) {
    const res = await call(deps, "get_page", body);
    assert.equal(res.status, 400);
    assert.equal((res.body.error as { code: string }).code, "invalid_input");
  }
  const res = await call(deps, "create_page", { ...VALID_BODIES.create_page, visibility: "everyone" });
  assert.equal(res.status, 400);
  assert.equal((await handleAgentCall(deps, "get_page", { authorization: "Bearer alice-token", ip: "x", origin: ORIGIN, rawBody: "{nope" })).status, 400);
  assert.equal((await call(deps, "no_such_tool", {})).status, 404);
});

// ── preview never writes ─────────────────────────────────────────────────────

test("preview:true never writes, for every write tool", async () => {
  for (const tool of WRITE_TOOLS) {
    const { deps, calls, logs, dbFor } = makeDeps();
    const res = await call(deps, tool, { ...VALID_BODIES[tool], preview: true });
    assert.equal(res.status, 200, `${tool}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.preview, true);
    const writeCalls = calls.filter(
      (c) =>
        c.startsWith("removePageMember") ||
        c.startsWith("communities.join") ||
        c.startsWith("communities.create") ||
        ["createLivingPage", "addPageMember", "setPageVisibility", "setPageRefreshEnabled"].includes(c)
    );
    assert.deepEqual(writeCalls, [], `${tool} called a write service`);
    assert.deepEqual(dbFor(ALICE).writes, [], `${tool} wrote to the database`);
    assert.deepEqual(logs, [], `${tool} preview is not a write`);
  }
});

test("create_page preview reports a near-identical public page", async () => {
  const { deps } = makeDeps();
  const res = await call(deps, "create_page", { ...VALID_BODIES.create_page, visibility: "public", preview: true });
  assert.deepEqual(res.body.similar_public_page, {
    slug: "other-page",
    title: "Same topic",
    url: `${ORIGIN}/pages/other-page`,
  });
});

test("the same calls without preview do write, and each write is logged with user, tool and result", async () => {
  const expected: Record<string, string> = {
    create_page: "createLivingPage",
    add_member: "addPageMember",
    remove_member: `removePageMember:${BOB_ACCT}`,
    set_visibility: "setPageVisibility",
    set_auto_update: "setPageRefreshEnabled",
    join_community: "communities.join:c-open:active",
    create_community: "communities.create:KRAS in Pancreatic Cancer",
  };
  for (const tool of WRITE_TOOLS) {
    const { deps, calls, logs } = makeDeps();
    const res = await call(deps, tool, VALID_BODIES[tool]);
    assert.equal(res.status, 200, `${tool}: ${JSON.stringify(res.body)}`);
    assert.ok(calls.includes(expected[tool]), `${tool} should call ${expected[tool]}`);
    assert.deepEqual(logs, [{ event: "agent_write", user_id: ALICE, tool, ok: true, status: 200 }]);
  }
  const { deps } = makeDeps();
  const created = await call(deps, "create_page", VALID_BODIES.create_page);
  assert.deepEqual(created.body, { slug: "new-slug", url: `${ORIGIN}/pages/new-slug`, visibility: "private", source_count: 7 });
});

test("a failed write is logged as a failure", async () => {
  const { deps, logs } = makeDeps();
  // Bob can see the page in this fake db but is not its owner.
  const res = await call(deps, "set_visibility", VALID_BODIES.set_visibility, "bob-token");
  assert.equal(res.status, 403);
  assert.equal((res.body.error as { code: string }).code, "forbidden");
  assert.deepEqual(logs, [{ event: "agent_write", user_id: BOB, tool: "set_visibility", ok: false, status: 403, code: "forbidden" }]);
});

// ── get_page never reveals private pages ─────────────────────────────────────

test("get_page: someone else's private page and a page that does not exist look identical (404)", async () => {
  const { deps } = makeDeps();
  const others = await call(deps, "get_page", { slug: "egfr-abc12" }, "bob-token");
  assert.equal(others.status, 404);
  // The fake models RLS: only Alice can see the page, so any other slug is also "not found" for Bob.
  const missing = await call(deps, "get_page", { slug: "does-not-exist" }, "bob-token");
  assert.equal(missing.status, 404);
  assert.deepEqual(others.body, missing.body);
  assert.deepEqual(others.body, { error: { code: "not_found", message: "Page not found." } });

  const mine = await call(deps, "get_page", { slug: "egfr-abc12" }, "alice-token");
  assert.equal(mine.status, 200);
  assert.equal(mine.body.title, "EGFR");
  assert.equal(mine.body.url, `${ORIGIN}/pages/egfr-abc12`);
});

test("write tools on a page the caller cannot see also answer 404", async () => {
  const { deps } = makeDeps({ page: null }); // RLS shows this caller nothing
  for (const tool of ["add_member", "remove_member", "set_visibility", "set_auto_update"]) {
    for (const preview of [true, false]) {
      const res = await call(deps, tool, { ...VALID_BODIES[tool], preview }, "bob-token");
      assert.equal(res.status, 404, `${tool} preview=${preview}`);
    }
  }
});

// ── rate limiting ────────────────────────────────────────────────────────────

test("writes are limited per researcher; previews and reads do not count", async () => {
  const { deps } = makeDeps({ writeLimit: 3 });
  for (let i = 0; i < 5; i++) await call(deps, "get_page", VALID_BODIES.get_page);
  for (let i = 0; i < 5; i++) await call(deps, "set_auto_update", { ...VALID_BODIES.set_auto_update, preview: true });
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) statuses.push((await call(deps, "set_auto_update", VALID_BODIES.set_auto_update)).status);
  assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
});

// ── the tool list ────────────────────────────────────────────────────────────

test("the published tool list matches the endpoints and the handlers", () => {
  const agentDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "app", "api", "agent");
  const routeDirs = readdirSync(agentDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "tools")
    .map((d) => d.name)
    .sort();
  const names = TOOL_SPECS.map((t) => t.name).sort();

  assert.deepEqual(routeDirs, names, "every tool has exactly one route and every route is a listed tool");
  for (const name of names) assert.ok(existsSync(join(agentDir, name, "route.ts")), `${name}/route.ts`);
  assert.ok(existsSync(join(agentDir, "tools", "route.ts")), "GET /api/agent/tools exists");
  assert.deepEqual(Object.keys(makeAgentHandlers(fakeServices([], () => true))).sort(), names);

  for (const t of TOOL_SPECS) {
    assert.equal(t.endpoint, `/api/agent/${t.name}`);
    assert.equal(t.method, "POST");
    assert.ok(t.description.length > 40, `${t.name} has an LLM-readable description`);
    assert.equal(t.input_schema.type, "object");
    assert.equal(typeof t.needs_user_token, "boolean");
    assert.equal(typeof t.changes_data, "boolean");
    // Every tool that changes data supports preview, and says so in its schema.
    assert.equal("preview" in t.input_schema.properties, t.changes_data, `${t.name} preview flag`);
    assert.equal(t.supports_preview, t.changes_data);
  }
  assert.equal(TOOL_SPECS.find((t) => t.name === "search")?.needs_user_token, false);
  assert.deepEqual(TOKEN_TOOLS.length, TOOL_SPECS.length - 1);
});

test("validateInput enforces the same schema the tool list publishes", () => {
  const schema = TOOL_SPECS.find((t) => t.name === "create_page")!.input_schema;
  assert.equal(validateInput(schema, VALID_BODIES.create_page), null);
  assert.match(validateInput(schema, { ...VALID_BODIES.create_page, title: "ab" }) ?? "", /at least 3/);
  assert.match(validateInput(schema, { ...VALID_BODIES.create_page, visibility: "x" }) ?? "", /one of/);
  assert.match(validateInput(schema, { title: "abc" }) ?? "", /Missing required/);
  assert.match(validateInput(schema, { ...VALID_BODIES.create_page, preview: "yes" }) ?? "", /true or false/);
});

// ── shapes ───────────────────────────────────────────────────────────────────

test("get_page shows what's new for the last 30 days only, and no owner id", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const body = shapePage(
    {
      page: { id: "p", slug: "s", title: "T", created_at: null, visibility: "team", refresh_enabled: true, last_refreshed_at: null },
      viewer: { signedIn: true, isOwner: true, role: "owner", canEdit: true },
      project: null,
      parent: null,
      notes: [],
      evidence: [
        { id: "e1", item_id: "i1", kind: "paper", title: "A", summary: null, url: null, source: "s", date_iso: null, signal_metric: null, signal_value: null, signal_as_of: null },
        { id: "e2", item_id: "i2", kind: "trial", title: "B", summary: null, url: null, source: "s", date_iso: null, signal_metric: null, signal_value: null, signal_as_of: null },
        { id: "e3", item_id: "i3", kind: "paper", title: "C", summary: null, url: null, source: "s", date_iso: null, signal_metric: null, signal_value: null, signal_as_of: null },
      ],
      updates: [
        { id: "u1", kind: "paper", title: "recent", summary: null, url: "https://x/1", occurred_on: "2026-10-19" },
        { id: "u2", kind: "paper", title: "old", summary: null, url: "https://x/2", occurred_on: "2026-08-01" },
      ],
      members: [],
    },
    ORIGIN,
    now
  );
  assert.deepEqual(body.source_counts, { paper: 2, trial: 1 });
  assert.equal(body.whats_new_last_30_days.length, 1);
  assert.equal(body.whats_new_last_30_days[0].headline, "Oct 19: 1 new paper");
  assert.ok(!JSON.stringify(body).includes("owner_id"));
});

// ── get_page lists the team for the owner ────────────────────────────────────

test("get_page: the owner gets members with the account id, name, email and role; others do not", async () => {
  const { deps, calls } = makeDeps({ page: { owner_id: ALICE, visibility: "team" } });
  deps.handlers = makeAgentHandlers(fakeServices(calls, () => true)); // both can see the page

  const owner = await call(deps, "get_page", { slug: "egfr-abc12" }, "alice-token");
  assert.equal(owner.status, 200);
  assert.deepEqual(owner.body.members, [{ user_id: BOB_ACCT, name: "Bob Jones", email: "bob@x.org", role: "viewer" }]);

  const before = calls.filter((c) => c === "listPageMemberDetails").length;
  const viewer = await call(deps, "get_page", { slug: "egfr-abc12" }, "bob-token");
  assert.equal(viewer.status, 200);
  assert.ok(!("members" in viewer.body), "a non-owner never gets the member list");
  assert.equal(calls.filter((c) => c === "listPageMemberDetails").length, before, "and the lookup is not even made");
});

test("the members user_id is exactly what remove_member accepts", async () => {
  const { deps, calls } = makeDeps({ page: { owner_id: ALICE, visibility: "team" } });
  const page = await call(deps, "get_page", { slug: "egfr-abc12" }, "alice-token");
  const userId = (page.body.members as { user_id: string }[])[0].user_id;
  const res = await call(deps, "remove_member", { slug: "egfr-abc12", user_id: userId });
  assert.equal(res.status, 200);
  assert.ok(calls.includes(`removePageMember:${userId}`));
});

test("the tool descriptions say where to get the id and that email works too", () => {
  const remove = TOOL_SPECS.find((t) => t.name === "remove_member")!;
  assert.match(remove.description, /get_page/);
  assert.match(remove.description, /user_id/);
  assert.match(remove.description, /email/);
  assert.deepEqual(remove.input_schema.required, ["slug"]);
  assert.ok("email" in remove.input_schema.properties && "user_id" in remove.input_schema.properties);
  assert.match(TOOL_SPECS.find((t) => t.name === "get_page")!.description, /members/);
});

// ── remove_member by email ───────────────────────────────────────────────────

test("remove_member accepts an email and resolves it to the account id like add_member", async () => {
  const { deps, calls, dbFor } = makeDeps();
  const res = await call(deps, "remove_member", { slug: "egfr-abc12", email: "Bob@X.org" });
  assert.equal(res.status, 200);
  assert.ok(calls.includes(`removePageMember:${BOB_ACCT}`), "removed by the resolved account id");
  assert.deepEqual(res.body, { removed: { user_id: BOB_ACCT } });

  // Preview resolves the same way and writes nothing.
  const preview = await call(deps, "remove_member", { slug: "egfr-abc12", email: "bob@x.org", preview: true });
  assert.equal(preview.status, 200);
  assert.deepEqual((preview.body.would_remove as { user_id: string }).user_id, BOB_ACCT);
  assert.deepEqual(dbFor(ALICE).writes, []);
});

test("remove_member by email: unknown account -> 404, and exactly one of user_id/email is required", async () => {
  const { deps, calls } = makeDeps();
  const unknown = await call(deps, "remove_member", { slug: "egfr-abc12", email: "nobody@x.org" });
  assert.equal(unknown.status, 404);
  assert.equal((unknown.body.error as { message: string }).message, "No account with that email address.");

  for (const body of [
    { slug: "egfr-abc12" },
    { slug: "egfr-abc12", user_id: BOB_ACCT, email: "bob@x.org" },
  ]) {
    const res = await call(deps, "remove_member", body);
    assert.equal(res.status, 400);
    assert.match((res.body.error as { message: string }).message, /exactly one of user_id or email/);
  }
  assert.ok(!calls.some((c) => c.startsWith("removePageMember")));
});

// ── the owner cannot be added ────────────────────────────────────────────────

test("add_member refuses the page owner, in preview and for real, by email or by lookup", async () => {
  for (const preview of [true, false]) {
    const { deps, calls, logs } = makeDeps();
    const res = await call(deps, "add_member", { slug: "egfr-abc12", email: "alice@x.org", role: "editor", preview });
    assert.equal(res.status, 400, `preview=${preview}`);
    assert.deepEqual(res.body, { error: { code: "cannot_add_owner", message: "You already own this page." } });
    assert.ok(!calls.includes("addPageMember"), "nothing is added");
    assert.equal(logs.length, preview ? 0 : 1);
  }
});

test("add_member still adds somebody else", async () => {
  const { deps, calls } = makeDeps();
  const res = await call(deps, "add_member", VALID_BODIES.add_member);
  assert.equal(res.status, 200);
  assert.ok(calls.includes("addPageMember"));
});

// ── ids of the same kind ─────────────────────────────────────────────────────

test("the fake ids really differ per person", () => {
  assert.notEqual(ALICE, ALICE_ACCT);
  assert.notEqual(BOB, BOB_ACCT);
});

test("an owner who is found under a DIFFERENT account id is still refused, by email", async () => {
  // alice@x.org resolves to ALICE_ACCT, which is not the login id ALICE that owns the page.
  const { deps, calls } = makeDeps();
  const res = await call(deps, "add_member", { slug: "egfr-abc12", email: "Alice@X.org", role: "viewer" });
  assert.equal(res.status, 400);
  assert.equal((res.body.error as { code: string }).code, "cannot_add_owner");
  assert.ok(!calls.includes("addPageMember"));
});

test("isOwnerAccount: matches on the owner's login id or on the owner's email, never on nothing", () => {
  assert.equal(isOwnerAccount({ resolvedId: ALICE, email: "x@y.org", ownerId: ALICE, ownerEmail: null }), true);
  assert.equal(isOwnerAccount({ resolvedId: ALICE_ACCT, email: "ALICE@x.org ", ownerId: ALICE, ownerEmail: "alice@x.org" }), true);
  assert.equal(isOwnerAccount({ resolvedId: BOB_ACCT, email: "bob@x.org", ownerId: ALICE, ownerEmail: "alice@x.org" }), false);
  assert.equal(isOwnerAccount({ resolvedId: null, email: "bob@x.org", ownerId: ALICE, ownerEmail: null }), false);
  assert.equal(isOwnerAccount({ resolvedId: BOB_ACCT, email: "", ownerId: ALICE, ownerEmail: "" }), false);
});

// ── communities ──────────────────────────────────────────────────────────────

test("search_communities: top matches with why, joining mode and the caller's own status", async () => {
  const { deps } = makeDeps({ members: { [`${ALICE}|c-closed`]: "pending" } });
  const res = await call(deps, "search_communities", { query: "KRAS pancreatic cancer" });
  assert.equal(res.status, 200);
  const list = res.body.communities as Record<string, unknown>[];
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], {
    slug: "kras-pdac",
    name: "KRAS in PDAC",
    purpose: "KRAS in pancreatic cancer",
    member_count: 12,
    joining: "anyone can join",
    matches: ["pancreatic cancer", "KRAS"],
    your_status: "not a member",
    url: `${ORIGIN}/communities/kras-pdac`,
  });
  assert.equal(list[1].joining, "by request");
  assert.equal(list[1].your_status, "request pending");
  assert.equal(JSON.stringify(res.body).includes("c-open"), false, "internal ids are not exposed");
});

test("search_communities needs a token and a real query", async () => {
  const { deps } = makeDeps();
  assert.equal((await call(deps, "search_communities", { query: "KRAS" }, null)).status, 401);
  assert.equal((await call(deps, "search_communities", { query: "ab" })).status, 400);
});

test("join_community: an open community admits at once, a closed one takes a request (the community decides)", async () => {
  const open = makeDeps();
  const a = await call(open.deps, "join_community", { slug: "kras-pdac" });
  assert.equal(a.body.status, "joined");
  assert.ok(open.calls.includes("communities.join:c-open:active"));

  const closed = makeDeps();
  const b = await call(closed.deps, "join_community", { slug: "by-request" });
  assert.equal(b.body.status, "requested");
  assert.ok(closed.calls.includes("communities.join:c-closed:pending"), "never 'active' for a closed community");
});

test("join_community: preview says which it would be and writes nothing", async () => {
  const { deps, calls, logs } = makeDeps();
  const open = await call(deps, "join_community", { slug: "kras-pdac", preview: true });
  const closed = await call(deps, "join_community", { slug: "by-request", preview: true });
  assert.equal(open.body.would, "join");
  assert.equal(closed.body.would, "request");
  assert.deepEqual(calls.filter((c) => c.startsWith("communities.join")), []);
  assert.deepEqual(logs, []);
});

test("join_community: already a member or already asked changes nothing; unknown slug is 404", async () => {
  const { deps, calls } = makeDeps({ members: { [`${ALICE}|c-open`]: "active", [`${ALICE}|c-closed`]: "pending" } });
  assert.equal((await call(deps, "join_community", { slug: "kras-pdac" })).body.status, "already_member");
  assert.equal((await call(deps, "join_community", { slug: "by-request" })).body.status, "already_requested");
  assert.deepEqual(calls.filter((c) => c.startsWith("communities.join")), []);
  const missing = await call(deps, "join_community", { slug: "nope" });
  assert.equal(missing.status, 404);
});

test("join_community: the caller cannot choose the outcome (no is_open or status input)", async () => {
  const { deps } = makeDeps();
  for (const extra of [{ is_open: true }, { status: "active" }, { role: "admin" }]) {
    const res = await call(deps, "join_community", { slug: "by-request", ...extra });
    assert.equal(res.status, 400, JSON.stringify(extra));
  }
});

test("create_community preview (not a site admin): it would create a TEAM, and nothing is created", async () => {
  FAKE_SITE_ADMIN = false;
  const { deps, calls, logs } = makeDeps();
  const res = await call(deps, "create_community", { ...VALID_BODIES.create_community, preview: true });
  assert.equal(res.status, 200);
  const would = res.body.would_create as Record<string, unknown>;
  assert.equal(would.kind, "team");
  assert.equal(would.you_become, "lead");
  assert.equal(res.body.note_to_say, undefined);
  assert.deepEqual(res.body.similar_communities, [], "a team is not matched against communities");
  assert.deepEqual(calls.filter((c) => c.startsWith("communities.create")), []);
  assert.deepEqual(logs, []);
});

test("create_community (not a site admin) asking for a community still makes a team, and says so", async () => {
  FAKE_SITE_ADMIN = false;
  const { deps } = makeDeps();
  const res = await call(deps, "create_community", { ...VALID_BODIES.create_community, kind: "community", preview: true });
  assert.match(String(res.body.note_to_say), /Only site admins can create communities/);
  assert.equal((res.body.would_create as Record<string, unknown>).kind, "team");
});

test("create_community (not a site admin): creates a team for the caller and links to /teams", async () => {
  FAKE_SITE_ADMIN = false;
  const { deps, calls, logs } = makeDeps();
  const res = await call(deps, "create_community", VALID_BODIES.create_community);
  assert.deepEqual(res.body, {
    created: "team",
    slug: "new-community",
    url: `${ORIGIN}/teams/new-community`,
    you_are: "lead",
    say: "I created a team for you: KRAS in Pancreatic Cancer.",
  });
  assert.equal(LAST_CREATE_KIND, "team");
  assert.ok(calls.includes("communities.create:KRAS in Pancreatic Cancer"));
  assert.deepEqual(logs, [{ event: "agent_write", user_id: ALICE, tool: "create_community", ok: true, status: 200 }]);
});

test("create_community (site admin) must say whether they want a team or a community", async () => {
  FAKE_SITE_ADMIN = true;
  const { deps, calls } = makeDeps();
  const res = await call(deps, "create_community", VALID_BODIES.create_community);
  assert.equal(res.status, 400);
  assert.equal((res.body.error as { code: string }).code, "choose_kind");
  assert.deepEqual(calls.filter((c) => c.startsWith("communities.create")), []);
  FAKE_SITE_ADMIN = false;
});

test("create_community (site admin) with a kind: community keeps the old behaviour, team makes a team", async () => {
  FAKE_SITE_ADMIN = true;
  const asCommunity = makeDeps();
  const c = await call(asCommunity.deps, "create_community", { ...VALID_BODIES.create_community, kind: "community" });
  assert.deepEqual(c.body, {
    created: "community",
    slug: "new-community",
    url: `${ORIGIN}/communities/new-community`,
    you_are: "admin",
  });
  assert.equal(LAST_CREATE_KIND, "community");

  const preview = makeDeps();
  const p = await call(preview.deps, "create_community", { ...VALID_BODIES.create_community, kind: "community", preview: true });
  const similar = p.body.similar_communities as { slug: string }[];
  assert.deepEqual(similar.map((s) => s.slug), ["kras-pdac", "by-request"]);

  const asTeam = makeDeps();
  const t = await call(asTeam.deps, "create_community", { ...VALID_BODIES.create_community, kind: "team" });
  assert.equal(t.body.created, "team");
  assert.equal(LAST_CREATE_KIND, "team");
  FAKE_SITE_ADMIN = false;
});

test("create_community: needs a token, a name and a purpose; is rate limited like other writes", async () => {
  const { deps } = makeDeps({ writeLimit: 1 });
  assert.equal((await call(deps, "create_community", VALID_BODIES.create_community, null)).status, 401);
  assert.equal((await call(deps, "create_community", { name: "KR", purpose: "x" })).status, 400);
  assert.equal((await call(deps, "create_community", { name: "Fine name" })).status, 400);
  assert.equal((await call(deps, "create_community", VALID_BODIES.create_community)).status, 200);
  assert.equal((await call(deps, "create_community", VALID_BODIES.create_community)).status, 429);
});

test("list_my_projects and get_project_status read with the researcher's own client", async () => {
  const { deps, calls } = makeDeps();
  const list = await call(deps, "list_my_projects", {});
  assert.equal(list.status, 200);
  assert.equal((list.body.projects as { name: string }[])[0].name, "CD38 Fibrosis");
  const one = await call(deps, "get_project_status", { project_id: PROJECT_ID });
  assert.equal(one.status, 200);
  assert.equal(one.body.project, "CD38 Fibrosis");
  assert.ok(calls.includes("projects.list") && calls.includes("projects.status"));
});

test("get_project_status: an unknown or malformed project id is the same 404", async () => {
  const { deps } = makeDeps();
  for (const id of ["5b1f6a52-0c1e-4c58-9e0a-3f1d2a9c7b99", "not-a-uuid-at-all", "../../etc/passwd/x"]) {
    const res = await call(deps, "get_project_status", { project_id: id });
    assert.equal(res.status, 404, id);
  }
  const missing = await call(deps, "get_project_status", {});
  assert.equal(missing.status, 400);
});
