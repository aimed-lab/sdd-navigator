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
import { OWNER_ALREADY, isOwnerAccount } from "../pages/pageViewHelpers.ts";
import { pageUrl, shapeMyPages, shapePage, summarizeExplore } from "./agentShapes.ts";

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

const getPage: ToolHandler = async ({ ctx, input, origin }) => {
  const c = needCtx(ctx);
  const r = await svc.getPageView(String(input.slug), c);
  if (r.status === "not_found") return NOT_FOUND;
  if (r.status === "error") return fail(500, "server_error", "Couldn't load that page.");
  // The team (with names and emails) is the owner's to see.
  const members = r.view.viewer.isOwner ? await svc.listPageMemberDetails(r.view.page.id, c) : undefined;
  return ok(shapePage(r.view, origin, new Date(), members));
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
  get_page: getPage,
  create_page: createPage,
  add_member: addMember,
  remove_member: removeMember,
  set_visibility: setVisibility,
  set_auto_update: setAutoUpdate,
};
}
