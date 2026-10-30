import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLatest,
  chicagoToIso,
  eventBadge,
  eventDay,
  eventInputValues,
  eventTime,
  memberTileLabel,
  newCount,
  nextEventLabel,
  parseEventInput,
  resolveView,
  shortPinnedLabel,
  splitEvents,
  COMMUNITY_VIEWS,
} from "./tiles.ts";

test("the view comes from ?view=, else the old ?tab= mapped, else the home", () => {
  const all = COMMUNITY_VIEWS;
  assert.equal(resolveView("events", undefined, all), "events");
  assert.equal(resolveView(undefined, "members", all), "members");
  assert.equal(resolveView(undefined, "resources", all), "resources");
  assert.equal(resolveView(undefined, "pages", all), "pages");
  assert.equal(resolveView(undefined, "home", all), null);
  assert.equal(resolveView(undefined, undefined, all), null);
  assert.equal(resolveView("bogus", "events", all), null, "?view= wins, and an unknown one is the home");
  // not available to this viewer (e.g. manage for a non-admin)
  assert.equal(resolveView("manage", undefined, ["events", "members"]), null);
});

test("tile labels: Investigators only for sparc-investigators", () => {
  assert.equal(memberTileLabel("sparc-investigators"), "Investigators");
  assert.equal(memberTileLabel("biokdd"), "Members");
  assert.equal(shortPinnedLabel("SPARC Investigator application form"), "Apply");
  assert.equal(shortPinnedLabel("Apply to join"), "Apply");
  assert.equal(shortPinnedLabel("Lab safety handbook 2026"), "Lab safety");
  assert.equal(shortPinnedLabel("Supercalifragilistic"), "Supercalifrag…");
  assert.equal(shortPinnedLabel("  "), "Pinned");
});

test("N new: posts in the last 7 days", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const items = [{ created_at: "2026-11-09T00:00:00Z" }, { created_at: "2026-11-03T13:00:00Z" }, { created_at: "2026-11-03T11:00:00Z" }, { created_at: "garbage" }];
  assert.equal(newCount(items, now), 2);
  assert.equal(newCount([], now), 0);
});

test("events: upcoming first, then past; the tile line", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const ev = [{ starts_at: "2026-12-15T18:00:00Z" }, { starts_at: "2026-11-01T18:00:00Z" }, { starts_at: "2026-11-13T20:00:00Z" }, { starts_at: "2026-10-01T18:00:00Z" }];
  const { upcoming, past } = splitEvents(ev, now);
  assert.deepEqual(upcoming.map((e) => e.starts_at), ["2026-11-13T20:00:00Z", "2026-12-15T18:00:00Z"]);
  assert.deepEqual(past.map((e) => e.starts_at), ["2026-11-01T18:00:00Z", "2026-10-01T18:00:00Z"]);
  assert.equal(nextEventLabel(ev, now), "Next: Nov 13");
  assert.equal(nextEventLabel([{ starts_at: "2026-10-01T18:00:00Z" }], now), "None yet");
  assert.equal(nextEventLabel([], now), "None yet");
});

test("dates and times are Chicago time", () => {
  assert.equal(chicagoToIso("2026-11-13", "14:00"), "2026-11-13T20:00:00.000Z"); // CST, UTC-6
  assert.equal(chicagoToIso("2026-07-04", "14:00"), "2026-07-04T19:00:00.000Z"); // CDT, UTC-5
  assert.equal(chicagoToIso("2026-02-31", "10:00"), null);
  assert.equal(chicagoToIso("2026-13-01", "10:00"), null);
  assert.equal(chicagoToIso("2026-11-13", "25:00"), null);
  assert.equal(chicagoToIso("nope", "10:00"), null);
  assert.equal(eventDay("2026-11-13T20:00:00Z"), "Nov 13");
  assert.equal(eventTime("2026-11-13T20:00:00Z"), "2:00 PM");
  assert.deepEqual(eventBadge("2026-11-13T20:00:00Z"), { month: "NOV", day: "13" });
  assert.deepEqual(eventInputValues("2026-11-13T20:00:00Z"), { date: "2026-11-13", time: "14:00" });
  // a late-evening event stays on its own Chicago day
  assert.equal(eventDay("2026-11-14T03:30:00Z"), "Nov 13");
});

