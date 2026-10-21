// Run with `npm test`. Tab visibility, what a signed-out visitor can see, and
// the Updates stream on the community page.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUpdates,
  downloadHref,
  eyebrow,
  feedDateLabel,
  initials,
  isImageFile,
  joinModeLabel,
  joinUrl,
  latestDate,
  membersWorkingOn,
  resolveTab,
  shortDate,
  sourceName,
  feedTag,
  viewerAccess,
  visibleTabs,
} from "./communityHome.ts";

const ALL = ["projects", "members", "resources", "explore", "announcements", "events", "who_can_help", "showcase"].map((key) => ({
  key,
  enabled: true,
}));
const without = (...keys: string[]) => ALL.map((s) => (keys.includes(s.key) ? { ...s, enabled: false } : s));

// ── tabs ─────────────────────────────────────────────────────────────────────

test("visibleTabs: a member of a community with every section gets all six tabs, in order", () => {
  assert.deepEqual(visibleTabs(ALL, { isMember: true, publicPreview: "standard" }), [
    "home", "resources", "pages", "events", "members", "showcase",
  ]);
});

test("visibleTabs: a tab is hidden when its section is turned off", () => {
  const v = { isMember: true, publicPreview: "minimal" };
  assert.ok(!visibleTabs(without("events"), v).includes("events"));
  assert.ok(!visibleTabs(without("members"), v).includes("members"));
  assert.ok(!visibleTabs(without("showcase"), v).includes("showcase"));
  assert.ok(!visibleTabs(without("resources", "explore"), v).includes("resources"));
  assert.ok(visibleTabs(without("resources"), v).includes("resources"), "the Explore feed still needs the tab");
  assert.deepEqual(visibleTabs(without("events", "members", "showcase", "resources", "explore"), v), ["home", "pages"]);
});

test("visibleTabs: a non-member on a 'standard' or 'minimal' community sees only Home, Events and Showcase", () => {
  for (const publicPreview of ["standard", "minimal", null]) {
    assert.deepEqual(visibleTabs(ALL, { isMember: false, publicPreview }), ["home", "events", "showcase"], String(publicPreview));
  }
});

test("visibleTabs: a non-member on an 'open' community gets the member tabs too", () => {
  assert.deepEqual(visibleTabs(ALL, { isMember: false, publicPreview: "open" }), [
    "home", "resources", "pages", "events", "members", "showcase",
  ]);
});

test("resolveTab: an unknown or hidden tab falls back to Home", () => {
  const tabs = visibleTabs(ALL, { isMember: false, publicPreview: "minimal" });
  assert.equal(resolveTab("showcase", tabs), "showcase");
  assert.equal(resolveTab("members", tabs), "home");
  assert.equal(resolveTab("nope", tabs), "home");
  assert.equal(resolveTab(undefined, tabs), "home");
});

// ── signed-out visitors ──────────────────────────────────────────────────────

test("viewerAccess: signed-out on 'open' sees the pinned resource, resources, updates and members, with a join prompt", () => {
  const a = viewerAccess({ isMember: false, publicPreview: "open" });
  assert.deepEqual(a, { openPreview: true, seesMembers: true, seesPinned: true, seesResources: true, seesUpdates: true, joinPrompt: true });
});

test("viewerAccess: signed-out on 'standard' or 'minimal' sees none of the member content", () => {
  for (const publicPreview of ["standard", "minimal", undefined]) {
    const a = viewerAccess({ isMember: false, publicPreview });
    assert.equal(a.seesPinned, false);
    assert.equal(a.seesResources, false);
    assert.equal(a.seesUpdates, false);
    assert.equal(a.seesMembers, false);
    assert.equal(a.joinPrompt, true);
  }
});

test("viewerAccess: a member sees everything and gets no join prompt, whatever the level", () => {
  const a = viewerAccess({ isMember: true, publicPreview: "minimal" });
  assert.equal(a.seesPinned && a.seesResources && a.seesUpdates && a.seesMembers, true);
  assert.equal(a.joinPrompt, false);
});

// ── updates ──────────────────────────────────────────────────────────────────

const ann = (id: string, created_at: string, title = "News " + id) => ({ id, title, body: "Body " + id, created_at });
const feed = (
  id: string,
  kind: string,
  published_at: string | null,
  url: string | null = "https://example.org/" + id,
  raw: Record<string, unknown> | null = null
) => ({
  id,
  kind,
  title: "Item " + id,
  url,
  summary: null,
  source: "PubMed",
  published_at,
  raw,
});
const NOW = Date.parse("2026-10-21T12:00:00Z");

