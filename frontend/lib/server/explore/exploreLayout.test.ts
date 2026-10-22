// Run with `npm test`. The Explore redesign's pure rules: the four "Today"
// cards, the Browse tab list, the results tabs (counts and order), the mixed
// All list, the ?category mapping and the landing's communities.

import test from "node:test";
import assert from "node:assert/strict";
import {
  EXAMPLE_TOPICS,
  categoryToTab,
  latestEpisode,
  mixedAll,
  newestOf,
  pickCommunities,
  pickToday,
  resultTabs,
} from "./exploreLayout.ts";

const NOW = Date.parse("2026-10-24T12:00:00Z");
// Loose ExploreItem stand-in: only the fields the rules read.
const item = (kind: string, id: string, extra: Record<string, unknown> = {}) =>
  ({ id, kind, title: `${kind} ${id}`, summary: null, url: `https://example.org/${id}`, source: "pubmed", date_iso: null, signal: null, ...extra }) as never;
const section = (kind: string, n: number, prefix = kind) => ({
  kind,
  items: Array.from({ length: n }, (_, i) => item(kind, `${prefix}${i}`)),
}) as never;

// ── landing basics ───────────────────────────────────────────────────────────

test("the landing offers four example topics for any biomedical researcher", () => {
  assert.deepEqual(EXAMPLE_TOPICS, [
    "CRISPR screening",
    "Dementia care in rural communities",
    "NIH grants for AI in health",
    "KRAS in pancreatic cancer",
  ]);
});

// ── Today in drug discovery ──────────────────────────────────────────────────

const FULL = {
  approvals: [item("approval", "a-old", { date_iso: "2024-01-01T00:00:00Z" }), item("approval", "a-new", { date_iso: "2026-09-01T00:00:00Z", source: "openfda" })],
  news: [item("news", "n1", { date_iso: "2026-10-20T00:00:00Z", source: "statnews" }), item("news", "n2", { date_iso: "2026-10-01T00:00:00Z" })],
  labPapers: [item("paper", "lab-1", { date_iso: "2025-01-01T00:00:00Z", source: "aimed-lab" }), item("paper", "lab-0", { date_iso: "2023-01-01T00:00:00Z" })],
  trials: [
    item("trial", "t-closed", { raw: { overall_status: "COMPLETED", phase: "PHASE3" }, date_iso: "2026-10-22T00:00:00Z" }),
    item("trial", "t-rec", { raw: { overall_status: "RECRUITING", phase: "PHASE2" }, date_iso: "2026-05-01T00:00:00Z" }),
  ],
  episodes: [item("episode", "e1", { raw: { episode_number: 41 } }), item("episode", "e2", { raw: { episode_number: 64 } })],
  papers: [item("paper", "p1")],
};

test("pickToday: exactly four, one of each kind, in order", () => {
  const cards = pickToday(FULL, NOW);
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((c) => c.slot), ["regulatory", "lab", "trial", "podcast"]);
  assert.deepEqual(cards.map((c) => c.id), ["n1", "lab-1", "t-rec", "e2"]);
});

test("pickToday: the regulatory slot is the newest of approvals and news together", () => {
  const onlyOldNews = { ...FULL, news: [item("news", "n-old", { date_iso: "2020-01-01T00:00:00Z" })] };
  assert.equal(pickToday(onlyOldNews, NOW)[0].id, "a-new");
  assert.equal(pickToday(onlyOldNews, NOW)[0].tag, "FDA approved");
  assert.equal(pickToday(FULL, NOW)[0].tag, "News");
});

test("pickToday: a future date is never 'newest'", () => {
  const future = { ...FULL, news: [item("news", "n-future", { date_iso: "2027-01-01T00:00:00Z" }), item("news", "n-now", { date_iso: "2026-10-23T00:00:00Z" })], approvals: [] };
  assert.equal(pickToday(future, NOW)[0].id, "n-now");
});

test("pickToday: the trial prefers a recruiting one, and its meta is status and phase, not a date", () => {
  const trial = pickToday(FULL, NOW)[2];
  assert.equal(trial.id, "t-rec");
  assert.equal(trial.meta, "Recruiting · Phase 2");
  assert.equal(trial.tag, "Trial");
});

test("pickToday: the lab paper is tagged and the podcast is the highest episode number", () => {
  const cards = pickToday(FULL, NOW);
  assert.equal(cards[1].tag, "Lab paper");
  assert.equal(cards[3].id, "e2");
  assert.equal(cards[3].tag, "Podcast");
});

test("pickToday: meta is a display source name and a date; titles and links are carried", () => {
  const [first] = pickToday(FULL, NOW);
  assert.equal(first.meta, "STAT News · Oct 20, 2026");
  assert.equal(first.url, "https://example.org/n1");
});

test("pickToday: a missing slot is filled from what is left, still four when the feed allows", () => {
  const noEpisodes = pickToday({ ...FULL, episodes: [] }, NOW);
  assert.equal(noEpisodes.length, 4);
  assert.equal(noEpisodes[3].slot, "more");
  assert.ok(new Set(noEpisodes.map((c) => c.id)).size === 4, "no item twice");
});

test("pickToday: a thin feed gives fewer than four rather than inventing cards", () => {
  assert.equal(pickToday({ news: [item("news", "only")] }, NOW).length, 1);
  assert.deepEqual(pickToday({}, NOW), []);
});

