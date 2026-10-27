import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const src = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("team page: hero, tiles, then the section or the latest list; settings last for leads", () => {
  const page = src("app/teams/[slug]/page.tsx");
  assert.match(page, /parseView\(query\.view\)/);
  const order = ["<TeamHeader", "<TeamTiles", "<SectionHeader", "<LatestCard", "<TeamSettings"].map((t) => page.indexOf(t));
  assert.ok(order.every((n) => n > 0), "all present");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in reading order");
  assert.match(page, /\{isLead && \(\s*<TeamSettings/);
  // photos never reach the documents list
  assert.match(page, /documents=\{documents\}/);
  assert.match(page, /photos=\{photos\}/);
  // on a phone the hero shrinks inside a section
  assert.match(page, /compact=\{!!view\}/);
  // the old chips and bottom-sheet tiles are gone
  assert.equal(existsSync(new URL("../../../components/teams/SectionNav.tsx", import.meta.url)), false);
});

test("tiles: six of them, sections are links with ?view=, the dialogs are the add forms", () => {
  const tiles = src("components/teams/TeamTiles.tsx");
  for (const t of ["Slides", "Learn", "Photos", "People", "Ask AI", "Share"]) assert.ok(tiles.includes(`"${t}"`), t);
  assert.match(tiles, /grid-cols-3 md:grid-cols-6/);
  assert.match(tiles, /viewHref\(slug, on \? null : t\.k\)/);
  assert.match(tiles, /view \? "hidden md:grid" : "grid"/);
  assert.match(tiles, /<Sheet title="Add a file"/);
  assert.match(tiles, /<Sheet title="Add a page"/);
  assert.match(tiles, /<Sheet title="Add a photo"/);
  assert.match(tiles, /<Sheet title="Share & promote"/);
  assert.match(tiles, /#e9f5ec/);
});

test("the team page uses only green: no orange, blue, purple or red accents", () => {
  const files = [
    "components/teams/TeamTiles.tsx",
    "components/teams/SectionHeader.tsx",
    "components/teams/DocumentCards.tsx",
    "components/teams/LearnList.tsx",
    "components/teams/PhotosGallery.tsx",
    "components/teams/PeopleList.tsx",
    "components/teams/LatestCard.tsx",
    "components/teams/TeamIcons.tsx",
    "components/teams/HeroPhoneActions.tsx",
    "components/teams/SharePromotePanel.tsx",
  ];
  const banned = /#(?:ea580c|c2410c|9a3412|2563eb|1e40af|2c4a9a|e6ecfb|7e22ce|6b21a8|f3e8ff|b42318|dc2626|991b1b|fde8e6|b45309|fef3c7)/i;
  for (const f of files) assert.doesNotMatch(src(f), banned, f);
  // the PDF badge is black, the slides badge green
  const docs = src("components/teams/DocumentCards.tsx");
  assert.match(docs, /pdf: \{ text: "PDF", bg: "#1d1d1b" \}/);
  assert.match(docs, /slides: \{ text: "SLIDES", bg: "#0f6b33" \}/);
});

test("icons on this page are Lucide", () => {
  const icons = src("components/teams/TeamIcons.tsx");
  for (const n of ["Presentation", "BookOpen", "Camera", "Users", "Sparkles", "Share2"]) assert.ok(icons.includes(n), n);
  assert.match(icons, /strokeWidth=\{1\.75\}/);
  assert.match(icons, /iconSize = 24/);
  assert.match(src("components/teams/DocumentCards.tsx"), /ExternalLink/);
  assert.match(src("components/teams/SectionHeader.tsx"), /ArrowLeft/);
  assert.match(src("components/teams/HeroPhoneActions.tsx"), /QrCode/);
  assert.match(src("package.json"), /"lucide-react"/);
});

test("section view: back link, one add button, switch pills, phone-only pieces", () => {
  const h = src("components/teams/SectionHeader.tsx");
  assert.match(h, /Team home/);
  assert.match(h, /"Invite"/);
  assert.match(h, /isLead \? "Invite" : null/);
  assert.match(h, /aria-label="Switch section"/);
  assert.match(h, /bg-\[#1d1d1b\]/);
  assert.match(h, /md:hidden/);
  const meta = src("lib/server/teams/teamUi.ts");
  for (const a of ["Add a file", "Add a page", "Add a photo"]) assert.ok(meta.includes(`add: "${a}"`), a);
});

test("after a success the dialog closes with a toast and scrolls to the new item", () => {
  assert.match(src("components/teams/AddDocumentPanel.tsx"), /done\(addedMessage\(/);
  assert.match(src("components/teams/CuratePagesPanel.tsx"), /done\(/);
  const ctx = src("components/teams/TeamPanelContext.tsx");
  assert.match(ctx, /data-item-id/);
  assert.match(ctx, /role="status"/);
  assert.match(src("components/teams/DocumentCards.tsx"), /data-item-id=\{r\.id\}/);
  assert.match(src("components/teams/PhotosGallery.tsx"), /data-item-id=\{r\.id\}/);
  assert.match(src("components/teams/LearnList.tsx"), /data-item-id=\{p\.pageId\}/);
});

test("permissions are unchanged: pin for leads, remove for leads and the adder", () => {
  const docs = src("components/teams/DocumentCards.tsx");
  assert.match(docs, /const canRemove = isLead \|\| r\.added_by === viewerId;/);
  assert.match(docs, /if \(isLead\) \{\s*items\.push\(\{\s*label: pinned/);
  assert.match(src("components/teams/PhotosGallery.tsx"), /canRemove=\{\(r\) => isLead \|\| r\.added_by === viewerId\}/);
  assert.match(src("components/teams/LearnList.tsx"), /p\.canRemove/);
});

test("the teams home (/) is untouched this round", () => {
  assert.match(src("components/teams/TeamsHome.tsx"), /listMyTeamsNewest/);
});

// ── learning pages are curated by leads ───────────────────────────────────────

import { LEADS_ONLY_PAGES, canCurateTeamPages, pageEditAllowed } from "./teamRules.ts";

test("only leads curate learning pages (rule and message)", () => {
  assert.equal(canCurateTeamPages(true), true);
  assert.equal(canCurateTeamPages(false), false);
  assert.match(LEADS_ONLY_PAGES, /Only team leads/);
});

test("server: adding, removing and searching team pages check the lead first", () => {
  const t = src("lib/server/teams/teams.ts");
  const add = t.slice(t.indexOf("export async function addPageToTeam"));
  assert.ok(add.indexOf("canCurateTeamPages(membership.isAdmin)") > 0);
  assert.ok(add.indexOf("canCurateTeamPages(membership.isAdmin)") < add.indexOf('.from("team_pages")'), "before the insert");
  const rm = t.slice(t.indexOf("export async function removePageFromTeam"));
  assert.ok(rm.indexOf("canCurateTeamPages(") > 0 && rm.indexOf("canCurateTeamPages(") < rm.indexOf('.from("team_pages")'), "before the delete");
  const search = t.slice(t.indexOf("export async function searchPagesForTeam"), t.indexOf("export async function addPageToTeam"));
  assert.match(search, /canCurateTeamPages\(/);
  // the per-page remove flag is the lead flag only
  assert.match(t, /canRemove: membership\.isAdmin,/);
  // the database says the same (a migration file)
  const sql = readFileSync(new URL("../../../../database/migrations/2026-10-31_team_pages_leads_only.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(sql, /CREATE POLICY "Team pages: lead insert"[\s\S]*is_community_admin\(team_id, auth\.uid\(\)\)/);
  assert.match(sql, /CREATE POLICY "Team pages: lead delete"[\s\S]*USING \(public\.is_community_admin/);
});

test("Learn UI: members see the list and open pages, nothing else", () => {
  const learn = src("components/teams/LearnList.tsx");
  assert.match(learn, /isLead && p\.canRemove/);
  assert.match(learn, /\{isLead && \(\s*<button/);
  assert.match(src("components/teams/SectionHeader.tsx"), /view === "learn" && !isLead \? null : meta\.add/);
  const page = src("app/teams/[slug]/page.tsx");
  assert.match(page, /isLead=\{isLead\}/);
  assert.match(page, /wanted === "pages" && !isLead \? null : wanted/);
  assert.match(src("components/teams/TeamTiles.tsx"), /panel === "pages" && isLead/);
});

test("Ask AI: a member gets a question box and the 'ask about the talk' line; no page offers", () => {
  const tiles = src("components/teams/TeamTiles.tsx");
  assert.match(tiles, /small=\{isLead \? "make a page" : "ask about the talk"\}/);
  assert.match(tiles, /: openAssistant\(\{ text: "", mode: "open" \}\)/);
  assert.match(tiles, /canCurate: isLead/);
  const chat = src("components/explore/AssistantChat.tsx");
  assert.match(chat, /const memberOnTeam = activeTeam\(\)\?\.canCurate === false;/);
  assert.match(chat, /setAction\(memberOnTeam \? null/);
  assert.match(chat, /!memberOnTeam && !parsed\.community/);
  assert.match(chat, /shownTeam\?\.canCurate === false && st\.id === "create"/);
  assert.match(src("lib/server/assistant/assistantBridge.ts"), /canCurate\?: boolean/);
});

test("wiki page opened from Learn: members get no edit or add-section controls", () => {
  const ok = (canEdit: boolean, isOwner: boolean, teams: { isLead: boolean }[]) => pageEditAllowed({ canEdit, isOwner, teams });
  assert.equal(ok(true, true, [{ isLead: false }]), true, "the owner keeps them");
  assert.equal(ok(true, false, [{ isLead: true }]), true, "a lead of the team keeps them");
  assert.equal(ok(true, false, [{ isLead: false }]), false, "a member who is merely an editor loses them");
  assert.equal(ok(true, false, []), true, "a page that is not on the viewer's teams is unchanged");
  assert.equal(ok(false, false, [{ isLead: true }]), false, "the database's no stays no");
  const view = src("lib/server/pages/pageView.ts");
  assert.match(view, /pageEditAllowed\(\{ canEdit, isOwner, teams \}\)/);
  assert.match(view, /is_community_admin/);
});

// ── simple teams site: leave, nav, assistant button, preview, back link ───────

import { MAKE_LEAD_FIRST, leaveBlockedReason, pageBackLink, parseFromSlug, teamPageHref } from "./teamRules.ts";
import { accountLinks, navPillars } from "../../siteMode.ts";

test("leave a team: a lead can leave only when another lead remains", () => {
  assert.equal(leaveBlockedReason({ isLead: false, otherLeads: 0 }), null);
  assert.equal(leaveBlockedReason({ isLead: true, otherLeads: 1 }), null);
  assert.equal(leaveBlockedReason({ isLead: true, otherLeads: 0 }), "Make someone else a lead first.");
  assert.equal(MAKE_LEAD_FIRST, "Make someone else a lead first.");
});

test("leave a team: enforced in the server, only the caller's own row, with the confirm text", () => {
  const t = src("lib/server/teams/teams.ts");
  const leave = t.slice(t.indexOf("export async function leaveTeam"), t.indexOf("export async function getPageBackLink"));
  assert.match(leave, /membership\.state !== "active"/);
  assert.match(leave, /\.neq\("user_id", user\.id\)/);
  assert.match(leave, /leaveBlockedReason\(\{ isLead: true, otherLeads: count \?\? 0 \}\)/);
  assert.ok(leave.indexOf("leaveBlockedReason") < leave.indexOf("leaveCommunity(teamId)"), "checked before deleting");
  // leaveCommunity deletes only the caller's own community_members row
  const c = src("lib/server/communities.ts");
  const lc = c.slice(c.indexOf("export async function leaveCommunity"));
  assert.match(lc.slice(0, 600), /\.delete\(\)[\s\S]*\.eq\("community_id", communityId\)[\s\S]*\.eq\("user_id", user\.id\)/);
  assert.match(src("app/teams/actions.ts"), /export async function leaveTeamAction/);
  const ui = src("components/teams/LeaveTeamButton.tsx");
  assert.match(ui, /Leave \{teamName\}\? You can join again with the QR code or link\./);
  assert.match(ui, /router\.push\("\/teams\?left=1"\)/);
  assert.match(src("components/teams/FlashToast.tsx"), /You left the team\./);
  assert.match(src("components/teams/PeopleList.tsx"), /<LeaveTeamButton/);
});

test("the database already lets a member delete their own team row (no migration needed)", () => {
  const sql = readFileSync(new URL("../../../../database/migrations/2026-08-30_community_admin_membership.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(sql, /CREATE POLICY "Community members: self or admin delete"[\s\S]*USING \(user_id = auth\.uid\(\) OR public\.is_community_admin/);
});

test("teams mode: no My pages in the top bar or the profile menu; connect site unchanged", () => {
  assert.deepEqual(navPillars(true).map((l) => l.label), ["Teams"]);
  assert.deepEqual(accountLinks(true), []);
  assert.deepEqual(navPillars(false).map((l) => l.href), ["/explore", "/collaborate", "/promote"]);
  assert.deepEqual(accountLinks(false).map((l) => l.href), ["/projects", "/pages", "/saved"]);
});

test("teams mode: no floating Ask AI assistant button, Feedback untouched", () => {
  const chat = src("components/explore/AssistantChat.tsx");
  assert.match(chat, /\{!open && !TEAMS_MODE && \(\s*<button/);
  assert.match(chat, /aria-label="Ask AI assistant"/);
});

test("non-member preview: the members' layout, six tiles, 'Join this team to open this'", () => {
  const p = src("components/teams/TeamPreview.tsx");
  assert.doesNotMatch(p, /Team wiki pages|Shared documents|PagesCard|DocumentsCard|>\s*lock\s*</);
  assert.match(p, /grid-cols-3 md:grid-cols-6/);
  for (const t of ["Slides", "Learn", "Photos", "People", "Ask AI", "Share"]) assert.ok(p.includes(`name: "${t}"`), t);
  assert.match(p, /small: "ask about the talk"/);
  assert.match(p, /photos: tileCount\("photos", photos\)|small: tileCount\("photos", photos\)/);
  assert.match(p, /Join this team to open this/);
});

test("wiki page back link: team from ?from=, else My teams; every team link passes the team", () => {
  assert.deepEqual(pageBackLink({ slug: "intro-1", name: "Intro to AI in Medicine" }), { href: "/teams/intro-1?view=learn", label: "Back to Intro to AI in Medicine" });
  assert.deepEqual(pageBackLink(null), { href: "/teams", label: "My teams" });
  assert.equal(teamPageHref("how-agents-work", "intro-1"), "/pages/how-agents-work?from=intro-1");
  assert.equal(parseFromSlug("intro-1"), "intro-1");
  for (const bad of ["", "A B", "../x", "x".repeat(201), undefined]) assert.equal(parseFromSlug(bad as string | undefined), null);
  assert.match(src("components/teams/LearnList.tsx"), /teamPageHref\(p\.slug, slug\)/);
  assert.match(src("components/teams/LatestCard.tsx"), /teamPageHref\(pageSlugs\[pageId\], slug\)/);
  assert.match(src("app/teams/[slug]/page.tsx"), /redirect\(teamPageHref\(p\.slug, team\.slug\)\)/);
  const page = src("app/pages/[slug]/page.tsx");
  assert.match(page, /TEAMS_MODE \? await getPageBackLink\(page\.id, parseFromSlug\(from\)\) : null/);
  assert.match(page, /\{backLink && <TeamBackLink link=\{backLink\} \/>\}/);
  const view = src("components/pages/TeamBackLink.tsx");
  assert.match(view, /sticky top-16/);
  assert.match(view, /#0f6b33/);
  // one team in common, or the forged ?from= cannot name a team the viewer is not on
  const t = src("lib/server/teams/teams.ts");
  assert.match(t, /teams\.length === 1/);
  assert.match(t, /teams\.find\(\(t\) => t\.slug === fromSlug\)/);
});
