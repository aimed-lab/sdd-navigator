// lib/server/teams/teamRules.ts — the rules for TEAMS, as plain functions.
//
// A team is a `communities` row with kind = 'team' (database/migrations/
// 2026-10-28_teams.sql). The database is the real gate for every rule here
// (policies, triggers, CHECKs); these functions say the same thing in code so
// the UI can show or hide the right controls, and so `npm test` can pin the
// rules down. No imports, so node can run the tests directly.

export type CommunityKind = "community" | "team";

/** The community email join accepts only a row of kind 'community'. A team id
 *  sent there is refused (here, and in join_open_community_by_email). */
export function canEmailJoinAsCommunity(kind: CommunityKind | string | null | undefined): boolean {
  return kind === "community";
}

export function isKind(v: unknown): v is CommunityKind {
  return v === "community" || v === "team";
}

// ── who can create what ─────────────────────────────────────────────────────

/** Signed in people make teams; only site admins make communities. */
export function canCreateKind(kind: CommunityKind, v: { signedIn: boolean; siteAdmin: boolean }): boolean {
  if (!v.signedIn) return false;
  return kind === "team" ? true : v.siteAdmin;
}

/** What the assistant does when asked to create a community. A non-admin gets a
 *  team straight away; an admin is asked which one they want. */
export function assistantCreateChoice(v: { siteAdmin: boolean }): "make_team" | "ask" {
  return v.siteAdmin ? "ask" : "make_team";
}

// ── what a team is, whatever the caller asked for ───────────────────────────

/** Mirrors the trigger + CHECK on communities: a team is always open to join
 *  and always shows outsiders nothing but its name and description. */
export function normalizeSettings<T extends { kind: CommunityKind; is_open: boolean; public_preview: string }>(
  row: T
): T {
  return row.kind === "team" ? { ...row, is_open: true, public_preview: "minimal" } : row;
}

/** Kind never changes after creation. */
export function canChangeKind(from: CommunityKind, to: CommunityKind): boolean {
  return from === to;
}

// ── resources (documents, links, files) ─────────────────────────────────────

type ResourceWho = { kind: CommunityKind; isMember: boolean; isAdmin: boolean };

/** Teams: any active member adds. Communities: admins only. */
export function canAddResource(w: ResourceWho): boolean {
  return w.kind === "team" ? w.isMember : w.isAdmin;
}

/** Teams: the uploader or an admin removes or edits. Communities: admins. */
export function canChangeResource(w: ResourceWho & { isUploader: boolean }): boolean {
  return w.isAdmin || (w.kind === "team" && w.isMember && w.isUploader);
}

// ── wiki pages curated into a team ──────────────────────────────────────────

export type PageForRead = {
  visibility: "private" | "team" | "public";
  ownerId: string | null;
  /** The viewer is in this page's own page_members list. */
  inPageMembers: boolean;
  /** The viewer belongs to the page's project (project pages). */
  inProject: boolean;
  /** Ids of teams this page is curated into. */
  curatedInTeams: string[];
};

export const TEAM_VISIBLE_NOTE = "This page will be visible to your team.";

/** Mirrors can_read_page() after 2026-10-28: the old rules, plus "curated into
 *  a team the viewer is an active member of". */
export function canReadPage(page: PageForRead, viewer: { userId: string | null; teamIds: string[] }): boolean {
  if (page.visibility === "public") return true;
  if (!viewer.userId) return false;
  if (page.ownerId === viewer.userId) return true;
  if (page.visibility === "team" && page.inPageMembers) return true;
  if (page.inProject) return true;
  // Curating shares a page only while it is not private: setting it back to
  // Private takes the team's access away.
  if (page.visibility === "private") return false;
  return page.curatedInTeams.some((t) => viewer.teamIds.includes(t));
}

/** Any member may add a page they can already read, if it is their own (at any
 *  visibility) or somebody else's PUBLIC page. Another person's team or private
 *  page is never re-shared. Mirrors can_curate_page(). */
export function canCuratePage(v: {
  isMember: boolean;
  canRead: boolean;
  visibility: "private" | "team" | "public";
  isOwner: boolean;
}): boolean {
  return v.isMember && v.canRead && (v.isOwner || v.visibility === "public");
}

/** Adding your own PRIVATE page switches it to 'team'. Other cases change nothing. */
export function visibilityAfterCurate(
  visibility: "private" | "team" | "public",
  isOwner: boolean
): "private" | "team" | "public" {
  return visibility === "private" && isOwner ? "team" : visibility;
}

/** The person who added it, or a team admin, takes it off the team. */
export function canRemoveCurated(v: { isAdder: boolean; isTeamAdmin: boolean }): boolean {
  return v.isAdder || v.isTeamAdmin;
}

