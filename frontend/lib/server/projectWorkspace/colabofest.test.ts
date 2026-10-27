import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AFFILIATION_LABEL,
  arrangeAnnouncements,
  canDeleteThread,
  canManageAnnouncements,
  canStartThread,
  contactMailto,
  decideAccess,
  firstName,
  hasProjectMemberRow,
  linkify,
  nextDue,
  parseAnnouncement,
  parseReply,
  parseThread,
  roleLabel,
  showWelcome,
  sortThreads,
  timeAgo,
} from "./colabofest.ts";
import { COLABOFEST_CONTACT_EMAIL, COLABOFEST_STAGES, currentStageIndex } from "../../colabofestConfig.ts";
import { canPostKind, parseUpdatePost, postableKinds } from "./status.ts";
import { visibleTabs } from "./workspace.ts";
import { COLABOFEST_CHALLENGE_KEY, COLABOFEST_PROGRAM } from "../../projectTypes.ts";

const lf = (t: string) => t.replace(/\r\n/g, "\n");
const sql = (name: string) => lf(readFileSync(new URL(`../../../../database/migrations/${name}`, import.meta.url), "utf8"));
const src = (rel: string) => lf(readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8"));
const noComments = (t: string) => t.replace(/--.*$/gm, "");

// ── who can post, edit, pin or delete an announcement ────────────────────────

test("announcements: a lead, a manager or a site admin manage them; a member only reads", () => {
  assert.equal(canManageAnnouncements({ role: "lead" }), true);
  assert.equal(canManageAnnouncements({ role: "manager" }), true);
  assert.equal(canManageAnnouncements({ role: "member" }), false);
  assert.equal(canManageAnnouncements({ role: null }), false);
  assert.equal(canManageAnnouncements({ role: "member", isSiteAdmin: true }), true);
  assert.equal(canManageAnnouncements({ role: null, isSiteAdmin: true }), true);
});

test("announcements: the post rules agree (a member cannot post one, can ask for help)", () => {
  assert.equal(canPostKind("member", "announcement"), false);
  assert.equal(parseUpdatePost("announcement", "Deadline moved", "member").ok, false);
  assert.equal(parseUpdatePost("announcement", "Deadline moved", "manager").ok, true);
  assert.deepEqual(postableKinds("member"), ["help"]);
  assert.deepEqual(postableKinds("lead"), ["announcement", "help"]);
  // a plain "update" can no longer be posted by anybody
  assert.equal(canPostKind("lead", "update"), false);
});

test("announcements: pinned first, then newest", () => {
  const rows = [
    { id: "a", pinned: false, created_at: "2026-10-30T10:00:00Z" },
    { id: "b", pinned: true, created_at: "2026-10-01T10:00:00Z" },
    { id: "c", pinned: false, created_at: "2026-11-02T10:00:00Z" },
    { id: "d", pinned: true, created_at: "2026-10-20T10:00:00Z" },
  ];
  assert.deepEqual(arrangeAnnouncements(rows).map((r) => r.id), ["d", "b", "c", "a"]);
});

test("announcements: text is required and bounded", () => {
  assert.equal(parseAnnouncement("   ").ok, false);
  assert.equal(parseAnnouncement("x".repeat(4001)).ok, false);
  assert.deepEqual(parseAnnouncement("  Hello\r\nteam "), { ok: true, body: "Hello\nteam" });
});

test("announcements (database): the policies are staff or site admin, members cannot insert one", () => {
  const t = noComments(sql("2026-10-31_project_announcements_discussions.sql"));
  const insert = /CREATE POLICY "Project updates: member insert"[\s\S]*?;\n/.exec(t)![0];
  assert.match(insert, /kind = 'announcement'[\s\S]*is_project_staff[\s\S]*is_site_admin/);
  assert.match(insert, /kind = 'help'[\s\S]*is_project_member/);
  assert.doesNotMatch(insert, /'update'/);
  const upd = /CREATE POLICY "Project updates: staff update"[\s\S]*?;\n/.exec(t)![0];
  assert.match(upd, /is_project_staff[\s\S]*is_site_admin/);
  const del = /CREATE POLICY "Project updates: author or staff delete"[\s\S]*?;\n/.exec(t)![0];
  assert.match(del, /kind <> 'announcement'/);
  assert.match(t, /GRANT UPDATE \(resolved_at, body, pinned\)/);
});

// ── discussions: who can start, who can delete ────────────────────────────────

test("discussions: any member starts a thread", () => {
  assert.equal(canStartThread(true), true);
  assert.equal(canStartThread(false), false);
});

test("discussions: the author, a project lead or a site admin delete; nobody else", () => {
  assert.equal(canDeleteThread({ isAuthor: true, role: "member" }), true);
  assert.equal(canDeleteThread({ isAuthor: false, role: "lead" }), true);
  assert.equal(canDeleteThread({ isAuthor: false, role: "member", isSiteAdmin: true }), true);
  assert.equal(canDeleteThread({ isAuthor: false, role: "member" }), false);
  // a manager who is not a lead deletes only their own
  assert.equal(canDeleteThread({ isAuthor: false, role: "manager" }), false);
  assert.equal(canDeleteThread({ isAuthor: true, role: "manager" }), true);
  assert.equal(canDeleteThread({ isAuthor: false, role: null }), false);
});

test("discussions (database): members only, author/lead/site-admin delete, nobody edits", () => {
  const t = noComments(sql("2026-10-31_project_announcements_discussions.sql"));
  for (const name of ["Threads: member select", "Replies: member select"]) {
    assert.match(new RegExp(`"${name}"[\\s\\S]*?is_project_member`).exec(t)![0], /is_project_member/);
  }
  const del = /CREATE POLICY "Threads: author, lead or site admin delete"[\s\S]*?;\n/.exec(t)![0];
  assert.match(del, /author_id = auth\.uid\(\)[\s\S]*is_project_lead[\s\S]*is_site_admin/);
  assert.doesNotMatch(del, /is_project_staff/);
  assert.match(t, /GRANT SELECT, INSERT, DELETE ON public\.project_threads TO authenticated/);
  assert.doesNotMatch(t, /GRANT[^;]*UPDATE[^;]*project_threads/);
  assert.doesNotMatch(t, /TO anon/);
});

test("discussions: titles and text are checked, plain text, newest activity first", () => {
  assert.equal(parseThread("", "x").ok, false);
  assert.equal(parseThread("t", "  ").ok, false);
  assert.equal(parseThread("t".repeat(201), "x").ok, false);
  assert.deepEqual(parseThread("  A   title ", "Body"), { ok: true, title: "A title", body: "Body" });
  assert.equal(parseReply("").ok, false);
  const t = sortThreads([
    { id: "1", last_activity_at: "2026-10-01T00:00:00Z" },
    { id: "2", last_activity_at: "2026-10-05T00:00:00Z" },
  ]);
  assert.deepEqual(t.map((x) => x.id), ["2", "1"]);
});

test("discussions: links are clickable, everything else stays text", () => {
  assert.deepEqual(linkify("see https://box.com/s/abc, ok"), [
    { text: "see " },
    { text: "https://box.com/s/abc", href: "https://box.com/s/abc" },
    { text: ", ok" },
  ]);
  const evil = linkify('<img src=x onerror=alert(1)> javascript:alert(1) ftp://x');
  assert.equal(evil.some((p) => p.href), false);
  assert.equal(linkify("no links").length, 1);
});

// ── welcome card: dismissal ───────────────────────────────────────────────────

test("welcome: ColaboFest only, until dismissed", () => {
  assert.equal(showWelcome({ isColabofest: true, dismissed: false }), true);
  assert.equal(showWelcome({ isColabofest: true, dismissed: true }), false);
  assert.equal(showWelcome({ isColabofest: false, dismissed: false }), false);
});

test("welcome: dismissal is kept per person and project in the database, not the browser", () => {
  const t = noComments(sql("2026-10-31_colabofest_project_core.sql"));
  assert.match(t, /CREATE TABLE IF NOT EXISTS public\.project_welcome_dismissals/);
  assert.match(t, /PRIMARY KEY \(project_id, user_id\)/);
  const sel = /CREATE POLICY "Welcome dismissals: own select"[\s\S]*?;\n/.exec(t)![0];
  assert.match(sel, /user_id = auth\.uid\(\)/);
  const ins = /CREATE POLICY "Welcome dismissals: own insert"[\s\S]*?;\n/.exec(t)![0];
  assert.match(ins, /user_id = auth\.uid\(\)[\s\S]*is_project_member/);
  assert.doesNotMatch(t, /TO anon/);
  for (const f of ["lib/server/projectWorkspace/welcome.ts", "components/projects/workspace/WelcomeCard.tsx"]) {
    assert.doesNotMatch(src(f), /localStorage|sessionStorage|document\.cookie/, f);
  }
  assert.match(src("components/projects/workspace/WelcomeCard.tsx"), /dismissWelcomeAction/);
});

test("welcome: the first name, and the dates come from the one config file", () => {
  assert.equal(firstName("Priya Raman", "p@x.org"), "Priya");
  assert.equal(firstName(null, "sam.lee@x.org"), "sam.lee");
  assert.equal(firstName("  ", null), "there");
  assert.deepEqual(COLABOFEST_STAGES.map((s) => s.shown), ["Oct 26", "Nov 11", "Nov 13", "Dec 15", "Apr 1", "May"]);
  assert.deepEqual(COLABOFEST_STAGES.map((s) => s.label), [
    "Kickoff",
    "Finalist agreement due",
    "Finalist presentations and awards",
    "Computational results",
    "Experimental results",
    "Showcase",
  ]);
  // date order
  const froms = COLABOFEST_STAGES.map((s) => s.from);
  assert.deepEqual([...froms].sort(), [...froms]);
  assert.equal(currentStageIndex("2026-10-26"), 0);
  assert.equal(currentStageIndex("2026-11-10"), 0);
  assert.equal(currentStageIndex("2026-11-11"), 1);
  assert.equal(currentStageIndex("2026-11-12"), 1);
  assert.equal(currentStageIndex("2026-11-13"), 2);
  assert.equal(currentStageIndex("2026-12-15"), 3);
  assert.equal(currentStageIndex("2027-04-02"), 4);
  assert.equal(currentStageIndex("2027-05-20"), 5);
  assert.equal(currentStageIndex("2026-09-01"), 0);
  // placeholders are marked, and no other file hard-codes them
  assert.doesNotMatch(src("lib/colabofestConfig.ts"), /TODO-confirm/);
  assert.doesNotMatch(src("components/projects/workspace/WelcomeCard.tsx"), /Dec 15|Apr 1|Oct 26|Nov 1[13]/);
  // six points: the line scrolls on a phone and is one row of six from md up
  assert.match(src("components/projects/workspace/WelcomeCard.tsx"), /flex md:grid md:grid-cols-6 .*overflow-x-auto md:overflow-visible/);
});

// ── access: signed out / not a member / member ────────────────────────────────

test("access: signed out sees the sign-in page, a non-member is restricted, a member gets in", () => {
  assert.equal(decideAccess({ signedIn: false, isMember: false }), "sign_in");
  assert.equal(decideAccess({ signedIn: false, isMember: true }), "sign_in");
  assert.equal(decideAccess({ signedIn: true, isMember: false }), "restricted");
  assert.equal(decideAccess({ signedIn: true, isMember: true }), "allowed");
});

test("access: the help link is a mailto with the project link in the subject", () => {
  const href = contactMailto("https://connect.smartdrugdiscovery.org/projects/abc");
  assert.ok(href.startsWith(`mailto:${COLABOFEST_CONTACT_EMAIL}?subject=`));
  assert.ok(href.includes(encodeURIComponent("https://connect.smartdrugdiscovery.org/projects/abc")));
});

test("access: the page decides before it reads the project, and the two screens carry no project data", () => {
  const page = src("app/projects/[id]/page.tsx");
  const gate = page.indexOf("<SignInGate");
  const claim = page.indexOf('rpc("claim_pending_project_memberships")');
  const member = page.indexOf("await hasProjectMemberRow(");
  const read = page.indexOf("await getProject(");
  const restricted = page.indexOf("<RestrictedAccess");
  assert.ok(
    gate > 0 && claim > gate && member > claim && read > member && restricted > read,
    "order: sign-in gate, claim, membership row, read, restricted"
  );
  // access is never decided by "the project row came back"
  assert.doesNotMatch(page, /status\s*!==\s*"not_found"\s*\}\)/);
  assert.match(page, /isMember\s*\}\)/);
  assert.doesNotMatch(page, /redirect\(`\/login/);
  const screens = src("components/projects/workspace/AccessScreens.tsx");
  // props are a return path, a link and the viewer's own email: never a name or details
  assert.match(screens, /export function RestrictedAccess\(\{\s*returnPath,\s*projectLink,\s*email,/);
  assert.match(screens, /export function SignInGate\(\{ returnPath \}/);
  assert.doesNotMatch(screens, /project\.name|description|projectName/);
  for (const text of [
    "Sign in to open your ColaboFest project",
    "Use the email address you used for your ColaboFest submission.",
    "Sign in or create an account",
    "Restricted access",
    "This project is only open to its team.",
    "Sign in with a different email",
    "My projects",
    "Still can&apos;t get in?",
  ]) {
    assert.ok(screens.includes(text), text);
  }
  assert.doesNotMatch(screens, /Join/);
});

test("access (database): a non-member reads nothing of a project", () => {
  const audit = noComments(sql("2026-10-31_project_access_audit.sql"));
  // wiki pages: a project page is readable by members only
  assert.match(audit, /WHEN p\.project_id IS NOT NULL THEN public\.is_project_member\(p\.project_id, p_uid\)/);
  // the membership helpers are not callable signed out
  assert.match(audit, /REVOKE ALL ON FUNCTION public\.is_project_member\(UUID, UUID\) FROM anon/);
  assert.match(audit, /GRANT EXECUTE ON FUNCTION public\.is_project_member\(UUID, UUID\) TO authenticated/);
  // no anon privileges on any project table
  assert.match(audit, /REVOKE ALL ON public\.%I FROM anon/);
  for (const table of ["projects", "project_members", "checklist_items", "project_updates", "project_threads", "project_thread_replies", "project_proposals"]) {
    assert.ok(audit.includes(`'${table}'`), table);
  }
  // claiming an invitation is NOT redefined here: the live verified_auth_email rule stays
  assert.doesNotMatch(audit, /claim_pending_project_memberships\(\)\s*RETURNS|auth\.identities/);
  // the original member-only policies are the ones in force on the core tables
  const base = noComments(sql("2026-08-04_projects.sql"));
  assert.match(base, /CREATE POLICY "Projects: member select"\s+ON public\.projects FOR SELECT\s+USING \(public\.is_project_member\(id, auth\.uid\(\)\)\)/);
  assert.match(base, /CREATE POLICY "Project members: member select"[\s\S]*?is_project_member\(project_id, auth\.uid\(\)\)/);
  assert.match(base, /CREATE POLICY "Checklist items: member select"[\s\S]*?is_project_member\(project_id, auth\.uid\(\)\)/);
  // none of the new tables has a policy for anon or a USING (true)
  for (const f of ["2026-10-31_colabofest_project_core.sql", "2026-10-31_project_announcements_discussions.sql", "2026-10-31_project_access_audit.sql"]) {
    const t = noComments(sql(f));
    assert.doesNotMatch(t, /USING\s*\(\s*true\s*\)/i, f);
    // (can_read_page is meant to stay callable signed out: it answers for public pages)
    assert.doesNotMatch(t, /GRANT[^;]*ON (TABLE )?public\.\w+[^;]*TO anon/i, f);
  }
});

// ── team labels, finalist, progress ───────────────────────────────────────────

test("team: Lead / Member / SPARC / Southern Research", () => {
  assert.equal(roleLabel("lead", null), "Lead");
  assert.equal(roleLabel("lead", "sparc"), "Lead");
  assert.equal(roleLabel("member", null), "Member");
  assert.equal(roleLabel("member", "sparc"), "SPARC");
  assert.equal(roleLabel("manager", "southern_research"), "Southern Research");
  assert.equal(roleLabel("manager", null), "SPARC team");
  assert.equal(roleLabel("member", "bogus"), "Member");
  assert.deepEqual(AFFILIATION_LABEL, { sparc: "SPARC", southern_research: "Southern Research" });
});

test("finalist and affiliation (database): site admin only, lead only", () => {
  const t = noComments(sql("2026-10-31_colabofest_project_core.sql"));
  assert.match(t, /ADD COLUMN IF NOT EXISTS finalist BOOLEAN NOT NULL DEFAULT false/);
  assert.match(t, /IF public\.is_site_admin\(\) THEN\s+RETURN NEW;/);
  assert.match(t, /NEW\.finalist := OLD\.finalist/);
  assert.match(t, /NEW\.finalist := false/);
  assert.match(t, /CHECK \(affiliation IS NULL OR affiliation IN \('sparc', 'southern_research'\)\)/);
  const pol = /CREATE POLICY "Project members: lead set affiliation"[\s\S]*?;\n/.exec(t)![0];
  assert.match(pol, /is_project_lead/);
  assert.match(t, /GRANT UPDATE \(role, affiliation\) ON public\.project_members TO authenticated/);
});

test("progress: the next due item, with the overdue one first", () => {
  const items = [
    { label: "A", status: "ready", position: 1, due_date: "2026-11-01" },
    { label: "B", status: "not_yet", position: 2, due_date: "2026-12-01" },
    { label: "C", status: "not_yet", position: 3, due_date: "2026-11-10" },
    { label: "D", status: "not_yet", position: 4, due_date: null },
  ];
  assert.equal(nextDue(items, "2026-11-05")?.label, "C");
  assert.equal(nextDue(items, "2026-12-05")?.label, "C"); // overdue first
  assert.equal(nextDue([items[0], items[3]], "2026-11-05"), null);
});

test("timeAgo", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  assert.equal(timeAgo("2026-11-05T11:59:40Z", now), "just now");
  assert.equal(timeAgo("2026-11-05T11:30:00Z", now), "30m ago");
  assert.equal(timeAgo("2026-11-05T07:00:00Z", now), "5h ago");
  assert.equal(timeAgo("2026-11-03T12:00:00Z", now), "2d ago");
  assert.equal(timeAgo("nonsense", now), "");
});

// ── a member of the project's COMMUNITY who is not on the project ─────────────

// A fake client that behaves like the database under the live policies:
//   projects         readable by a project member OR a member of its community
//                    ("Projects: member or community select", 2026-08-30)
//   project_members  readable only by members of that project
function fakeDb(viewer: string, projectMembers: Record<string, string[]>, communityMembers: string[]) {
  return {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(c1: string, v1: string) {
              return {
                eq(_c2: string, v2: string) {
                  return {
                    limit(_n: number) {
                      const onProject = (projectMembers[v1] ?? []).includes(viewer);
                      if (table === "project_members") {
                        // member-only: a row exists only for a person who is on the project
                        const rows = onProject && (projectMembers[v1] ?? []).includes(v2) ? [{ id: "m1" }] : [];
                        return Promise.resolve({ data: rows, error: null });
                      }
                      return Promise.resolve({ data: [], error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    projectRowVisible: (projectId: string) =>
      (projectMembers[projectId] ?? []).includes(viewer) || communityMembers.includes(viewer),
  };
}

test("access: a community member who is NOT on the project is restricted, though the project row is visible", async () => {
  const db = fakeDb("cora", { p1: ["lee", "sam"] }, ["cora"]);
  assert.equal(db.projectRowVisible("p1"), true, "the live policy shows the row to a community member");
  const isMember = await hasProjectMemberRow(db, "p1", "cora");
  assert.equal(isMember, false);
  assert.equal(decideAccess({ signedIn: true, isMember }), "restricted");
});

test("access: a project member gets in; an error counts as not a member", async () => {
  const db = fakeDb("lee", { p1: ["lee", "sam"] }, []);
  assert.equal(await hasProjectMemberRow(db, "p1", "lee"), true);
  assert.equal(await hasProjectMemberRow(db, "p2", "lee"), false);
  const broken = {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: null, error: new Error("boom") }) }) }) }) }),
  };
  assert.equal(await hasProjectMemberRow(broken, "p1", "lee"), false);
});

test("access: nothing treats a visible projects row as membership", () => {
  // the shared loader every project page and /api project route goes through
  const projects = src("lib/server/projects.ts");
  const getProject = projects.slice(projects.indexOf("export async function getProject("));
  assert.match(getProject.slice(0, 20000), /m\.user_id === viewer\.id\)\) \{\s*return \{ status: "not_found" \}/);
  // the assistant's per-project status reads project_members before anything else
  const ops = src("lib/server/agent/agentProjectOps.ts");
  const status = ops.slice(ops.indexOf("async status("));
  assert.ok(status.indexOf('from("project_members")') > 0 && status.indexOf('from("project_members")') < status.indexOf('from("checklist_items")'));
  // the new ColaboFest modules read only member-gated tables
  for (const f of ["discussions.ts", "updates.ts", "welcome.ts"]) {
    assert.doesNotMatch(src(`lib/server/projectWorkspace/${f}`), /from\("projects"\)/, f);
  }
});

// ── program (the project home) vs challenge_key (the registration) ────────────

test("program: the project home follows projects.program, registration stays on challenge_key", () => {
  const page = src("app/projects/[id]/page.tsx");
  assert.match(page, /const isColabofest = project\.program === COLABOFEST_PROGRAM;/);
  assert.doesNotMatch(page, /COLABOFEST_KEY|challenge_key === "colabofest_2026"/);
  // registration things are still on challenge_key
  assert.match(page, /tab === "proposal" && project\.challenge_key/);
  assert.match(page, /parseTab\(sp\.tab, !!project\.challenge_key\)/);
  assert.match(page, /project\.challenge_key === COLABOFEST_CHALLENGE_KEY/);
  // a winning team (program, no challenge_key) gets no Proposal tab; a registration gets no home
  assert.ok(!visibleTabs(false).includes("proposal"));
  assert.ok(visibleTabs(true).includes("proposal"));
  // the program view, the list chip and the assistant use program
  assert.match(src("lib/server/projectWorkspace/program.ts"), /\.eq\("program", COLABOFEST_PROGRAM\)/);
  assert.match(src("components/projects/ProjectCard.tsx"), /project\.program === COLABOFEST_PROGRAM/);
  assert.match(src("lib/server/agent/agentProjectOps.ts"), /p\.program === COLABOFEST_PROGRAM/);
  assert.match(src("lib/server/projects.ts"), /challenge_key, program, created_at/);
  assert.match(src("lib/server/projects.ts"), /challenge_key, program, target/);
});

test("program: one constant for the value, and the form posts the value the server saves", () => {
  assert.equal(COLABOFEST_CHALLENGE_KEY, "colabofest_2026");
  assert.equal(COLABOFEST_PROGRAM, "colabofest_2026");
  assert.doesNotMatch(src("components/projects/CreateProjectForm.tsx"), /"colabofest2026"|value="colabofest/);
  assert.doesNotMatch(src("app/projects/actions.ts"), /"colabofest2026"/);
  assert.match(src("components/projects/CreateProjectForm.tsx"), /<option value=\{COLABOFEST_CHALLENGE_KEY\}>/);
  for (const f of ["app/projects/[id]/page.tsx", "lib/server/projectWorkspace/program.ts", "lib/server/projectWorkspace/status.ts"]) {
    assert.doesNotMatch(noComments(src(f)), /["']colabofest_2026["']/, f);
  }
});

test("program (database): only a site admin or no session can set it; the lists follow", () => {
  const t = noComments(sql("2026-10-31_project_program.sql"));
  assert.match(t, /ADD COLUMN IF NOT EXISTS program TEXT;/);
  assert.match(t, /CHECK \(program IS NULL OR program = 'colabofest_2026'\)/);
  assert.match(t, /IF auth\.uid\(\) IS NULL THEN\s+RETURN NEW;/);
  assert.match(t, /IF public\.is_site_admin\(\) THEN\s+RETURN NEW;/);
  assert.match(t, /NEW\.program := NULL;/);
  assert.match(t, /NEW\.program := OLD\.program;/);
  assert.match(t, /BEFORE INSERT OR UPDATE ON public\.projects/);
  assert.match(t, /p\.challenge_key IS NOT NULL OR p\.program IS NOT NULL/);
  assert.doesNotMatch(t, /GRANT[^;]*TO anon/i);
});

test("access: the restricted card wraps emails anywhere and keeps its width", () => {
  const screens = src("components/projects/workspace/AccessScreens.tsx");
  assert.match(screens, /max-w-md/);
  assert.match(screens, /\[overflow-wrap:anywhere\]/);
  assert.doesNotMatch(screens, /break-all/);
});
