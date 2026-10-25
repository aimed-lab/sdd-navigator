import test from "node:test";
import assert from "node:assert/strict";
import {
  teamSlugFromPath,
  teamTopicFromMessage,
  LINK_MESSAGE,
  MAX_INVITES,
  assistantCreateChoice,
  canAddResource,
  canChangeKind,
  canChangeResource,
  canCreateKind,
  canCuratePage,
  canLinkTeam,
  canReadPage,
  canRemoveCurated,
  canUnlinkTeam,
  createTeamCallback,
  curateNote,
  filterPagesByTitle,
  isKind,
  joinView,
  makePagePrompt,
  normalizeSettings,
  pageLabel,
  parseEmails,
  parseTeamId,
  parseTeamName,
  pathForKind,
  plural,
  roleLabel,
  teamCreatedReply,
  teamHeaderLine,
  teamJoinUrl,
  teamLabelHref,
  visibilityAfterCurate,
  TEAM_VISIBLE_NOTE,
  type PageForRead,
} from "./teamRules.ts";

// ── kinds and who can create what ───────────────────────────────────────────

test("kind is 'community' or 'team' and never changes", () => {
  assert.equal(isKind("team"), true);
  assert.equal(isKind("community"), true);
  assert.equal(isKind("project"), false);
  assert.equal(isKind(null), false);
  assert.equal(canChangeKind("team", "team"), true);
  assert.equal(canChangeKind("team", "community"), false);
  assert.equal(canChangeKind("community", "team"), false);
});

test("anyone signed in makes a team; only a site admin makes a community; signed out makes nothing", () => {
  assert.equal(canCreateKind("team", { signedIn: true, siteAdmin: false }), true);
  assert.equal(canCreateKind("team", { signedIn: true, siteAdmin: true }), true);
  assert.equal(canCreateKind("community", { signedIn: true, siteAdmin: false }), false);
  assert.equal(canCreateKind("community", { signedIn: true, siteAdmin: true }), true);
  assert.equal(canCreateKind("team", { signedIn: false, siteAdmin: false }), false);
  assert.equal(canCreateKind("community", { signedIn: false, siteAdmin: true }), false);
});

test("the assistant makes a team for non-admins and asks admins which they want", () => {
  assert.equal(assistantCreateChoice({ siteAdmin: false }), "make_team");
  assert.equal(assistantCreateChoice({ siteAdmin: true }), "ask");
  assert.match(teamCreatedReply("KRAS club"), /^I created a team for you: KRAS club\./);
});

test("a team is always open to join and always shows outsiders nothing", () => {
  const team = normalizeSettings({ kind: "team" as const, is_open: false, public_preview: "open" });
  assert.deepEqual(team, { kind: "team", is_open: true, public_preview: "minimal" });
  const community = { kind: "community" as const, is_open: false, public_preview: "open" };
  assert.deepEqual(normalizeSettings(community), community, "a community keeps its own settings");
});

// ── resources ───────────────────────────────────────────────────────────────

test("teams: any member adds; communities: only admins", () => {
  assert.equal(canAddResource({ kind: "team", isMember: true, isAdmin: false }), true);
  assert.equal(canAddResource({ kind: "team", isMember: false, isAdmin: false }), false);
  assert.equal(canAddResource({ kind: "community", isMember: true, isAdmin: false }), false);
  assert.equal(canAddResource({ kind: "community", isMember: true, isAdmin: true }), true);
});

test("teams: the uploader or an admin removes; another member cannot", () => {
  const base = { kind: "team" as const, isMember: true };
  assert.equal(canChangeResource({ ...base, isAdmin: false, isUploader: true }), true);
  assert.equal(canChangeResource({ ...base, isAdmin: true, isUploader: false }), true);
  assert.equal(canChangeResource({ ...base, isAdmin: false, isUploader: false }), false);
  // A community resource is never changed by "its uploader" alone.
  assert.equal(canChangeResource({ kind: "community", isMember: true, isAdmin: false, isUploader: true }), false);
});

// ── team_pages: the read rule ───────────────────────────────────────────────

const PAGE: PageForRead = { visibility: "private", ownerId: "owner", inPageMembers: false, inProject: false, curatedInTeams: [] };

