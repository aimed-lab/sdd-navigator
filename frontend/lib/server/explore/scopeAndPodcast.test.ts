// Run with `npm test`. The Explore scope picker (mapping to ?category and
// URLs), the Jump-to tiles, the grant / trial list orders, and podcast search
// across titles, descriptions, topics and transcripts with snippets.

import test from "node:test";
import assert from "node:assert/strict";
import {
  SCOPES,
  jumpTiles,
  scopeFromParam,
  scopeHref,
  scopeKinds,
  scopeParam,
  sortGrantsByDeadline,
  sortTrialsRecruitingFirst,
} from "./exploreLayout.ts";
import { episodeNumberQuery, highlightParts, queryTerms, searchEpisodes, snippetAround, type SearchableEpisode } from "./podcastSearch.ts";

// ── scope ────────────────────────────────────────────────────────────────────

test("the scope picker lists Everything first, then the eight scopes", () => {
  assert.deepEqual(SCOPES.map((s) => s.label), [
    "Everything", "Papers", "Preprints", "Clinical trials", "FDA approvals", "Grants", "Tools & datasets", "Podcast", "News",
  ]);
});

test("scopeFromParam: existing kind names, friendly plurals, and everything else is Everything", () => {
  assert.equal(scopeFromParam("grant"), "grant");
  assert.equal(scopeFromParam("grants"), "grant");
  assert.equal(scopeFromParam("Grants"), "grant");
  assert.equal(scopeFromParam("papers"), "paper");
  assert.equal(scopeFromParam("preprints"), "preprint");
  assert.equal(scopeFromParam("trials"), "trial");
  assert.equal(scopeFromParam("fda"), "approval");
  assert.equal(scopeFromParam("approval"), "approval");
  assert.equal(scopeFromParam("datasets"), "tool");
  assert.equal(scopeFromParam("tool"), "tool");
  assert.equal(scopeFromParam("podcast"), "episode");
  assert.equal(scopeFromParam("news"), "news");
  for (const none of [null, undefined, "", "all", "compound", "geneset", "communities", "nonsense"]) {
    assert.equal(scopeFromParam(none), "all", String(none));
  }
});

test("scopeParam: no category for Everything, the kind otherwise", () => {
  assert.equal(scopeParam("all"), null);
  assert.equal(scopeParam("grant"), "grant");
});

test("scopeHref: a topic searches within the scope; no topic opens the full list; podcast has its own page", () => {
  assert.equal(scopeHref("all", "CRISPR screening"), "/explore/CRISPR%20screening");
  assert.equal(scopeHref("grant", "AI in health"), "/explore/AI%20in%20health?category=grant");
  assert.equal(scopeHref("episode", "dementia care"), "/explore/podcast?q=dementia%20care");
  assert.equal(scopeHref("all", ""), "/explore");
  assert.equal(scopeHref("preprint", "  "), "/explore?category=preprint");
  assert.equal(scopeHref("episode", null), "/explore/podcast");
  assert.equal(scopeHref("trial", undefined), "/explore?category=trial");
});

// ── Jump to ──────────────────────────────────────────────────────────────────

test("jumpTiles: seven tiles, each with an icon, a line, and its own list", () => {
  const tiles = jumpTiles(69);
  assert.deepEqual(tiles.map((t) => t.title), ["Latest papers", "Preprints", "Open grants", "Clinical trials", "Tools & datasets", "Podcast", "News"]);
  for (const t of tiles) assert.ok(t.icon && t.line && t.href.startsWith("/explore"), t.title);
  assert.equal(tiles.find((t) => t.key === "podcast")!.href, "/explore/podcast");
  assert.equal(tiles.find((t) => t.key === "grants")!.href, "/explore?category=grant");
  assert.equal(tiles.find((t) => t.key === "grants")!.line, "Deadlines soonest first");
  assert.equal(tiles.find((t) => t.key === "trials")!.line, "Recruiting first");
});

test("jumpTiles: the podcast line uses the real count, and never invents one", () => {
  assert.equal(jumpTiles(69).find((t) => t.key === "podcast")!.line, "69 episodes · transcripts");
  assert.equal(jumpTiles(null).find((t) => t.key === "podcast")!.line, "Episodes · transcripts");
  assert.equal(jumpTiles(0).find((t) => t.key === "podcast")!.line, "Episodes · transcripts");
});

