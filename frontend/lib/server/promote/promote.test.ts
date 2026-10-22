import test from "node:test";
import assert from "node:assert/strict";
import {
  CTA_DEFAULT_LABEL,
  KEY_FACT_LABELS,
  SHOWCASE_TYPES,
  SHOWCASE_TYPE_LABEL,
  beforeNowLine,
  canonicalType,
  defaultKeyFacts,
  eventBadge,
  factsForRow,
  firstLinkIn,
  firstSentence,
  fundingAmount,
  matchesType,
  MAX_FACT_CHARS,
  normalizeKeyFacts,
  pickFeatured,
  resolveCta,
  safeHttpUrl,
  visibleFacts,
} from "./showcaseKinds.ts";
import {
  ARTICLE_LINK,
  DEFAULT_SITE_URL,
  LINKEDIN_LIMIT,
  SHORT_LIMIT,
  articleUrlFor,
  blueskyComposeUrl,
  cardImageUrlFor,
  draftShareTexts,
  fillLink,
  hashtagsFor,
  linkedinShareUrl,
  normalizeShareTexts,
  shareLength,
  siteUrl,
  withinLimit,
  xComposeUrl,
} from "./shareText.ts";

// ── type mapping ─────────────────────────────────────────────────────────────

test("there are thirteen types, each with a label, three fact labels and a button", () => {
  assert.equal(SHOWCASE_TYPES.length, 13);
  assert.deepEqual(
    Object.values(SHOWCASE_TYPE_LABEL).sort(),
    ["Achievement", "Breakthrough", "Dataset", "Event", "Funding win", "Paper", "Partnership", "Poster", "Preprint", "Service", "Something else", "Talk & slides", "Tool & app"].sort()
  );
  for (const t of SHOWCASE_TYPES) {
    assert.equal(KEY_FACT_LABELS[t].length, 3, t);
    assert.ok(CTA_DEFAULT_LABEL[t], t);
  }
});

test("older types map onto the new ones; unknown goes to Something else", () => {
  assert.equal(canonicalType("award"), "achievement");
  assert.equal(canonicalType("case_study"), "achievement");
  assert.equal(canonicalType("achievement"), "achievement");
  assert.equal(canonicalType("white_paper"), "paper");
  for (const t of ["paper", "talk", "poster", "tool", "event", "other"]) assert.equal(canonicalType(t), t);
  assert.equal(canonicalType("nonsense"), "other");
  assert.equal(canonicalType(null), "other");
  assert.equal(canonicalType(undefined), "other");
});

test("a filter chip includes the older rows that map onto it", () => {
  assert.equal(matchesType("award", "achievement"), true);
  assert.equal(matchesType("white_paper", "paper"), true);
  assert.equal(matchesType("award", "paper"), false);
  assert.equal(matchesType("anything", "all"), true);
});

// ── key facts ────────────────────────────────────────────────────────────────

test("each type's three fact labels are the specified ones", () => {
  assert.deepEqual(KEY_FACT_LABELS.paper, ["The question", "What we did", "What we found"]);
  assert.deepEqual(KEY_FACT_LABELS.talk, ["Topic", "Where & when", "Key takeaway"]);
  assert.deepEqual(KEY_FACT_LABELS.event, ["What", "When & where", "Who should come"]);
  assert.deepEqual(KEY_FACT_LABELS.achievement, ["What", "Who", "Why it matters"]);
  assert.deepEqual(KEY_FACT_LABELS.breakthrough, ["The problem", "What changed", "What it means"]);
  assert.deepEqual(KEY_FACT_LABELS.partnership, ["Partners", "Goal", "What it means for researchers"]);
  assert.deepEqual(KEY_FACT_LABELS.funding, ["Funder", "Amount & length", "What it funds"]);
  assert.deepEqual(KEY_FACT_LABELS.tool, ["What it does", "Before vs now", "Who it's for"]);
  assert.deepEqual(KEY_FACT_LABELS.service, ["What we offer", "Who it's for", "How to request"]);
  assert.deepEqual(KEY_FACT_LABELS.dataset, ["What's in it", "Size & format", "How to use"]);
});