test("event input: title, real date, https link only, trimmed optional text", () => {
  const ok = parseEventInput({ title: "  ColaboFest  presentations ", date: "2026-11-13", time: "14:00", location: " UAB ", link: "https://example.org/x", description: " Talks " });
  assert.deepEqual(ok, {
    ok: true,
    value: { title: "ColaboFest presentations", starts_at: "2026-11-13T20:00:00.000Z", location: "UAB", link: "https://example.org/x", description: "Talks" },
  });
  const min = parseEventInput({ title: "Talk", date: "2026-11-13" });
  assert.equal(min.ok && min.value.location, null);
  assert.equal(min.ok && min.value.link, null);
  assert.equal(parseEventInput({ title: "", date: "2026-11-13" }).ok, false);
  assert.equal(parseEventInput({ title: "x" }).ok, false);
  assert.equal(parseEventInput({ title: "x", date: "2026-02-30" }).ok, false);
  for (const bad of ["http://example.org", "javascript:alert(1)", "example.org", "https://a b"]) {
    assert.equal(parseEventInput({ title: "x", date: "2026-11-13", link: bad }).ok, false, bad);
  }
  assert.equal(parseEventInput({ title: "x".repeat(201), date: "2026-11-13" }).ok, false);
});

test("Latest: announcements, upcoming events and joins mixed, newest first, at most six", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const out = buildLatest(
    {
      announcements: [
        { id: "a1", title: "Welcome", created_at: "2026-10-30T10:00:00Z", author: "Jake Chen" },
        { id: "a2", title: "Old news", created_at: "2026-09-01T10:00:00Z" },
      ],
      events: [
        { id: "e1", title: "Presentations", starts_at: "2026-11-13T20:00:00Z", created_at: "2026-11-02T10:00:00Z" },
        { id: "e2", title: "Past talk", starts_at: "2026-10-01T20:00:00Z", created_at: "2026-10-31T10:00:00Z" },
      ],
      joins: [{ id: "j1", name: "Zhandos Sembay", at: "2026-11-05T10:00:00Z" }],
    },
    now
  );
  assert.deepEqual(out.map((e) => e.key), ["j:j1", "e:e1", "a:a1", "a:a2"]);
  assert.equal(out[1].meta, "Event · Nov 13");
  assert.equal(out[0].title, "Zhandos Sembay joined");
  assert.equal(out[2].meta, "Announcement · Jake Chen");
  const many = buildLatest({ announcements: Array.from({ length: 9 }, (_, i) => ({ id: String(i), title: "t", created_at: `2026-10-0${i + 1}T00:00:00Z` })), events: [], joins: [] }, now);
  assert.equal(many.length, 6);
});

// ── the community page and the migration ──────────────────────────────────────