// ── list orders ──────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-10-24T12:00:00Z");
const it = (id: string, raw: Record<string, unknown>) => ({ id, kind: "x", title: id, summary: null, url: null, source: "s", date_iso: null, signal: null, raw }) as never;

test("sortGrantsByDeadline: open grants soonest first, then no deadline, closed last", () => {
  const sorted = sortGrantsByDeadline(
    [
      it("closed", { close_date: "2026-09-01" }),
      it("later", { close_date: "2026-12-31" }),
      it("none", {}),
      it("soon", { close_date: "2026-11-01" }),
      it("today", { close_date: "2026-10-24" }),
    ],
    NOW
  );
  assert.deepEqual(sorted.map((g) => (g as { id: string }).id), ["today", "soon", "later", "none", "closed"]);
});

test("sortTrialsRecruitingFirst keeps the order inside each group", () => {
  const sorted = sortTrialsRecruitingFirst([
    it("done1", { overall_status: "COMPLETED" }),
    it("rec1", { overall_status: "RECRUITING" }),
    it("done2", { overall_status: "TERMINATED" }),
    it("rec2", { overall_status: "recruiting" }),
  ]);
  assert.deepEqual(sorted.map((t) => (t as { id: string }).id), ["rec1", "rec2", "done1", "done2"]);
});

// ── podcast search ───────────────────────────────────────────────────────────

const ep = (n: number, over: Partial<SearchableEpisode> = {}): SearchableEpisode => ({
  id: `id${n}`,
  slug: `ep-${n}`,
  title: `Episode ${n}`,
  description: "",
  tags: [],
  concepts: [],
  transcript: "",
  episode_number: n,
  image_url: null,
  ...over,
});

const EPISODES = [
  ep(10, { title: "Drug repurposing with Dr. Jane Okafor", description: "How repurposing finds new uses for old drugs.", transcript: "Welcome. Today we talk about drug delivery and nanoparticles in detail." }),
  ep(11, { title: "Clinical AI", description: "Deploying models in hospitals.", tags: ["clinical", "ai"], transcript: "Guest Dr. Priya Raman explains that sepsis prediction fails when data drifts." }),
  ep(12, { title: "Protein folding", description: "AlphaFold and beyond.", concepts: [{ title: "Structure prediction" }], transcript: "We never discuss pricing here." }),
  ep(13, { title: "Funding", description: "", transcript: "The sepsis grant was funded by NIH last spring." }),
];

test("queryTerms: lowercase words, deduped", () => {
  assert.deepEqual(queryTerms("Drug  delivery, DRUG!"), ["drug", "delivery"]);
  assert.deepEqual(queryTerms("  "), []);
});

test("search finds a guest named in the title", () => {
  const hits = searchEpisodes(EPISODES, "okafor");
  assert.deepEqual(hits.map((h) => h.slug), ["ep-10"]);
  assert.equal(hits[0].field, "title");
});

test("search finds text that is only in the transcript, and shows the matching snippet", () => {
  const hits = searchEpisodes(EPISODES, "nanoparticles");
  assert.deepEqual(hits.map((h) => h.slug), ["ep-10"]);
  assert.equal(hits[0].field, "transcript");
  assert.equal(hits[0].snippet?.field, "transcript");
  assert.match(hits[0].snippet!.text, /nanoparticles/i);
});

test("search finds a guest who is only named in the transcript", () => {
  const hits = searchEpisodes(EPISODES, "priya raman");
  assert.deepEqual(hits.map((h) => h.slug), ["ep-11"]);
  assert.match(hits[0].snippet!.text, /Priya Raman/);
});

test("search matches descriptions, tags and concept titles", () => {
  assert.deepEqual(searchEpisodes(EPISODES, "alphafold").map((h) => h.slug), ["ep-12"]);
  assert.deepEqual(searchEpisodes(EPISODES, "structure").map((h) => h.slug), ["ep-12"]);
  assert.equal(searchEpisodes(EPISODES, "structure")[0].field, "topics");
  assert.deepEqual(searchEpisodes(EPISODES, "hospitals").map((h) => h.slug), ["ep-11"]);
});