test("a private page is readable by its owner only, as before", () => {
  assert.equal(canReadPage(PAGE, { userId: "owner", teamIds: [] }), true);
  assert.equal(canReadPage(PAGE, { userId: "other", teamIds: ["t1"] }), false);
  assert.equal(canReadPage(PAGE, { userId: null, teamIds: [] }), false);
});

test("a page curated into a team is readable by that team's members, not by other teams", () => {
  const curated = { ...PAGE, visibility: "team" as const, curatedInTeams: ["t1"] };
  assert.equal(canReadPage(curated, { userId: "member", teamIds: ["t1"] }), true);
  assert.equal(canReadPage(curated, { userId: "member", teamIds: ["t2"] }), false);
  assert.equal(canReadPage(curated, { userId: "outsider", teamIds: [] }), false);
  assert.equal(canReadPage(curated, { userId: null, teamIds: ["t1"] }), false, "signed out never reads a private page");
});

test("setting a curated page back to Private takes the team's access away", () => {
  const priv = { ...PAGE, visibility: "private" as const, curatedInTeams: ["t1"] };
  assert.equal(canReadPage(priv, { userId: "member", teamIds: ["t1"] }), false);
  assert.equal(canReadPage(priv, { userId: "owner", teamIds: [] }), true, "the owner still reads it");
  assert.equal(canReadPage({ ...priv, visibility: "team" }, { userId: "member", teamIds: ["t1"] }), true);
  assert.equal(canReadPage({ ...priv, visibility: "public" }, { userId: "member", teamIds: ["t1"] }), true);
});

test("leaving the team (or removing the page) takes the access away", () => {
  const curated = { ...PAGE, visibility: "team" as const, curatedInTeams: ["t1"] };
  assert.equal(canReadPage(curated, { userId: "x", teamIds: ["t1"] }), true);
  assert.equal(canReadPage(curated, { userId: "x", teamIds: [] }), false);
  assert.equal(canReadPage({ ...curated, curatedInTeams: [] }, { userId: "x", teamIds: ["t1"] }), false);
});

test("the other page rules are unchanged: public, shared with the person, project pages", () => {
  assert.equal(canReadPage({ ...PAGE, visibility: "public", ownerId: null }, { userId: null, teamIds: [] }), true);
  assert.equal(canReadPage({ ...PAGE, visibility: "team", inPageMembers: true }, { userId: "p", teamIds: [] }), true);
  assert.equal(canReadPage({ ...PAGE, visibility: "private", inPageMembers: true }, { userId: "p", teamIds: [] }), false);
  assert.equal(canReadPage({ ...PAGE, inProject: true }, { userId: "p", teamIds: [] }), true);
});

test("who can curate and who can take a page off", () => {
  const mine = { isMember: true, canRead: true, visibility: "private" as const, isOwner: true };
  assert.equal(canCuratePage(mine), true, "your own private page");
  assert.equal(canCuratePage({ ...mine, canRead: false }), false, "only pages you can already read");
  assert.equal(canCuratePage({ ...mine, isMember: false }), false);
  assert.equal(canCuratePage({ ...mine, visibility: "team" }), true, "your own page at any visibility");
  assert.equal(canCuratePage({ ...mine, visibility: "public" }), true);
  assert.equal(canCuratePage({ ...mine, isOwner: false }), false, "somebody else's private page is never curated");
  assert.equal(canCuratePage({ ...mine, isOwner: false, visibility: "public" }), true, "others' pages: public only");
  assert.equal(canCuratePage({ ...mine, isOwner: false, visibility: "team" }), false, "no re-sharing of someone else's team page");
  assert.equal(canRemoveCurated({ isAdder: true, isTeamAdmin: false }), true);
  assert.equal(canRemoveCurated({ isAdder: false, isTeamAdmin: true }), true);
  assert.equal(canRemoveCurated({ isAdder: false, isTeamAdmin: false }), false);
});