test("buildUpdates: newest first by each item's own date, announcements merged in, with type tags", () => {
  const rows = buildUpdates(
    [ann("1", "2026-10-01T00:00:00Z"), ann("2", "2026-10-20T00:00:00Z")],
    [feed("a", "paper", "2026-10-10T00:00:00Z"), feed("b", "paper", "2026-09-01T00:00:00Z")],
    12,
    NOW
  );
  assert.deepEqual(rows.map((r) => r.id), ["a:2", "f:a", "a:1", "f:b"]);
  assert.deepEqual(rows.map((r) => r.tag), ["Announcement", "Paper", "Announcement", "Paper"]);
});

test("buildUpdates: future-dated and undated items go AFTER every dated item", () => {
  const rows = buildUpdates(
    [ann("1", "2026-08-01T00:00:00Z")],
    [
      feed("future", "trial", "2026-11-15T00:00:00Z"),
      feed("undated", "tool", null),
      feed("old", "paper", "2019-05-01T00:00:00Z"),
      feed("far", "dataset", "2027-02-01T00:00:00Z"),
      feed("new", "paper", "2026-10-10T00:00:00Z"),
    ],
    12,
    NOW
  );
  // dated (newest first): new, announcement, old; then the rest in arrival order
  assert.deepEqual(rows.map((r) => r.id), ["f:new", "a:1", "f:old", "f:future", "f:undated", "f:far"]);
});

test("buildUpdates: the date shown is the item's own, never a future date, and there is no 'added' label", () => {
  const rows = buildUpdates(
    [ann("1", "2026-10-20T00:00:00Z")],
    [
      feed("paper", "paper", "2019-05-01T00:00:00Z"),
      feed("odd", "dataset", "2027-02-01T00:00:00Z"),
      feed("none", "tool", null),
    ],
    12,
    NOW
  );
  const label = (id: string) => rows.find((r) => r.id === id)?.dateLabel;
  assert.equal(label("f:paper"), "May 1, 2019");
  assert.equal(label("f:odd"), "", "a future date is not shown");
  assert.equal(label("f:none"), "");
  assert.equal(label("a:1"), "Oct 20, 2026");
  for (const r of rows) assert.ok(!/added|2027/.test(r.dateLabel), r.dateLabel);
});

test("feedDateLabel: a trial shows its status and phase instead of a date", () => {
  const start = "2026-11-15T00:00:00Z";
  assert.equal(feedDateLabel("trial", start, { overall_status: "RECRUITING", phase: "PHASE2" }, NOW), "Recruiting · Phase 2");
  assert.equal(feedDateLabel("trial", start, { overall_status: "ACTIVE_NOT_RECRUITING", phase: "PHASE1/PHASE2" }, NOW), "Active not recruiting · Phase 1/2");
  assert.equal(feedDateLabel("trial", "2020-01-01T00:00:00Z", { overall_status: "COMPLETED", phase: "EARLY_PHASE1" }, NOW), "Completed · Early phase 1");
  assert.equal(feedDateLabel("trial", start, { overall_status: "RECRUITING", phase: "NA" }, NOW), "Recruiting");
  assert.equal(feedDateLabel("trial", start, null, NOW), "");
  assert.equal(feedDateLabel("paper", "2026-10-01T00:00:00Z", { overall_status: "x" }, NOW), "Oct 1, 2026");
});

test("buildUpdates: a non-http link is dropped and the list is capped", () => {
  const rows = buildUpdates(
    [],
    [feed("x", "tool", "2026-09-01T00:00:00Z", "javascript:alert(1)"), ...Array.from({ length: 20 }, (_, i) => feed("n" + i, "paper", `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`))],
    5,
    NOW
  );
  assert.equal(rows.length, 5);
  assert.equal(rows[0].id, "f:n19");
  const all = buildUpdates([], [feed("x", "tool", "2026-09-01T00:00:00Z", "javascript:alert(1)")], 12, NOW);
  assert.equal(all[0].url, null);
});