test("every term must match (AND); terms may sit in different fields", () => {
  assert.deepEqual(searchEpisodes(EPISODES, "okafor delivery").map((h) => h.slug), ["ep-10"]);
  assert.deepEqual(searchEpisodes(EPISODES, "okafor sepsis"), []);
});

test("matching is by word prefix, not by substring", () => {
  assert.deepEqual(searchEpisodes(EPISODES, "deliv").map((h) => h.slug), ["ep-10"]);
  assert.deepEqual(searchEpisodes([ep(1, { transcript: "an available domain" })], "ai"), [], "'ai' is not inside 'available'");
});

test("title matches rank above description/topics, which rank above transcript-only", () => {
  const list = [
    ep(1, { title: "Other", transcript: "we mention sepsis once" }),
    ep(2, { title: "Sepsis in the ICU" }),
    ep(3, { title: "Something", description: "About sepsis detection" }),
  ];
  assert.deepEqual(searchEpisodes(list, "sepsis").map((h) => h.slug), ["ep-2", "ep-3", "ep-1"]);
});

test("a blank query finds nothing (the page shows the full grid instead)", () => {
  assert.deepEqual(searchEpisodes(EPISODES, ""), []);
  assert.deepEqual(searchEpisodes(EPISODES, "   "), []);
});

test("snippetAround: a short window around the first match, trimmed at word edges with ellipses", () => {
  const text = "x ".repeat(200) + "the sepsis model " + "y ".repeat(200);
  const s = snippetAround(text, ["sepsis"])!;
  assert.ok(s.startsWith("… ") && s.endsWith(" …"));
  assert.match(s, /sepsis/);
  assert.ok(s.length < 260, String(s.length));
  assert.equal(snippetAround("nothing here", ["sepsis"]), null);
  assert.equal(snippetAround("sepsis is short", ["sepsis"]), "sepsis is short");
});

test("highlightParts marks the matching words and keeps the rest", () => {
  assert.deepEqual(highlightParts("Early sepsis alerts", ["sepsis"]), [
    { text: "Early ", hit: false },
    { text: "sepsis", hit: true },
    { text: " alerts", hit: false },
  ]);
  assert.deepEqual(highlightParts("no match", ["zzz"]), [{ text: "no match", hit: false }]);
  assert.deepEqual(highlightParts("text", []), [{ text: "text", hit: false }]);
});

// ── episode-number queries ────────────────────────────────────────────────────

const NUMBERED = [
  ep(39, { title: "Market outlook", transcript: "Sales grew 334% in two years." }),
  ep(33, { title: "Single-cell methods", transcript: "We discuss clustering." }),
  ep(5, { title: "Intro", transcript: "Episode 33 is coming soon." }),
];

test("episodeNumberQuery reads 33, #33, ep 33, ep. 33 and episode 33", () => {
  for (const q of ["33", " 33 ", "#33", "ep 33", "ep. 33", "EP.33", "episode 33", "Episode #33"]) {
    assert.equal(episodeNumberQuery(q), 33, q);
  }
  for (const q of ["", "ep", "33 trials", "episode thirty", "crispr 33", "12345"]) {
    assert.equal(episodeNumberQuery(q), null, q);
  }
});

test("a number query shows that episode first, then the text matches", () => {
  for (const q of ["33", "ep 33", "ep. 33", "episode 33"]) {
    const hits = searchEpisodes(NUMBERED, q);
    assert.equal(hits[0].episode_number, 33, q);
    assert.equal(hits[0].field, "episode", q);
    // the "334%" transcript and the "Episode 33" mention still follow
    assert.deepEqual(hits.slice(1).map((h) => h.episode_number).sort(), [39, 5], q);
  }
});

test("a number with no such episode falls back to text matches only", () => {
  const hits = searchEpisodes(NUMBERED, "ep 334");
  assert.deepEqual(hits.map((h) => h.episode_number), [39]);
});

test("scopeKinds: the sources a scoped search queries directly", () => {
  assert.deepEqual(scopeKinds("grant"), ["grant"]);
  assert.deepEqual(scopeKinds("preprint"), ["preprint"]);
  assert.deepEqual(scopeKinds("approval"), ["approval"]);
  assert.deepEqual(scopeKinds("tool"), ["tool", "dataset"]);
  assert.equal(scopeKinds("all"), null);
  assert.equal(scopeKinds("episode"), null);
});