test("adding your own PRIVATE page switches it to team and shows the note; nothing else changes", () => {
  assert.equal(TEAM_VISIBLE_NOTE, "This page will be visible to your team.");
  assert.equal(curateNote({ visibility: "private", ownerId: "me" }, "me"), TEAM_VISIBLE_NOTE);
  assert.equal(curateNote({ visibility: "team", ownerId: "me" }, "me"), null);
  assert.equal(curateNote({ visibility: "public", ownerId: "me" }, "me"), null);
  assert.equal(curateNote({ visibility: "private", ownerId: "someone" }, "me"), null);
  assert.equal(visibilityAfterCurate("private", true), "team");
  assert.equal(visibilityAfterCurate("private", false), "private");
  assert.equal(visibilityAfterCurate("team", true), "team");
  assert.equal(visibilityAfterCurate("public", true), "public");
});

test("a public page shows a team's name but links to it only when it was given the slug", () => {
  assert.equal(teamLabelHref({ slug: null, kind: "team" }), null, "non-member: name only");
  assert.equal(teamLabelHref({ slug: "kras-a1b2c3", kind: "team" }), "/teams/kras-a1b2c3", "member");
  assert.equal(teamLabelHref({ slug: "colabofest-2026", kind: "community" }), "/communities/colabofest-2026");
  assert.equal(teamLabelHref({ slug: null, kind: "community" }), null);
});

test("shelf labels and the page search", () => {
  assert.equal(pageLabel("made"), "Made by AI");
  assert.equal(pageLabel("curated"), "Curated");
  assert.equal(pageLabel("anything else"), "Curated");
  const pages = [{ title: "KRAS inhibitors" }, { title: "PHGDH in cancer" }];
  assert.deepEqual(filterPagesByTitle(pages, "  kras "), [{ title: "KRAS inhibitors" }]);
  assert.equal(filterPagesByTitle(pages, "").length, 2);
  assert.equal(filterPagesByTitle(pages, "zzz").length, 0);
});

// ── linking a team to a community ───────────────────────────────────────────

test("a team's lead links it to a community they are in; both ids must be the right kind", () => {
  const good = { teamKind: "team" as const, communityKind: "community" as const, isTeamAdmin: true, isCommunityMember: true };
  assert.deepEqual(canLinkTeam(good), { ok: true });
  assert.deepEqual(canLinkTeam({ ...good, teamKind: "community" }), { ok: false, reason: "wrong_kind" });
  assert.deepEqual(canLinkTeam({ ...good, communityKind: "team" }), { ok: false, reason: "wrong_kind" });
  assert.deepEqual(canLinkTeam({ ...good, isTeamAdmin: false }), { ok: false, reason: "not_team_admin" });
  assert.deepEqual(canLinkTeam({ ...good, isCommunityMember: false }), { ok: false, reason: "not_in_community" });
  for (const reason of ["wrong_kind", "not_team_admin", "not_in_community"] as const) {
    assert.ok(LINK_MESSAGE[reason].length > 10);
  }
});

test("the team's lead or the community's admin may unlink; nobody else", () => {
  assert.equal(canUnlinkTeam({ isTeamAdmin: true, isCommunityAdmin: false }), true);
  assert.equal(canUnlinkTeam({ isTeamAdmin: false, isCommunityAdmin: true }), true);
  assert.equal(canUnlinkTeam({ isTeamAdmin: false, isCommunityAdmin: false }), false);
});

// ── creating a team ─────────────────────────────────────────────────────────

test("team name: trimmed, one line, required, not too long", () => {
  assert.deepEqual(parseTeamName("  KRAS   journal club "), { ok: true, name: "KRAS journal club" });
  assert.equal(parseTeamName("").ok, false);
  assert.equal(parseTeamName("   ").ok, false);
  assert.equal(parseTeamName(undefined).ok, false);
  assert.equal(parseTeamName("x".repeat(81)).ok, false);
  assert.equal(parseTeamName("x".repeat(80)).ok, true);
});

test("invite emails: commas, semicolons, spaces or new lines; lowercased; duplicates dropped; bad ones reported", () => {
  const r = parseEmails("Ada@UAB.edu, bo@uab.edu\nada@uab.edu; not-an-email  cy@x.org");
  assert.deepEqual(r.valid, ["ada@uab.edu", "bo@uab.edu", "cy@x.org"]);
  assert.deepEqual(r.invalid, ["not-an-email"]);
  assert.equal(r.tooMany, false);
  assert.deepEqual(parseEmails(""), { valid: [], invalid: [], tooMany: false });
  assert.deepEqual(parseEmails(undefined), { valid: [], invalid: [], tooMany: false });
  const many = Array.from({ length: MAX_INVITES + 3 }, (_, i) => `p${i}@x.org`).join(",");
  const m = parseEmails(many);
  assert.equal(m.valid.length, MAX_INVITES);
  assert.equal(m.tooMany, true);
});