import { readFileSync } from "node:fs";
const lf = (t: string) => t.split(String.fromCharCode(13)).join("");
const src = (rel: string) => lf(readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8"));
const sql = (name: string) => lf(readFileSync(new URL(`../../../../database/migrations/${name}`, import.meta.url), "utf8"));
const noComments = (t: string) => t.replace(/--.*$/gm, "");

test("community page: a member gets tiles; the old boxes are no longer rendered", () => {
  const page = src("app/communities/[slug]/page.tsx");
  assert.match(page, /<CommunityTiles slug=\{slug\} view=\{view\} tiles=\{tiles\} \/>/);
  const member = page.slice(page.indexOf("A MEMBER: tiles"), page.indexOf("A NON-MEMBER: what they saw"));
  assert.doesNotMatch(member, /WelcomeChecklist|UpdatesList|DigestCard|MembersWorkingOnCard|ManageCommunityCard|linkedTeams|Teams"/);
  assert.doesNotMatch(page, /<WelcomeChecklist|<ManageCommunityCard|listLinkedTeams|getMyOnboarding/);
  // old ?tab= links still resolve
  assert.match(page, /resolveView\(query\.view, query\.tab, available\)/);
  // the manage view holds what the manage panel held
  const manage = member.slice(member.indexOf('view === "manage"'));
  for (const c of ["SectionsEditor", "IsOpenEditor", "PublicPreviewEditor", "AddMemberByEmailForm", "PendingRequestsPanel", "ExploreFeedEditor", "MemberRoster"]) {
    assert.ok(manage.includes(`<${c}`), c);
  }
  // a non-member keeps the tab bar and today's content
  const non = page.slice(page.indexOf("A NON-MEMBER: what they saw"));
  assert.match(non, /<CommunityTabs/);
  assert.match(non, /<UpdatesList/);
  // events are read for members only
  assert.match(page, /isMember && sectionOn\("events"\) \? listCommunityEvents/);
});

test("tiles: 3 across on a phone, 6 on a desktop, selected has a 2px UAB Green border, Manage is dashed", () => {
  const t = src("components/communities/CommunityTiles.tsx");
  assert.match(t, /basis-\[calc\(\(100%-20px\)\/3\)\] md:basis-\[calc\(\(100%-50px\)\/6\)\]/);
  assert.match(t, /border-2 border-primary/);
  assert.match(t, /border-dashed/);
  assert.doesNotMatch(t, /#(?:22c55e|16a34a|166534|dcfce7)|green-\d|emerald/);
  const page = src("app/communities/[slug]/page.tsx");
  assert.match(page, /label: memberTileLabel\(slug\)/);
  assert.match(page, /key: "pinned", label: shortPinnedLabel\(pinned\.title\)/);
  assert.match(page, /membership\.isAdmin\) \{\s*tiles\.push\(\{\s*key: "manage"/);
  assert.match(page, /badge: fresh > 0 \? `\$\{fresh\} new` : null/);
});

test("events migration: members read, admins write, nobody else", () => {
  const t = noComments(sql("2026-11-03_community_events.sql"));
  assert.match(t, /CREATE TABLE IF NOT EXISTS public\.community_events/);
  assert.match(t, /community_id UUID\s+NOT NULL REFERENCES public\.communities \(id\) ON DELETE CASCADE/);
  assert.match(t, /starts_at\s+TIMESTAMPTZ NOT NULL/);
  assert.match(t, /link ~\* '\^https:\/\/'/);
  assert.match(t, /ENABLE ROW LEVEL SECURITY/);
  const sel = /CREATE POLICY "Community events: member select"[\s\S]*?;\n/.exec(t)![0];
  assert.match(sel, /is_community_member\(community_id, auth\.uid\(\)\)/);
  for (const [name, op] of [["admin insert", "INSERT"], ["admin update", "UPDATE"], ["admin delete", "DELETE"]]) {
    const p = new RegExp('CREATE POLICY "Community events: ' + name + '"[\\s\\S]*?;\\n').exec(t)![0];
    assert.match(p, new RegExp(`FOR ${op}`));
    assert.match(p, /is_community_admin\(community_id, auth\.uid\(\)\)/);
  }
  assert.match(t, /created_by = auth\.uid\(\)/);
  assert.doesNotMatch(t, /GRANT[^;]*TO anon/i);
  assert.doesNotMatch(t, /USING\s*\(\s*true\s*\)/i);
  // idempotent
  assert.match(t, /DROP POLICY IF EXISTS "Community events: member select"/);
  // the server and the actions check the admin before writing
  const ev = src("lib/server/communityEvents.ts");
  assert.equal((ev.match(/getMembership\(communityId\)\)\.isAdmin/g) ?? []).length, 3);
});

test("manage hides the Explore feed settings when Explore is off; home links only sections with something in them; pinned card matches the mockup", () => {
  const page = src("app/communities/[slug]/page.tsx");
  assert.match(page, /\{sectionOn\("explore"\) && \(\s*<ExploreFeedEditor/);
  assert.match(page, /const showPagesLink = available\.includes\("pages"\) && livingPages\.length > 0;/);
  assert.match(page, /const showShowcaseLink = available\.includes\("showcase"\) && sectionOn\("showcase"\) && showcaseEntries\.length > 0;/);
  assert.match(page, /\{\(showPagesLink \|\| showShowcaseLink\) && \(/);
  const pin = src("components/communities/PinnedResourceCard.tsx");
  assert.match(pin, /bg-white border border-\[#e8e4da\] border-l-4 border-l-primary/);
  assert.match(pin, /flex flex-col sm:flex-row/);
  assert.match(pin, /PINNED BY ADMIN/);
  assert.match(pin, /btn-primary[^"]*"[\s\S]*Open/);
});