test("pickToday: a non-http link is dropped", () => {
  const [c] = pickToday({ news: [item("news", "x", { url: "javascript:alert(1)" })] }, NOW);
  assert.equal(c.url, null);
});

test("newestOf and latestEpisode: ordering rules", () => {
  assert.equal(newestOf([item("news", "a", { date_iso: "2026-01-01T00:00:00Z" }), item("news", "b", { date_iso: "2026-02-01T00:00:00Z" })], NOW)?.id, "b");
  assert.equal(newestOf([item("news", "a"), item("news", "b")], NOW)?.id, "a", "no dates: the first");
  assert.equal(newestOf([], NOW), null);
  assert.equal(latestEpisode([item("episode", "a", { date_iso: "2026-01-01T00:00:00Z" }), item("episode", "b", { date_iso: "2026-03-01T00:00:00Z" })], NOW)?.id, "b");
});

// ── communities near your work ───────────────────────────────────────────────

test("pickCommunities: the viewer's communities first, otherwise the largest; three of them", () => {
  const c = (name: string, count: number, member = false) => ({ community: { name, member_count: count }, member });
  const picked = pickCommunities([c("Big", 500), c("Mine small", 3, true), c("Mid", 50), c("Mine big", 40, true), c("Tiny", 1)]);
  assert.deepEqual(picked.map((p) => p.community.name), ["Mine big", "Mine small", "Big"]);
  assert.equal(pickCommunities([]).length, 0);
});

// ── results tabs ─────────────────────────────────────────────────────────────

const SECTIONS = [section("paper", 12), section("trial", 4), section("approval", 2), section("dataset", 3), section("news", 5), section("preprint", 1)];

test("resultTabs: All, then Papers, Trials, FDA, Compounds, Datasets, Grants, then other kinds that have results", () => {
  const tabs = resultTabs(SECTIONS);
  assert.deepEqual(tabs.map((t) => t.label), ["All", "Papers", "Trials", "FDA", "Compounds", "Datasets", "Grants", "Preprints", "News"]);
  assert.deepEqual(Object.fromEntries(tabs.map((t) => [t.key, t.count])), {
    all: 27, paper: 12, trial: 4, approval: 2, compound: 0, dataset: 3, grant: 0, preprint: 1, news: 5,
  });
});

test("resultTabs: other kinds follow a fixed order, empty ones never appear", () => {
  const tabs = resultTabs([section("episode", 1), section("tool", 2), section("target", 0), section("geneset", 1)]);
  assert.deepEqual(tabs.slice(7).map((t) => t.key), ["tool", "geneset", "episode"]);
});

test("resultTabs: no results at all still gives the fixed tabs at zero", () => {
  const tabs = resultTabs([]);
  assert.equal(tabs.length, 7);
  assert.ok(tabs.every((t) => t.count === 0));
});

test("categoryToTab: ?category maps to the tab; anything unknown or empty is All", () => {
  const tabs = resultTabs(SECTIONS);
  assert.equal(categoryToTab("trial", tabs), "trial");
  assert.equal(categoryToTab("approval", tabs), "approval");
  assert.equal(categoryToTab("news", tabs), "news");
  assert.equal(categoryToTab("compound", tabs), "compound", "a fixed tab is a valid target even at zero");
  assert.equal(categoryToTab("episode", tabs), "all", "no tab for it here");
  assert.equal(categoryToTab("communities", tabs), "all");
  assert.equal(categoryToTab("nonsense", tabs), "all");
  assert.equal(categoryToTab(null, tabs), "all");
  assert.equal(categoryToTab("", tabs), "all");
});

// ── the mixed All list ───────────────────────────────────────────────────────

test("mixedAll: FDA first, then papers, trials, then the rest; about ten items", () => {
  const groups = mixedAll(SECTIONS);
  assert.deepEqual(groups.map((g) => g.kind), ["approval", "paper", "trial", "dataset"]);
  assert.equal(groups[0].kind, "approval");
  assert.equal(groups[1].kind, "paper");
  assert.equal(groups[2].kind, "trial");
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  assert.ok(shown <= 10 && shown >= 9, String(shown));
});

test("mixedAll: each group knows its total so the page can offer 'See all <kind>'", () => {
  const groups = mixedAll(SECTIONS);
  const papers = groups.find((g) => g.kind === "paper")!;
  assert.equal(papers.total, 12);
  assert.ok(papers.items.length < papers.total);
  assert.equal(papers.label, "Papers");
  assert.equal(groups.find((g) => g.kind === "approval")!.label, "FDA");
});

test("mixedAll: a kind with few items gives its room to the others", () => {
  const groups = mixedAll([section("paper", 20), section("trial", 1)]);
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(shown, 10);
  assert.equal(groups.find((g) => g.kind === "trial")!.items.length, 1);
  assert.equal(groups.find((g) => g.kind === "paper")!.items.length, 9);
});

test("mixedAll: nothing in, nothing out; small result sets show everything", () => {
  assert.deepEqual(mixedAll([]), []);
  const small = mixedAll([section("approval", 1), section("paper", 2)]);
  assert.equal(small.reduce((n, g) => n + g.items.length, 0), 3);
});