test("default key facts: three labelled blanks; nothing stored gives the blanks", () => {
  const f = defaultKeyFacts("funding");
  assert.deepEqual(f.map((x) => x.label), ["Funder", "Amount & length", "What it funds"]);
  assert.deepEqual(f.map((x) => x.value), ["", "", ""]);
  assert.deepEqual(normalizeKeyFacts("funding", []), f);
  assert.deepEqual(normalizeKeyFacts("funding", null), f);
  assert.deepEqual(normalizeKeyFacts("funding", "junk"), f);
});

test("stored facts keep their values, and labels fall back to the type's", () => {
  const f = normalizeKeyFacts("talk", [{ label: "", value: " Tumour models " }, { value: 5 }, { label: "Takeaway", value: "Reuse your pipelines" }]);
  assert.deepEqual(f, [
    { label: "Topic", value: "Tumour models" },
    { label: "Where & when", value: "" },
    { label: "Takeaway", value: "Reuse your pipelines" },
  ]);
  assert.equal(visibleFacts(f).length, 2);
});

test("an item with no stored facts shows no strip: nothing is derived for display", () => {
  assert.deepEqual(factsForRow("paper", []), []);
  assert.deepEqual(factsForRow("paper", null), []);
  assert.deepEqual(factsForRow("paper", [{ label: "The question", value: "" }, { label: "", value: " " }, {}]), []);
});

test("stored facts are shown as stored, blanks dropped, never cut", () => {
  const long = "Switching off one gene made the surviving cells vulnerable to the drug again, across all models tested";
  const f = factsForRow("paper", [{ label: "The question", value: "Why do cells survive?" }, { label: "", value: "" }, { label: "What we found", value: long }]);
  assert.deepEqual(f.map((x) => x.value), ["Why do cells survive?", long]);
  assert.ok(!f.some((x) => x.value.endsWith("...") || x.value.endsWith("…")));
});

test("the editor limit for a fact is 90 characters", () => {
  assert.equal(MAX_FACT_CHARS, 90);
});

test("firstSentence cuts to one sentence or a word edge", () => {
  assert.equal(firstSentence("One. Two."), "One.");
  const long = firstSentence("word ".repeat(60), 40);
  assert.ok(long.length <= 41 && long.endsWith("…"));
});

// ── main button ──────────────────────────────────────────────────────────────

test("the main button label defaults per type", () => {
  assert.equal(CTA_DEFAULT_LABEL.paper, "Read the paper");
  assert.equal(CTA_DEFAULT_LABEL.talk, "View slides");
  assert.equal(CTA_DEFAULT_LABEL.event, "Register");
  assert.equal(CTA_DEFAULT_LABEL.tool, "Try it");
  assert.equal(CTA_DEFAULT_LABEL.service, "Request this service");
  assert.equal(CTA_DEFAULT_LABEL.dataset, "Get the data");
  assert.equal(CTA_DEFAULT_LABEL.partnership, "Learn more");
  assert.equal(CTA_DEFAULT_LABEL.achievement, "Read more");
});

test("resolveCta: the author's link wins, then the DOI, then the link, then the fallback", () => {
  assert.deepEqual(resolveCta("paper", { ctaLabel: "See it", ctaUrl: "https://a.org/x", doi: "10.1/x", link: "https://b.org" }), { label: "See it", url: "https://a.org/x" });
  assert.deepEqual(resolveCta("paper", { doi: "10.1126/science.1" }), { label: "Read the paper", url: "https://doi.org/10.1126/science.1" });
  assert.equal(resolveCta("tool", { link: "https://github.com/x/y" })?.label, "Try it");
  assert.equal(resolveCta("talk", {}, "https://files/deck.pdf")?.url, "https://files/deck.pdf");
  assert.equal(resolveCta("talk", {}), null);
  assert.equal(resolveCta("event", { ctaUrl: "javascript:alert(1)" }), null);
});

test("the first link written in the text is the button's fallback", () => {
  const body = "## Where\n\nSee the pilot at https://example.org/pilot, and also https://other.org/x.";
  assert.equal(firstLinkIn(body), "https://example.org/pilot");
  assert.equal(firstLinkIn("no links here"), null);
  assert.equal(firstLinkIn("mail me at javascript:alert(1)"), null);
  // a type with no link of its own points its label at the body link; with none anywhere there is no button
  assert.deepEqual(resolveCta("partnership", {}, firstLinkIn(body)), { label: "Learn more", url: "https://example.org/pilot" });
  assert.equal(resolveCta("partnership", {}, firstLinkIn("nothing")), null);
});

