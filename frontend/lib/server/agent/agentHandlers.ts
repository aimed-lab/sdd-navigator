// lib/server/agent/agentHandlers.ts — the real implementation of each agent
// tool. Every handler that touches data runs with `ctx.db`, the client bound to
// the researcher's own token, so RLS decides what is allowed; the checks here
// (owner only, not found) only produce clear errors and never replace RLS.
//
// A write tool called with preview:true validates and describes the change and
// performs NO write: the preview branches below return before any insert,
// update or delete.

import type { setPageRefreshEnabled, setPageVisibility } from "../pages/pageAdmin";
import type { addPageMember, listPageMemberDetails, removePageMember, PageMemberRole } from "../pages/pageMembers";
import type { createLivingPage } from "../pages/createPage";
import type { getPageView, listMyPages } from "../pages/pageView";
import type { findSimilarPublicPage } from "../pages/similarPages";
import type { PageVisibility } from "../pages/pageViewHelpers";
import type { AgentContext, ToolHandler, ToolResult } from "./agentCore";
import type { ProjectOps } from "./agentProjectOps.ts";
import { OWNER_ALREADY, isOwnerAccount } from "../pages/pageViewHelpers.ts";
import { pageUrl, shapeMyPages, shapePage, summarizeExplore } from "./agentShapes.ts";

/** A community as the agent sees it. */
export type AgentCommunity = {
  id: string;
  slug: string;
  name: string;
  purpose: string | null;
  memberCount: number;
  isOpen: boolean;
  why: string[];
};

/** Community operations, all run with the researcher's own token-bound `db`. */
export type CommunityOps = {
  /** Best matches for a topic (at most `limit`), strictest-first. */
  search(db: AgentContext["db"], query: string, limit: number): Promise<AgentCommunity[]>;
  find(db: AgentContext["db"], slug: string): Promise<{ id: string; slug: string; name: string; isOpen: boolean } | null>;
  /** The researcher's own row in that community, if any. */
  membership(db: AgentContext["db"], userId: string, communityId: string): Promise<"active" | "pending" | null>;
  /** Insert the researcher's own row: 'active' for an open community, else 'pending'. */
  join(
    db: AgentContext["db"],
    user: AgentContext["user"],
    community: { id: string; isOpen: boolean }
  ): Promise<{ ok: true; status: "active" | "pending" } | { ok: false; error: string }>;
  /** `kind` 'team' for anyone; 'community' only works for a site admin. */
  create(
    db: AgentContext["db"],
    name: string,
    purpose: string,
    kind: "team" | "community"
  ): Promise<{ ok: true; id: string; slug: string } | { ok: false; error: string }>;
  /** Is the researcher a site admin (the only people who can create communities)? */
  isSiteAdmin(db: AgentContext["db"]): Promise<boolean>;
};

/** The side-effecting operations the handlers use, injected so tests can run
 *  the handlers against fakes (agentServices.ts supplies the real ones). */
export type AgentServices = {
  listMyPages: typeof listMyPages;
  getPageView: typeof getPageView;
  createLivingPage: typeof createLivingPage;
  addPageMember: typeof addPageMember;
  removePageMember: typeof removePageMember;
  listPageMemberDetails: typeof listPageMemberDetails;
  setPageVisibility: typeof setPageVisibility;
  setPageRefreshEnabled: typeof setPageRefreshEnabled;
  findSimilarPublicPage: typeof findSimilarPublicPage;
  /** The raw Explore backend JSON for a query. Throws on failure. */
  exploreSearch(query: string): Promise<unknown>;
  communities: CommunityOps;
  /** Read-only project status, read with the researcher's own client. */
  projects: ProjectOps;
};

const fail = (status: number, code: string, message: string): ToolResult => ({ ok: false, status, code, message });
const ok = (data: Record<string, unknown>): ToolResult => ({ ok: true, data });

const NOT_FOUND = fail(404, "not_found", "Page not found.");
const NOT_OWNER = (what: string) => fail(403, "forbidden", `Only the page owner can ${what}.`);

function needCtx(ctx: AgentContext | null): AgentContext {
  if (!ctx) throw new Error("tool requires an authenticated context");
  return ctx;
}

type PageRef = { id: string; slug: string; title: string; visibility: PageVisibility; isOwner: boolean; refresh_enabled: boolean };

/** The page by slug as RLS shows it to this researcher; null if it does not
 *  exist or they may not see it (indistinguishable on purpose). */