test("feedTag: every stored kind gets its own tag, papers are never 'News'", () => {
  const want: Record<string, string> = {
    paper: "Paper", preprint: "Preprint", trial: "Trial", grant: "Grant", dataset: "Dataset", news: "News",
    geneset: "Gene set", compound: "Compound", target: "Target", tool: "Tool", episode: "Podcast", approval: "Approval",
  };
  for (const [k, tag] of Object.entries(want)) assert.equal(feedTag(k).tag, tag, k);
  assert.equal(feedTag("Paper").tag, "Paper", "case-insensitive");
  assert.equal(feedTag("weird").tag, "Weird");
  assert.equal(feedTag("").tag, "Update");
  const rows = buildUpdates([], [feed("p", "paper", "2026-10-01T00:00:00Z"), feed("r", "preprint", "2026-09-01T00:00:00Z")], 12, NOW);
  assert.deepEqual(rows.map((r) => r.tag), ["Paper", "Preprint"]);
});

test("sourceName: display names for known codes, capitalised fallback otherwise", () => {
  const want: Record<string, string> = {
    openalex: "OpenAlex", pubmed: "PubMed", clinicaltrials: "ClinicalTrials.gov", grants_gov: "Grants.gov",
    geo: "GEO", biorxiv: "bioRxiv", europepmc: "Europe PMC", github: "GitHub", chembl: "ChEMBL", statnews: "STAT News",
  };
  for (const [k, n] of Object.entries(want)) assert.equal(sourceName(k), n, k);
  assert.equal(sourceName("OPENALEX"), "OpenAlex");
  assert.equal(sourceName("some_new_source"), "Some new source");
  assert.equal(sourceName("PubMed"), "PubMed");
  assert.equal(sourceName(""), null);
  assert.equal(sourceName(null), null);
  const rows = buildUpdates([], [{ ...feed("a", "trial", null), source: "clinicaltrials" }], 12, NOW);
  assert.equal(rows[0].source, "ClinicalTrials.gov");
});

test("feedTag: legacy kind 'news' from a scholarly source is a Paper; RSS news stays News", () => {
  for (const s of ["openalex", "pubmed", "crossref", "europepmc", "OpenAlex"]) {
    assert.equal(feedTag("news", s).tag, "Paper", s);
    assert.equal(feedTag("news", s).tint, "paper", s);
  }
  for (const s of ["statnews", "biopharmadive", "endpoints", null, undefined]) assert.equal(feedTag("news", s).tag, "News", String(s));
  assert.equal(feedTag("trial", "openalex").tag, "Trial");
  const rows = buildUpdates([], [{ ...feed("o", "news", "2026-10-01T00:00:00Z"), source: "openalex" }, { ...feed("s", "news", "2026-09-01T00:00:00Z"), source: "statnews" }], 12, NOW);
  assert.deepEqual(rows.map((r) => r.tag), ["Paper", "News"]);
});

// ── small helpers ────────────────────────────────────────────────────────────

test("eyebrow and joinUrl", () => {
  assert.equal(eyebrow(true), "COMMUNITY · OPEN TO JOIN");
  assert.equal(eyebrow(false), "COMMUNITY · REQUEST TO JOIN");
  assert.equal(joinUrl("https://x.org/", "ai-drug"), "https://x.org/communities/ai-drug?join=1");
});

test("initials, latestDate, shortDate", () => {
  assert.equal(initials("Ada Lovelace"), "AL");
  assert.equal(initials("ada@x.org"), "AD");
  assert.equal(latestDate([null, "2026-01-02T00:00:00Z", "2026-03-04T00:00:00Z", "bad"]), "2026-03-04T00:00:00Z");
  assert.equal(latestDate([]), null);
  assert.equal(shortDate("2026-10-21T10:00:00Z"), "Oct 21, 2026");
  assert.equal(shortDate(null), "");
});

test("files: image detection and a download link", () => {
  assert.equal(isImageFile("cover.PNG"), true);
  assert.equal(isImageFile("slides.pptx"), false);
  assert.equal(downloadHref("https://s/x?token=1", "a b.pdf"), "https://s/x?token=1&download=a%20b.pdf");
});

test("membersWorkingOn: only members who set a focus, never hidden ones", () => {
  const rows = membersWorkingOn([
    { member_id: "1", display_name: "A", focus: "KRAS", hidden: false },
    { member_id: "2", display_name: "B", focus: null, hidden: false },
    { member_id: "3", display_name: "C", focus: "  ", hidden: false },
    { member_id: "4", display_name: "D", focus: "EGFR", hidden: true },
  ]);
  assert.deepEqual(rows, [{ id: "1", name: "A", focus: "KRAS" }]);
});

test("joinModeLabel: how people get into a community", () => {
  assert.equal(joinModeLabel(true), "Open to join");
  assert.equal(joinModeLabel(false), "Request to join");
});