/** Shown before someone adds their OWN private page: it becomes visible to the team. */
export function curateNote(page: { visibility: string; ownerId: string | null }, userId: string): string | null {
  return page.visibility === "private" && page.ownerId === userId ? TEAM_VISIBLE_NOTE : null;
}

/** A public page that shows a team's NAME links to the team only when the
 *  viewer was given its slug (community_labels returns it for members only). */
export function teamLabelHref(label: { slug: string | null; kind: string }): string | null {
  if (!label.slug) return null;
  return label.kind === "team" ? `/teams/${label.slug}` : `/communities/${label.slug}`;
}

export type CuratedHow = "curated" | "made";

export function pageLabel(how: string): "Made by AI" | "Curated" {
  return how === "made" ? "Made by AI" : "Curated";
}

/** Case-insensitive title filter for the page picker; blank returns everything. */
export function filterPagesByTitle<T extends { title: string }>(pages: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return pages;
  return pages.filter((p) => p.title.toLowerCase().includes(q));
}

// ── linking a team to a community ───────────────────────────────────────────

export type LinkCheck =
  | { ok: true }
  | { ok: false; reason: "wrong_kind" | "not_team_admin" | "not_in_community" };

/** Both ids must be the right kind; the team's admin links, and must be in the
 *  community already. */
export function canLinkTeam(v: {
  teamKind: CommunityKind;
  communityKind: CommunityKind;
  isTeamAdmin: boolean;
  isCommunityMember: boolean;
}): LinkCheck {
  if (v.teamKind !== "team" || v.communityKind !== "community") return { ok: false, reason: "wrong_kind" };
  if (!v.isTeamAdmin) return { ok: false, reason: "not_team_admin" };
  if (!v.isCommunityMember) return { ok: false, reason: "not_in_community" };
  return { ok: true };
}

/** The team's admin or the community's admin may unlink. */
export function canUnlinkTeam(v: { isTeamAdmin: boolean; isCommunityAdmin: boolean }): boolean {
  return v.isTeamAdmin || v.isCommunityAdmin;
}

export const LINK_MESSAGE: Record<Exclude<LinkCheck, { ok: true }>["reason"], string> = {
  wrong_kind: "A team can only be linked to a community.",
  not_team_admin: "Only a team lead can link the team to a community.",
  not_in_community: "Join that community first, then link your team.",
};

// ── create a team ───────────────────────────────────────────────────────────

export const TEAM_NAME_MAX = 80;
export const MAX_INVITES = 50;

export function parseTeamName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) return { ok: false, error: "Give your team a name." };
  if (name.length > TEAM_NAME_MAX) return { ok: false, error: `Keep the team name under ${TEAM_NAME_MAX} letters.` };
  return { ok: true, name };
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** Emails separated by commas, semicolons, spaces or new lines. Lowercased,
 *  duplicates dropped; anything that is not an email is returned in `invalid`. */
export function parseEmails(raw: unknown): { valid: string[]; invalid: string[]; tooMany: boolean } {
  const parts = (typeof raw === "string" ? raw : "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (p.length <= 254 && EMAIL_RE.test(p)) {
      if (!valid.includes(p)) valid.push(p);
    } else if (!invalid.includes(p)) {
      invalid.push(p);
    }
  }
  return { valid: valid.slice(0, MAX_INVITES), invalid, tooMany: valid.length > MAX_INVITES };
}

/** Where a signed-out visitor goes to sign in and come back with the typed name kept. */
export function createTeamCallback(name: string): string {
  const n = name.trim().slice(0, TEAM_NAME_MAX);
  return n ? `/teams/new?name=${encodeURIComponent(n)}` : "/teams/new";
}

// ── joining ─────────────────────────────────────────────────────────────────

export type JoinView = "member" | "pending" | "join_button" | "sign_in_button";

/** What a team page's header offers this visitor. Teams are always open, so
 *  there is no "request to join". */
export function joinView(state: "signed_out" | "none" | "pending" | "active"): JoinView {
  if (state === "active") return "member";
  if (state === "pending") return "pending";
  if (state === "none") return "join_button";
  return "sign_in_button";
}

/** What to tell the person for each answer join_team gives back. Never blank:
 *  every case says what happened and what to do next. */
export function joinResultMessage(code: unknown): { ok: true } | { ok: false; error: string } {
  switch (code) {
    case "joined":
    case "already_member":
      return { ok: true };
    case "sign_in":
      return { ok: false, error: "Your sign-in has expired. Sign in again to join this team." };
    case "not_found":
      return { ok: false, error: "That team link doesn't work any more. Ask the team lead for a new QR code." };
    case "failed":
      return {
        ok: false,
        error: "We could not add you to this team. Try again, or ask a team lead to add your email address.",
      };
    default:
      return { ok: false, error: "Joining gave an unexpected answer. Please try again in a moment." };
  }
}