test("signed out, the sign-in link comes back to /teams/new with the typed name", () => {
  assert.equal(createTeamCallback("KRAS club"), "/teams/new?name=KRAS%20club");
  assert.equal(createTeamCallback("  "), "/teams/new");
  assert.equal(createTeamCallback("a&b=c"), "/teams/new?name=a%26b%3Dc");
});

// ── joining ─────────────────────────────────────────────────────────────────

test("join flow: signed in sees one button, signed out can use an email; members and pending get no button", () => {
  assert.equal(joinView("none"), "join_button");
  assert.equal(joinView("signed_out"), "email_or_sign_in");
  assert.equal(joinView("active"), "member");
  assert.equal(joinView("pending"), "pending");
});

test("links go to the team page, and the join link carries ?join=1", () => {
  assert.equal(teamJoinUrl("https://x.org/", "kras-a1b2c3"), "https://x.org/teams/kras-a1b2c3?join=1");
  assert.equal(pathForKind("team", "kras-a1b2c3"), "/teams/kras-a1b2c3");
  assert.equal(pathForKind("community", "colabofest-2026"), "/communities/colabofest-2026");
});

// ── labels and the assistant ────────────────────────────────────────────────

test("labels: Lead / Member, the header line", () => {
  assert.equal(roleLabel("admin"), "Lead");
  assert.equal(roleLabel("lead"), "Lead");
  assert.equal(roleLabel("member"), "Member");
  assert.equal(roleLabel(null), "Member");
  assert.equal(teamHeaderLine(1), "Team · private · 1 member");
  assert.equal(teamHeaderLine(7), "Team · private · 7 members");
  assert.equal(plural(0, "member"), "0 members");
});

test("the learning-material prompt names the team and ends where the topic goes", () => {
  assert.equal(makePagePrompt("KRAS club"), "Make a wiki page for my team KRAS club about: ");
  assert.equal(makePagePrompt("  A   B "), "Make a wiki page for my team A B about: ");
});

test("team ids from outside must be real ids", () => {
  const id = "0b9d7f58-6c5a-4a0e-9d3c-2f1d9a8b7c6e";
  assert.equal(parseTeamId(id), id);
  assert.equal(parseTeamId(id.toUpperCase()), id);
  for (const bad of ["", "abc", "0b9d7f58", null, 5, undefined, `${id}; drop table`]) {
    assert.equal(parseTeamId(bad), null, String(bad));
  }
});

test("the migration's can_curate_page allows only public pages or the person's own", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../../../database/migrations/2026-10-28_teams.sql", import.meta.url), "utf8");
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.can_curate_page"), sql.indexOf("REVOKE ALL ON FUNCTION public.can_curate_page"));
  assert.match(fn, /public\.can_read_page\(p\.id, p_uid\)/);
  assert.match(fn, /AND \(p\.visibility = 'public' OR p\.owner_id = p_uid\)/);
  assert.doesNotMatch(fn, /'team'/, "someone else's team-visibility page is not curatable");
});

test("teamTopicFromMessage: only the part after about:, never the team name", () => {
  assert.equal(teamTopicFromMessage("Make a wiki page for my team Lung Lab about: EGFR inhibitors"), "EGFR inhibitors");
  assert.equal(teamTopicFromMessage("Make a wiki page for my team Lung Lab about: "), "");
  assert.equal(teamTopicFromMessage("hello"), "");
  assert.equal(teamTopicFromMessage("make a page for my team about: PHGDH?"), "PHGDH");
});

test("teamSlugFromPath: a team page only", () => {
  assert.equal(teamSlugFromPath("/teams/lung-lab-ab12"), "lung-lab-ab12");
  assert.equal(teamSlugFromPath("/teams/new"), null);
  assert.equal(teamSlugFromPath("/teams"), null);
  assert.equal(teamSlugFromPath("/explore/x"), null);
});