test("only http(s) links become buttons", () => {
  assert.equal(safeHttpUrl("https://x.org/a"), "https://x.org/a");
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("not a url"), null);
  assert.equal(safeHttpUrl(""), null);
});

// ── card details ─────────────────────────────────────────────────────────────

test("funding amount is read from the Amount & length fact", () => {
  const f = (v: string) => [{ label: "Funder", value: "NIH" }, { label: "Amount & length", value: v }, { label: "What it funds", value: "" }];
  assert.equal(fundingAmount(f("$1.2M over 3 years")), "$1.2M");
  assert.equal(fundingAmount(f("1.9 million dollars over four years")), "1.9 million dollars");
  assert.equal(fundingAmount(f("Three years")), null);
});

test("tool before/now line and event badge", () => {
  assert.equal(beforeNowLine([{ label: "", value: "" }, { label: "", value: "Before: by hand. Now: one command." }, { label: "", value: "" }]), "Before: by hand. Now: one command.");
  assert.deepEqual(eventBadge("2026-06-12T14:00:00Z"), { month: "JUN", day: "12" });
  assert.equal(eventBadge(null), null);
  assert.equal(eventBadge("garbage"), null);
});

test("the featured story is the newest admin-featured one, else the newest", () => {
  const list = [{ id: "a", featured: false }, { id: "b", featured: true }, { id: "c", featured: true }];
  assert.equal(pickFeatured(list)?.id, "b");
  assert.equal(pickFeatured(list.map((e) => ({ ...e, featured: false })))?.id, "a");
  assert.equal(pickFeatured([]), null);
});

// ── site URL and share links ─────────────────────────────────────────────────

test("the site URL defaults to connect.smartdrugdiscovery.org, never the v2 host", () => {
  assert.equal(DEFAULT_SITE_URL, "https://connect.smartdrugdiscovery.org");
  assert.equal(siteUrl(undefined), "https://connect.smartdrugdiscovery.org");
  assert.equal(siteUrl(""), "https://connect.smartdrugdiscovery.org");
  assert.equal(siteUrl("not a url"), "https://connect.smartdrugdiscovery.org");
  assert.equal(siteUrl("ftp://x.org"), "https://connect.smartdrugdiscovery.org");
  assert.equal(siteUrl("https://example.org/some/path/"), "https://example.org");
  assert.ok(!DEFAULT_SITE_URL.includes("v2."));
});

test("article and card URLs are built from the base", () => {
  assert.equal(articleUrlFor("https://connect.smartdrugdiscovery.org", "my-paper"), "https://connect.smartdrugdiscovery.org/promote/my-paper");
  assert.equal(articleUrlFor("https://x.org/", "a"), "https://x.org/promote/a");
  assert.equal(cardImageUrlFor("https://x.org", "a"), "https://x.org/promote/a/opengraph-image");
});

test("compose links are prefilled and encoded; LinkedIn shares the link only", () => {
  assert.equal(xComposeUrl("Hi & bye https://x.org/a"), "https://twitter.com/intent/tweet?text=Hi%20%26%20bye%20https%3A%2F%2Fx.org%2Fa");
  assert.equal(blueskyComposeUrl("Hello #sci"), "https://bsky.app/intent/compose?text=Hello%20%23sci");
  assert.equal(linkedinShareUrl("https://x.org/a?b=1"), "https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fx.org%2Fa%3Fb%3D1");
});

// ── share text drafts and limits ─────────────────────────────────────────────

const URL = "https://connect.smartdrugdiscovery.org/promote/a-fairly-long-slug-for-a-research-paper-about-cells";
const SRC = {
  type: "paper",
  headline: "Rare cells survive treatment by switching off one gene",
  standfirst: "Our lab found why a few tumour cells survive chemotherapy. The answer was a single gene.",
  facts: [
    { label: "The question", value: "Why do some tumour cells survive chemotherapy?" },
    { label: "What we did", value: "We screened 200 compounds in patient organoids." },
    { label: "What we found", value: "Switching off gene X made survivors vulnerable again." },
  ],
  tags: ["oncology", "organoids", "chemotherapy resistance"],
  url: URL,
};