async function loadPage(ctx: AgentContext, slug: string): Promise<PageRef | null> {
  const { data, error } = await ctx.db
    .from("pages")
    .select("id, slug, title, owner_id, visibility, refresh_enabled")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as string,
    slug: data.slug as string,
    title: data.title as string,
    visibility: data.visibility as PageVisibility,
    isOwner: data.owner_id === ctx.user.id,
    refresh_enabled: !!data.refresh_enabled,
  };
}

/** The account id for an email, as add_member resolves it (confirmed accounts
 *  only; the SQL function itself returns null unless the caller owns the page). */
async function lookupAccountId(ctx: AgentContext, pageId: string, email: string): Promise<string | null> {
  const { data, error } = await ctx.db.rpc("find_account_id_by_email_for_page", { p_page_id: pageId, p_email: email });
  if (error) throw error;
  return (data as string | null) ?? null;
}

function adminFailure(r: { status: "forbidden" | "error"; error: string }): ToolResult {
  return r.status === "forbidden" ? fail(403, "forbidden", r.error) : fail(400, "request_failed", r.error);
}

export function makeAgentHandlers(svc: AgentServices): Record<string, ToolHandler> {
// ── read tools ───────────────────────────────────────────────────────────────

const search: ToolHandler = async ({ input }) => {
  try {
    return ok({ query: input.query, ...summarizeExplore(await svc.exploreSearch(String(input.query))) });
  } catch (e) {
    console.error("agent search failed", e);
    return fail(502, "upstream_error", "Search is unavailable right now.");
  }
};

const listMyPagesTool: ToolHandler = async ({ ctx, origin }) => {
  const c = needCtx(ctx);
  const r = await svc.listMyPages(new Date(), c);
  if (r.status !== "ok") return fail(500, "server_error", "Couldn't load your pages.");
  return ok(shapeMyPages(r.pages, origin));
};

const listMyProjectsTool: ToolHandler = async ({ ctx }) => {
  const c = needCtx(ctx);
  try {
    const projects = await svc.projects.list(c.db, c.user.id);
    return ok({ projects });
  } catch (e) {
    console.error("agent list_my_projects failed", e);
    return fail(500, "server_error", "Couldn't load your projects.");
  }
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const getProjectStatusTool: ToolHandler = async ({ ctx, input }) => {
  const c = needCtx(ctx);
  const id = String(input.project_id ?? "");
  // A malformed id is the same "not found" as an unknown one.
  if (!UUID.test(id)) return fail(404, "not_found", "Project not found.");
  try {
    const status = await svc.projects.status(c.db, id);
    if (!status) return fail(404, "not_found", "Project not found.");
    return ok(status as unknown as Record<string, unknown>);
  } catch (e) {
    console.error("agent get_project_status failed", e);
    return fail(500, "server_error", "Couldn't load that project.");
  }
};

const getPage: ToolHandler = async ({ ctx, input, origin }) => {
  const c = needCtx(ctx);
  const r = await svc.getPageView(String(input.slug), c);
  if (r.status === "not_found") return NOT_FOUND;
  if (r.status === "error") return fail(500, "server_error", "Couldn't load that page.");
  // The team (with names and emails) is the owner's to see.
  const members = r.view.viewer.isOwner ? await svc.listPageMemberDetails(r.view.page.id, c) : undefined;
  return ok(shapePage(r.view, origin, new Date(), members));
};

// ── communities ──────────────────────────────────────────────────────────────

const COMMUNITY_MATCHES = 3;
const communityUrl = (origin: string, slug: string) => `${origin}/communities/${slug}`;

const searchCommunitiesTool: ToolHandler = async ({ ctx, input, origin }) => {
  const c = needCtx(ctx);
  const found = await svc.communities.search(c.db, String(input.query), COMMUNITY_MATCHES);
  const mine = await Promise.all(found.map((f) => svc.communities.membership(c.db, c.user.id, f.id)));
  return ok({
    query: input.query,
    communities: found.map((f, i) => ({
      slug: f.slug,
      name: f.name,
      purpose: f.purpose,
      member_count: f.memberCount,
      joining: f.isOpen ? "anyone can join" : "by request",
      matches: f.why,
      your_status: mine[i] === "active" ? "member" : mine[i] === "pending" ? "request pending" : "not a member",
      url: communityUrl(origin, f.slug),
    })),
    note: found.length === 0 ? "No existing community matches. It is fine to offer to create one." : undefined,
  });
};

const joinCommunityTool: ToolHandler = async ({ ctx, input, preview, origin }) => {
  const c = needCtx(ctx);
  const community = await svc.communities.find(c.db, String(input.slug));
  if (!community) return fail(404, "not_found", "Community not found.");
  const url = communityUrl(origin, community.slug);

  // Already in (or already asked): nothing to do, and nothing is written.
  const existing = await svc.communities.membership(c.db, c.user.id, community.id);
  if (existing === "active") return ok({ community: community.name, status: "already_member", url });
  if (existing === "pending") return ok({ community: community.name, status: "already_requested", url });

  // Open communities admit at once; others take a request. The community's own
  // setting decides, never the caller.
  const outcome = community.isOpen ? "join" : "request";
  if (preview) {
    return ok({
      community: community.name,
      would: outcome,
      note: community.isOpen
        ? "This community is open: the researcher would become a member immediately."
        : "This community is by request: an admin would have to approve before the researcher is a member.",
      url,
    });
  }

  const r = await svc.communities.join(c.db, c.user, { id: community.id, isOpen: community.isOpen });
  if (!r.ok) return fail(400, "request_failed", r.error);
  return ok({ community: community.name, status: r.status === "active" ? "joined" : "requested", url });
};

const createCommunityTool: ToolHandler = async ({ ctx, input, preview, origin }) => {
  const c = needCtx(ctx);
  const name = String(input.name);
  const purpose = String(input.purpose);
  const asked = input.kind === "team" || input.kind === "community" ? input.kind : null;

  // Only site admins create communities. Anyone else gets a TEAM instead (and
  // is told so). An admin who has not said which they want is asked.
  const siteAdmin = await svc.communities.isSiteAdmin(c.db);
  if (siteAdmin && !asked) {
    return fail(
      400,
      "choose_kind",
      "Ask the researcher whether they want a TEAM (small, private, for a few people) or a COMMUNITY (public, long-lived, many teams). Then call again with kind set to 'team' or 'community'."
    );
  }
  const kind: "team" | "community" = siteAdmin ? (asked as "team" | "community") : "team";
  const downgraded = !siteAdmin && asked === "community";

  if (preview) {
    const similar = kind === "community" ? await svc.communities.search(c.db, `${name} ${purpose}`, COMMUNITY_MATCHES) : [];
    return ok({
      would_create:
        kind === "team"
          ? { kind: "team", name, purpose, you_become: "lead", joining: "anyone with the link or QR code; the content is for members only" }
          : { name, purpose, kind: "community", you_become: "admin", joining: "by request" },
      note_to_say: downgraded
        ? "Only site admins can create communities, so this creates a team for the researcher. Say so plainly."
        : undefined,
      similar_communities: similar.map((s) => ({
        slug: s.slug,
        name: s.name,
        purpose: s.purpose,
        member_count: s.memberCount,
        joining: s.isOpen ? "anyone can join" : "by request",
        matches: s.why,
        url: communityUrl(origin, s.slug),
      })),
      note:
        similar.length > 0
          ? "Similar communities already exist. Ask whether the researcher would rather join one before creating."
          : undefined,
    });
  }

  const r = await svc.communities.create(c.db, name, purpose, kind);
  if (!r.ok) return fail(400, "request_failed", r.error);
  if (kind === "team") {
    return ok({
      created: "team",
      slug: r.slug,
      url: `${origin}/teams/${r.slug}`,
      you_are: "lead",
      say: `I created a team for you: ${name}.`,
    });
  }
  return ok({ created: "community", slug: r.slug, url: communityUrl(origin, r.slug), you_are: "admin" });
};

// ── write tools (each honors preview) ────────────────────────────────────────

const createPage: ToolHandler = async ({ ctx, input, preview, origin }) => {
  const c = needCtx(ctx);
  const title = String(input.title);
  const seed = String(input.seed_input);
  const visibility = input.visibility as PageVisibility;

  if (preview) {
    const similar = await svc.findSimilarPublicPage(c.db, title, seed);
    return ok({
      would_create: { title, seed_input: seed, visibility, owner: "the researcher" },
      takes: "about a minute: the page researches the topic when it is created",
      similar_public_page: similar ? { slug: similar.slug, title: similar.title, url: pageUrl(origin, similar.slug) } : null,
    });
  }

  const r = await svc.createLivingPage({ insertDb: c.db, ownerId: c.user.id, title, topic: seed, visibility });
  if (!r.ok) return fail(r.status === 502 ? 502 : 500, r.status === 502 ? "upstream_error" : "server_error", r.error);
  return ok({ slug: r.slug, url: pageUrl(origin, r.slug), visibility: r.visibility, source_count: r.evidence });
};

const addMember: ToolHandler = async ({ ctx, input, preview }) => {
  const c = needCtx(ctx);
  const page = await loadPage(c, String(input.slug));
  if (!page) return NOT_FOUND;
  if (!page.isOwner) return NOT_OWNER("add members");
  const role = input.role as PageMemberRole;
  const email = String(input.email).toLowerCase();

  // The owner is never a team member.
  const accountId = await lookupAccountId(c, page.id, email);
  if (isOwnerAccount({ resolvedId: accountId, email, ownerId: c.user.id, ownerEmail: c.user.email })) {
    return fail(400, "cannot_add_owner", OWNER_ALREADY);
  }

  if (preview) {
    const data = accountId;
    return ok({
      would_add: { email, role },
      account_found: !!data,
      active_now: page.visibility === "team",
      note: data ? undefined : "No account with that email, so this would fail.",
    });
  }

  const r = await svc.addPageMember(page.id, email, role, c);
  if (r.status !== "ok") return adminFailure(r);
  return ok({ added: { email, role }, active_now: r.active });
};

const removeMember: ToolHandler = async ({ ctx, input, preview }) => {
  const c = needCtx(ctx);
  const page = await loadPage(c, String(input.slug));
  if (!page) return NOT_FOUND;
  if (!page.isOwner) return NOT_OWNER("remove members");
  const hasId = typeof input.user_id === "string";
  const hasEmail = typeof input.email === "string";
  if (hasId === hasEmail) {
    return fail(400, "invalid_input", "Give exactly one of user_id or email.");
  }
  // An email is resolved to the account id exactly as add_member does.
  let userId = hasId ? String(input.user_id) : "";
  if (hasEmail) {
    const found = await lookupAccountId(c, page.id, String(input.email).toLowerCase());
    if (!found) return fail(404, "not_found", "No account with that email address.");
    userId = found;
  }

  if (preview) {
    const { data, error } = await c.db
      .from("page_members")
      .select("user_id, role")
      .eq("page_id", page.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return ok({
      would_remove: { user_id: userId, role: data?.role ?? null },
      is_a_member: !!data,
      note: data ? undefined : "That user is not a member, so this would fail.",
    });
  }

  const r = await svc.removePageMember(page.id, userId, c);
  if (r.status !== "ok") return adminFailure(r);
  return ok({ removed: { user_id: userId } });
};

const setVisibility: ToolHandler = async ({ ctx, input, preview }) => {
  const c = needCtx(ctx);
  const page = await loadPage(c, String(input.slug));
  if (!page) return NOT_FOUND;
  if (!page.isOwner) return NOT_OWNER("change visibility");
  const to = input.visibility as PageVisibility;

  if (preview) {
    return ok({
      from: page.visibility,
      to,
      changes: page.visibility !== to,
      note: to === "public" ? "Anyone with the link, signed in or not, will be able to read this page." : undefined,
    });
  }
  const r = await svc.setPageVisibility(page.id, to, c);
  if (r.status !== "ok") return adminFailure(r);
  return ok({ slug: page.slug, visibility: to });
};

const setAutoUpdate: ToolHandler = async ({ ctx, input, preview }) => {
  const c = needCtx(ctx);
  const page = await loadPage(c, String(input.slug));
  if (!page) return NOT_FOUND;
  if (!page.isOwner) return NOT_OWNER("change automatic updating");
  const enabled = input.enabled === true;

  if (preview) return ok({ from: page.refresh_enabled, to: enabled, changes: page.refresh_enabled !== enabled });
  const r = await svc.setPageRefreshEnabled(page.id, enabled, c);
  if (r.status !== "ok") return adminFailure(r);
  return ok({ slug: page.slug, auto_update: enabled });
};

return {
  search,
  list_my_pages: listMyPagesTool,
  list_my_projects: listMyProjectsTool,
  get_project_status: getProjectStatusTool,
  get_page: getPage,
  create_page: createPage,
  add_member: addMember,
  remove_member: removeMember,
  set_visibility: setVisibility,
  set_auto_update: setAutoUpdate,
  search_communities: searchCommunitiesTool,
  join_community: joinCommunityTool,
  create_community: createCommunityTool,
};
}