/** The message for a database error while joining, with its code so it can be reported. */
export function joinErrorMessage(err: { code?: string; message?: string } | null | undefined): string {
  const code = err?.code ? ` (code ${err.code})` : "";
  return `Joining did not work: the server returned an error${code}. Try again, and if it keeps happening tell the team lead.`;
}

// ── links and labels ────────────────────────────────────────────────────────

export function teamPath(slug: string): string {
  return `/teams/${slug}`;
}

/** Where sign-in brings someone back to: this team page, which then joins them. */
export function teamReturnPath(slug: string, open?: string): string {
  return `/teams/${slug}?join=signin${open ? `&open=${open}` : ""}`;
}

export function teamJoinUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, "")}/teams/${slug}?join=1`;
}

/** The page a row of this kind lives on. */
export function pathForKind(kind: CommunityKind, slug: string): string {
  return kind === "team" ? `/teams/${slug}` : `/communities/${slug}`;
}

export function roleLabel(role: string | null | undefined): "Lead" | "Member" {
  return role === "admin" || role === "lead" ? "Lead" : "Member";
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function teamHeaderLine(memberCount: number): string {
  return `Team · private · ${plural(memberCount, "member")}`;
}

// ── the assistant ───────────────────────────────────────────────────────────

/** Learning pages are curated by team leads; members only read them. */
export const LEADS_ONLY_PAGES = "Only team leads can add or remove learning pages.";

export function canCurateTeamPages(isLead: boolean): boolean {
  return isLead;
}

/** May the viewer edit a wiki page that may be on teams? `canEdit` is the
 *  database's own answer (owner, page editor, project member). A page curated
 *  into a team the viewer is on is edited only by its owner or a lead of that
 *  team: a team member who is merely an editor sees no edit or add-section
 *  controls. `teams` are the viewer's team_pages rows for the page (the database
 *  returns only rows of teams they are on); none means the page is not on one of
 *  their teams and nothing changes. */
export function pageEditAllowed(args: { canEdit: boolean; isOwner: boolean; teams: { isLead: boolean }[] }): boolean {
  if (!args.canEdit) return false;
  if (args.isOwner || args.teams.length === 0) return true;
  return args.teams.some((t) => t.isLead);
}

/** Leaving a team: a lead can leave only when another lead remains. Returns the
 *  message to show, or null when leaving is allowed. */
export const MAKE_LEAD_FIRST = "Make someone else a lead first.";

export function leaveBlockedReason(args: { isLead: boolean; otherLeads: number }): string | null {
  return args.isLead && args.otherLeads < 1 ? MAKE_LEAD_FIRST : null;
}

export type PageBackLink = { href: string; label: string };

/** The back link on a wiki page in the teams site: "Back to <team>" (that team's
 *  Learn view) when the page is reached from a team, else "My teams". */
export function pageBackLink(team: { slug: string; name: string } | null): PageBackLink {
  return team
    ? { href: `/teams/${team.slug}?view=learn`, label: `Back to ${team.name}` }
    : { href: "/teams", label: "My teams" };
}

/** A wiki page link from a team: the team is passed along (?from=<slug>) so the page
 *  can send the reader back to it. */
export function teamPageHref(pageSlug: string, teamSlug: string): string {
  return `/pages/${pageSlug}?from=${teamSlug}`;
}

/** ?from= on a wiki page: a team slug, else null. */
export function parseFromSlug(raw: string | string[] | undefined | null): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && /^[a-z0-9-]{1,200}$/.test(v) ? v : null;
}

/** The text the "Make learning material" tile puts in the assistant. */
export function makePagePrompt(teamName: string): string {
  return `Make a wiki page for my team ${teamName.replace(/\s+/g, " ").trim().slice(0, 80)} about: `;
}

/** The topic in a team page request: only the part after "about:", never the
 *  team name. "" when the message has no "about:" or nothing after it. */
export function teamTopicFromMessage(text: string): string {
  const m = /\babout\s*:\s*([\s\S]*)$/i.exec(text ?? "");
  return m ? m[1].replace(/[\s?!.]+$/, "").trim().slice(0, 200) : "";
}

/** The slug in a /teams/<slug> path, or null (also null for /teams and /teams/new). */
export function teamSlugFromPath(pathname: string | null | undefined): string | null {
  const m = /^\/teams\/([a-z0-9-]{1,200})\/?$/.exec(pathname ?? "");
  return m && m[1] !== "new" ? m[1] : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A team id from untrusted input, or null. */
export function parseTeamId(raw: unknown): string | null {
  return typeof raw === "string" && UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

/** The sentence the assistant says after it made a team for someone. */
export function teamCreatedReply(name: string): string {
  return `I created a team for you: ${name}. You are its lead. Open it to add people and share material.`;
}