test("LinkedIn draft: within ~1,300 characters, hook, finding, link, tags placeholder, 1-3 hashtags", () => {
  const t = draftShareTexts(SRC);
  assert.ok(shareLength(t.linkedin, URL) <= LINKEDIN_LIMIT);
  assert.ok(t.linkedin.startsWith("Our lab found why a few tumour cells survive chemotherapy."));
  assert.ok(t.linkedin.includes("Switching off gene X made survivors vulnerable again."));
  assert.ok(t.linkedin.includes(ARTICLE_LINK));
  assert.ok(t.linkedin.includes("Tagging: @[collaborator] @[institution]"));
  const hashtags = t.linkedin.match(/#[A-Za-z0-9]+/g) ?? [];
  assert.ok(hashtags.length >= 1 && hashtags.length <= 3, String(hashtags));
});

test("X and Bluesky drafts are under 280 characters with the link filled in", () => {
  const t = draftShareTexts(SRC);
  for (const text of [t.x, t.bluesky]) {
    assert.ok(text.includes(ARTICLE_LINK));
    assert.ok(shareLength(text, URL) <= SHORT_LIMIT, String(shareLength(text, URL)));
    assert.ok(shareLength(text, URL) < 280);
    assert.ok(fillLink(text, URL).includes(URL));
  }
});

test("very long text is trimmed to stay inside every limit", () => {
  const long = "A very long sentence about research that just keeps going and going. ".repeat(40);
  const t = draftShareTexts({ ...SRC, headline: long, standfirst: long, facts: SRC.facts.map((f) => ({ ...f, value: long })) });
  assert.ok(withinLimit("linkedin", t.linkedin, URL), String(shareLength(t.linkedin, URL)));
  assert.ok(withinLimit("x", t.x, URL), String(shareLength(t.x, URL)));
  assert.ok(withinLimit("bluesky", t.bluesky, URL));
});

test("an item with no standfirst or facts still drafts from its headline", () => {
  const t = draftShareTexts({ type: "event", headline: "Pipeline workshop in Boston", standfirst: "", facts: [], url: URL });
  assert.ok(t.linkedin.includes("Pipeline workshop in Boston"));
  assert.ok(t.x.includes("Pipeline workshop in Boston"));
  assert.ok(withinLimit("x", t.x, URL));
});

test("drafts never contain a quote or a first-person statement the author did not write", () => {
  const t = draftShareTexts({ ...SRC, standfirst: "", facts: [] });
  assert.ok(!/["“”]/.test(t.linkedin + t.x + t.bluesky));
});

test("hashtags: the type's own first, then tags, at most three, no duplicates", () => {
  assert.deepEqual(hashtagsFor("paper", []), ["#NewPaper"]);
  assert.deepEqual(hashtagsFor("tool", ["CRISPR screening", "crispr", "genomics", "extra"]), ["#OpenScience", "#CRISPRscreening", "#crispr"]);
  assert.equal(hashtagsFor("nonsense", ["a b"]).length, 2);
});

test("stored share text is read back safely", () => {
  assert.deepEqual(normalizeShareTexts({ linkedin: "a", x: "b", bluesky: "c" }), { linkedin: "a", x: "b", bluesky: "c" });
  assert.deepEqual(normalizeShareTexts(null), { linkedin: "", x: "", bluesky: "" });
  assert.deepEqual(normalizeShareTexts([1]), { linkedin: "", x: "", bluesky: "" });
});

// ── follow the topic ─────────────────────────────────────────────────────────

import { bestCommunity, bestTopicPage, topicWords } from "./topicMatch.ts";
import { SUGGEST_SYSTEM, buildSuggestMessage, fitFact, parseSuggestedFacts, unsupported } from "./keyFactsSuggest.ts";
import { authorsLine, cardLayout, factSize, headlineSize } from "./cardLayout.ts";

test("topicWords drops short and generic words", () => {
  assert.deepEqual(topicWords("The new study of CRISPR screening in organoids"), ["crispr", "screening", "organoids"]);
});

test("bestTopicPage picks the page sharing the most distinctive words, or none", () => {
  const pages = [
    { slug: "kras", title: "KRAS in pancreatic cancer" },
    { slug: "crispr", title: "CRISPR screening methods", seed: "pooled screens in organoids" },
    { slug: "other", title: "Cardiac imaging" },
  ];
  assert.equal(bestTopicPage("A pooled CRISPR screening method for organoids", pages)?.slug, "crispr");
  assert.equal(bestTopicPage("Pancreatic cancer drivers", pages)?.slug, "kras");
  assert.equal(bestTopicPage("Lunar geology of basalt", pages), null);
  assert.equal(bestTopicPage("", pages), null);
});

// The reported case: a long headline whose distinctive word (PHGDH) is short.
const PHGDH_HEADLINE = "Open IP gating pilot validates PHGDH as first open Alzheimer's drug candidate";
const PAGES = [
  { slug: "phgdh-alzheimers", title: "PHGDH in Alzheimer's disease" },
  { slug: "phgdh-structure", title: "PHGDH allosteric binders", seed: "structure of PHGDH" },
  { slug: "open-science", title: "Open science practices" },
  { slug: "open-data", title: "Open data standards" },
  { slug: "drug-pricing", title: "Drug pricing policy" },
  { slug: "kras", title: "KRAS in pancreatic cancer" },
];

test("the PHGDH headline finds a PHGDH page, not the generic 'open' ones", () => {
  const best = bestTopicPage(`${PHGDH_HEADLINE} ip-gating alzheimer`, PAGES);
  assert.ok(best && best.slug.startsWith("phgdh"), String(best?.slug));
});

test("a page that only shares generic words is not offered", () => {
  assert.equal(bestTopicPage("Open pilot validates first candidate", PAGES), null);
});

const COMMUNITIES = [
  { name: "ColaboFest 2026", description: "Collaboration sprint on open drug candidates.", explore_topics: ["PHGDH", "Alzheimer's disease", "open drug discovery"] },
  { name: "Cardiac Imaging Group", description: "MRI methods.", explore_topics: ["cardiac MRI"] },
];

test("a long headline still finds the community whose topics name PHGDH", () => {
  const c = bestCommunity(`${PHGDH_HEADLINE} alzheimer ip-gating`, COMMUNITIES);
  assert.equal(c?.community.name, "ColaboFest 2026");
});

test("no community is offered when nothing in its name or topics matches", () => {
  assert.equal(bestCommunity("Lunar geology of basalt", COMMUNITIES), null);
  assert.equal(bestCommunity("", COMMUNITIES), null);
});

// ── "Suggest key facts" checks ───────────────────────────────────────────────

const SOURCE = "PHGDH was tested in a pilot. The open pilot gated access to IP and validated the PHGDH binders for Alzheimer's disease. Twelve binders were tested in 3 assays.";

test("fitFact keeps a value of 90 characters or fewer, as is", () => {
  assert.equal(fitFact("  PHGDH binders for Alzheimer's disease  "), "PHGDH binders for Alzheimer's disease");
  assert.equal(fitFact("A value that ends in dots..."), "A value that ends in dots");
});

test("fitFact cuts a long value back to a whole clause, never with an ellipsis, or drops it", () => {
  const long = "The pilot gated access to the intellectual property, and then validated the binders across every assay we ran";
  const out = fitFact(long);
  assert.ok(out.length <= MAX_FACT_CHARS && out.length > 0);
  assert.ok(!out.includes("…") && !out.endsWith("..."));
  assert.equal(fitFact("x".repeat(200)), "");
});

test("unsupported: a number or name that is not in the item's own text is caught", () => {
  assert.equal(unsupported("Tested in 3 assays", SOURCE), false);
  assert.equal(unsupported("Tested in 40 assays", SOURCE), true);
  assert.equal(unsupported("Validated by Dr Okafor", SOURCE), true);
  assert.equal(unsupported("Validated PHGDH binders", SOURCE), false);
  assert.equal(unsupported("Pilot results", SOURCE), false);
});

test("parseSuggestedFacts blanks unsupported or over-long facts and keeps the rest", () => {
  const reply = JSON.stringify({
    facts: ["Whether PHGDH binders can be shared openly", "Twelve binders were tested in 40 assays", "Binders for Alzheimer's disease"],
  });
  const f = parseSuggestedFacts("paper", reply, SOURCE);
  assert.equal(f.length, 3);
  assert.deepEqual(f.map((x) => x.label), ["The question", "What we did", "What we found"]);
  assert.equal(f[0].value, "Whether PHGDH binders can be shared openly");
  assert.equal(f[1].value, ""); // "40" is not in the text
  assert.equal(f[2].value, "Binders for Alzheimer's disease");
});

test("an unreadable or empty reply gives three blank facts", () => {
  for (const bad of ["not json", "", "{}", '{"facts": "x"}']) {
    assert.deepEqual(parseSuggestedFacts("tool", bad, SOURCE).map((f) => f.value), ["", "", ""]);
  }
  assert.equal(parseSuggestedFacts("tool", "```json\n{\"facts\": [\"A\", \"\", \"\"]}\n```", SOURCE)[0].value, "A");
});

test("the prompt carries only the item's own text and the type's labels", () => {
  const m = buildSuggestMessage("funding", "Headline H", "Standfirst S", "Body B");
  assert.ok(m.includes("1. Funder") && m.includes("2. Amount & length") && m.includes("3. What it funds"));
  assert.ok(m.includes("HEADLINE: Headline H") && m.includes("STANDFIRST: Standfirst S") && m.includes("Body B"));
  assert.ok(SUGGEST_SYSTEM.includes("90 characters") && SUGGEST_SYSTEM.includes("Never add a number"));
});

// ── visual card layout ───────────────────────────────────────────────────────

test("card fonts shrink as text gets longer, so facts are never cut", () => {
  assert.ok(factSize(["Short"]) > factSize(["x".repeat(90)]));
  assert.equal(factSize(["y".repeat(90)]), 21);
  assert.ok(headlineSize("Short headline") > headlineSize("w ".repeat(70)));
});

test("card layout: authors on one line, standfirst as one sentence", () => {
  const l = cardLayout({
    headline: "A headline",
    standfirst: "First sentence here. And a second one that is dropped.",
    authors: "Ada Lovelace, Grace Hopper, Katherine Johnson, Margaret Hamilton, Mary Jackson, Dorothy Vaughan",
    facts: [],
  });
  assert.equal(l.standfirst, "First sentence here.");
  assert.ok(l.authors.length <= 100 && l.authors.endsWith("et al."));
  assert.equal(authorsLine("Ada Lovelace"), "Ada Lovelace");
});

// ── the card never needs the network ─────────────────────────────────────────

import { cardText } from "./cardLayout.ts";

test("cardText reduces text to characters the bundled font has, so nothing is downloaded", () => {
  // curly quotes, dashes, arrows, Greek, accents, emoji, zero-width characters
  const input = "Alzheimer’s — PHGDH → café α-synuclein 😀 µg x​y “quoted”…";
  const out = cardText(input);
  assert.equal(out, "Alzheimer's - PHGDH -> cafe alpha-synuclein ug xy \"quoted\"...");
  // every remaining character is Basic Latin
  assert.ok(/^[\x20-\x7E]*$/.test(out));
});

test("cardText keeps plain text unchanged and handles empty input", () => {
  assert.equal(cardText("Open IP gating pilot validates PHGDH"), "Open IP gating pilot validates PHGDH");
  assert.equal(cardText(""), "");
  assert.equal(cardText("😀😀"), "");
});

test("the card layout cleans every string it returns", () => {
  const l = cardLayout({
    headline: "Alzheimer’s → PHGDH",
    standfirst: "A “pilot” worked.",
    authors: "José Øberg",
    facts: [{ label: "What’s in it", value: "12 ≥ binders" }],
  });
  for (const t of [l.headline, l.standfirst, l.authors, l.facts[0].label, l.facts[0].value]) {
    assert.ok(/^[\x20-\x7E\xA1-\xFF]*$/.test(t), t);
  }
  assert.equal(l.facts[0].value, "12 >= binders");
});
