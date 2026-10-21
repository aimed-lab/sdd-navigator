// Run with `npm test`. The pure helpers behind the assistant panel's answers.

import test from "node:test";
import assert from "node:assert/strict";
import {
  clampPanelWidth,
  countChips,
  countResults,
  isPagePick,
  mentionsTopic,
  quickFacts,
  resolveTopic,
  shouldShowPicker,
  sourcesToCards,
  topicTerms,
  followUpsFor,
  parseMarkdown,
  pickResultCards,
  stripChoiceText,
  topicFromMessage,
  wantsPickerNow,
} from "./assistantAnswer.ts";

const item = (kind: string, n: number, extra: Record<string, unknown> = {}) => ({
  id: `${kind}-${n}`,
  kind,
  title: `${kind} title ${n}`,
  summary: null,
  url: `https://example.org/${kind}/${n}`,
  source: "Src",
  date_iso: "2025-03-01",
  signal: null,
  ...extra,
});
const section = (kind: string, count: number, extra: Record<string, unknown> = {}) => ({
  tool: `search_${kind}`,
  kind,
  items: Array.from({ length: count }, (_, i) => item(kind, i, extra)),
});

// ── topic and picker ─────────────────────────────────────────────────────────

test("topicFromMessage: the subject of a search request, lead-ins removed", () => {
  assert.equal(topicFromMessage("Find resources on KRAS inhibitors"), "KRAS inhibitors");
  assert.equal(topicFromMessage("What are the side effects of aspirin?"), "side effects of aspirin");
  assert.equal(topicFromMessage("I work on EGFR resistance in lung cancer"), "EGFR resistance in lung cancer");
  assert.equal(topicFromMessage("PHGDH in Alzheimer's"), "PHGDH in Alzheimer's");
  assert.equal(topicFromMessage("Show clinical trials on EGFR"), "EGFR");
});

test("topicFromMessage: picks, small talk and a topic-less page request are not searches", () => {
  for (const t of ["Private", "Team", "public.", "thanks!", "ok", "hi", "I'd like to create a living page for my research.", "create a page", ""]) {
    assert.equal(topicFromMessage(t), null, t);
  }
});

test("wantsPickerNow: only when they say what they work on or ask for a page, with a topic", () => {
  assert.equal(wantsPickerNow("I work on EGFR resistance"), true);
  assert.equal(wantsPickerNow("My research is on pancreatic cancer"), true);
  assert.equal(wantsPickerNow("Create a living page on KRAS"), true);
  // ordinary questions never get the picker
  assert.equal(wantsPickerNow("What are the side effects of aspirin?"), false);
  assert.equal(wantsPickerNow("Find resources on KRAS"), false);
  assert.equal(wantsPickerNow("Show clinical trials on EGFR"), false);
  // a page request with no topic is not enough
  assert.equal(wantsPickerNow("I'd like to create a living page for my research."), false);
  assert.equal(wantsPickerNow("Private"), false);
});

// ── the reply is always cleaned ──────────────────────────────────────────────

test("stripChoiceText removes the question and the three option lines", () => {
  const reply = [
    "Found 5 papers and 1 trial.",
    "",
    "Which kind of page do you want?",
    "- Private: only you; your own self-updating notebook.",
    "- Team: you and people you invite.",
    "- **Public** - anyone can find and follow it.",
  ].join("\n");
  assert.equal(stripChoiceText(reply), "Found 5 papers and 1 trial.");
});

test("stripChoiceText trims a trailing question but keeps the rest of the line, and ordinary words", () => {
  assert.equal(
    stripChoiceText("Found 5 papers. Private, Team or Public? Tell me."),
    "Found 5 papers. Tell me."
  );
  assert.equal(stripChoiceText("A team of 3 wrote this public dataset."), "A team of 3 wrote this public dataset.");
  assert.equal(stripChoiceText("1) Private: x\n2) Team: y\n3) Public: z"), "");
});

// ── markdown ─────────────────────────────────────────────────────────────────

test("parseMarkdown: bold, lists, links and paragraphs", () => {
  const blocks = parseMarkdown(
    "Two **approved** drugs:\n- Gefitinib ([label](https://x.org/a))\n- Osimertinib\n\nSee https://x.org/b."
  );
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0], {
    t: "p",
    inlines: [
      { t: "text", v: "Two " },
      { t: "bold", v: "approved" },
      { t: "text", v: " drugs:" },
    ],
  });
  const ul = blocks[1] as { t: "ul"; items: unknown[][] };
  assert.equal(ul.t, "ul");
  assert.equal(ul.items.length, 2);
  assert.deepEqual(ul.items[0][1], { t: "link", v: "label", href: "https://x.org/a" });
  assert.deepEqual((blocks[2] as { inlines: unknown[] }).inlines[1], { t: "link", v: "https://x.org/b", href: "https://x.org/b" });
});

test("parseMarkdown: a javascript: link is never a link, and nothing becomes HTML", () => {
  const [p] = parseMarkdown("[click](javascript:alert(1)) <b>x</b>") as { inlines: { t: string }[] }[];
  assert.ok(p.inlines.every((i) => i.t !== "link"));
  assert.deepEqual(parseMarkdown("1. one\n2. two")[0], {
    t: "ol",
    items: [[{ t: "text", v: "one" }], [{ t: "text", v: "two" }]],
  });
  assert.deepEqual(parseMarkdown(""), []);
});

// ── cards and follow-ups ─────────────────────────────────────────────────────

test("pickResultCards: a mix of kinds, 3 to 5 cards, with tag, title, detail and link", () => {
  const sections = [
    section("paper", 6),
    section("trial", 3, { raw: { overall_status: "RECRUITING", phase: "PHASE2" } }),
    section("approval", 2, { raw: { sponsor: "Acme", approval_date: "20190412" } }),
    section("news", 4),
    section("dataset", 1),
  ];
  const cards = pickResultCards(sections as never);
  assert.equal(cards.length, 5);
  // FDA approved first, then papers, then trials, then the rest
  assert.deepEqual(cards.map((c) => c.kind), ["approval", "approval", "paper", "trial", "dataset"]);
  assert.deepEqual(cards.slice(0, 4).map((c) => c.tag), ["FDA approved", "FDA approved", "Paper", "Trial"]);
  assert.equal(cards[0].detail, "Acme · approved 2019");
  assert.equal(cards[2].detail, "Src · 2025");
  assert.equal(cards[2].url, "https://example.org/paper/0");
  assert.equal(cards[3].detail, "recruiting · PHASE2");
  assert.ok(cards.every((c) => c.kind !== "news"), "news is not a card kind");
});

test("pickResultCards: few results give few cards; unsafe or missing urls give no link", () => {
  const cards = pickResultCards([section("paper", 2, { url: "javascript:alert(1)" })] as never);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].url, null);
  assert.deepEqual(pickResultCards(null), []);
  assert.deepEqual(pickResultCards([section("paper", 0)] as never), []);
});

test("countResults adds every section", () => {
  assert.equal(countResults([section("paper", 3), section("trial", 2)] as never), 5);
  assert.equal(countResults(undefined), 0);
});

test("followUpsFor: two or three chips, only for kinds that were found, each sending a full request", () => {
  const f = followUpsFor([section("trial", 1), section("approval", 1), section("paper", 1), section("grant", 1)] as never, "EGFR");
  assert.deepEqual(f.map((x) => x.label), ["Open trials", "Approved drugs", "Recent papers"]);
  assert.equal(f[0].text, "Show clinical trials on EGFR");
  const few = followUpsFor([section("paper", 1)] as never, "EGFR");
  assert.equal(few.length, 2);
  assert.deepEqual(few.map((x) => x.label), ["Recent papers", "Key findings"]);
});

// ── topic stripping (item 15) ────────────────────────────────────────────────

test("topicFromMessage: 'what is known about', 'tell me about', 'what do we know about', 'can you explain'", () => {
  assert.equal(topicFromMessage("What is known about PHGDH in Alzheimer's disease?"), "PHGDH in Alzheimer's disease");
  assert.equal(topicFromMessage("Tell me about KRAS G12C inhibitors"), "KRAS G12C inhibitors");
  assert.equal(topicFromMessage("What do we know about CRISPR screening?"), "CRISPR screening");
  assert.equal(topicFromMessage("Can you explain EGFR T790M resistance?"), "EGFR T790M resistance");
});

// ── on-topic only (item 16) ──────────────────────────────────────────────────

test("topicTerms keeps the gene or disease word, not generic research words", () => {
  assert.deepEqual(topicTerms("what is known about EGFR inhibitor resistance"), ["egfr"]);
  assert.deepEqual(topicTerms("pancreatic cancer"), ["pancreatic", "cancer"]);
  assert.deepEqual(topicTerms("the role of"), ["the", "role"]);
});

test("mentionsTopic: title or description must mention a main term", () => {
  const terms = topicTerms("EGFR lung cancer");
  assert.equal(mentionsTopic({ title: "EGFR mutations", summary: null }, terms), true);
  assert.equal(mentionsTopic({ title: "A trial", summary: "in lung tissue with EGFR" }, terms), true);
  assert.equal(mentionsTopic({ title: "Weather and mood", summary: "unrelated" }, terms), false);
});

test("pickResultCards skips off-topic results and takes the next", () => {
  const sections = [
    {
      tool: "t",
      kind: "paper",
      items: [
        { ...item("paper", 0), title: "Weather and mood", summary: "unrelated" },
        { ...item("paper", 1), title: "EGFR resistance in lung cancer", summary: null },
      ],
    },
  ];
  const cards = pickResultCards(sections as never, 3, "EGFR lung cancer");
  assert.deepEqual(cards.map((c) => c.title), ["EGFR resistance in lung cancer"]);
  assert.equal(pickResultCards(sections as never, 3).length, 2, "without a topic nothing is filtered");
});

// ── counts, facts, source cards ──────────────────────────────────────────────

test("countChips: real counts per kind, only kinds with results, singular and plural", () => {
  const chips = countChips([section("paper", 10), section("approval", 9), section("trial", 1), section("grant", 0), section("news", 4)] as never);
  assert.deepEqual(chips.map((c) => c.text), ["10 papers", "1 trial", "9 FDA approvals"]);
});

test("quickFacts: Approved, Open trials (recruiting first, 'and N more'), Compounds; only kinds with results", () => {
  const sections = [
    section("approval", 2, { raw: { brand: "Tagrisso", generic: "osimertinib" } }),
    {
      tool: "t",
      kind: "trial",
      items: [
        { ...item("trial", 0, { raw: { overall_status: "COMPLETED" } }), title: "EGFR done trial" },
        { ...item("trial", 1, { raw: { overall_status: "RECRUITING" } }), title: "EGFR recruiting trial" },
        { ...item("trial", 2, { raw: { overall_status: "RECRUITING" } }), title: "EGFR another recruiting" },
        { ...item("trial", 3, { raw: { overall_status: "COMPLETED" } }), title: "EGFR fourth" },
      ],
    },
    section("paper", 3),
  ].map((sec) => ({
    ...sec,
    items: sec.items.map((i) => ({ ...i, title: i.title.includes("EGFR") ? i.title : `EGFR ${i.title}` })),
  }));
  const rows = quickFacts(sections as never, "EGFR");
  assert.deepEqual(rows.map((r) => r.label), ["Approved", "Open trials"]);
  assert.equal(rows[0].text, "Tagrisso");
  assert.equal(rows[0].count, 2);
  assert.equal(rows[1].count, 4);
  assert.equal(rows[1].text, "EGFR recruiting trial, EGFR another recruiting and 2 more");
  assert.deepEqual(quickFacts([section("paper", 2)] as never, "EGFR"), []);
});

test("quickFacts leaves out off-topic names", () => {
  const sections = [{ tool: "t", kind: "trial", items: [{ ...item("trial", 0), title: "Water" }] }];
  assert.deepEqual(quickFacts(sections as never, "EGFR"), []);
});

test("sourcesToCards: the backend's numbered sources become cards in order", () => {
  const cards = sourcesToCards([
    { n: 1, kind: "paper", title: "P", url: "https://x.org/p", detail: "Src · 2025" },
    { n: 2, kind: "approval", title: "A", url: null, detail: "" },
  ]);
  assert.deepEqual(cards.map((c) => [c.tag, c.title, c.url]), [["Paper", "P", "https://x.org/p"], ["FDA approved", "A", null]]);
});

// ── citations, width, picks ──────────────────────────────────────────────────

test("parseMarkdown: [n] becomes a citation, a markdown link does not", () => {
  const [p] = parseMarkdown("Resistance arises via C797S [1][2]. See [docs](https://x.org).") as { inlines: unknown[] }[];
  assert.deepEqual(p.inlines.filter((i) => (i as { t: string }).t === "cite"), [{ t: "cite", n: 1 }, { t: "cite", n: 2 }]);
  assert.ok(p.inlines.some((i) => (i as { t: string }).t === "link"));
});

test("clampPanelWidth: 380 to 720, and room is left for the page", () => {
  assert.equal(clampPanelWidth(100), 380);
  assert.equal(clampPanelWidth(900), 720);
  assert.equal(clampPanelWidth(555), 555);
  assert.equal(clampPanelWidth(700, 800), 520, "a narrow window caps the panel");
  assert.equal(clampPanelWidth(NaN), 500);
});

test("isPagePick: only a bare Private / Team / Public", () => {
  assert.equal(isPagePick("Private"), true);
  assert.equal(isPagePick(" team. "), true);
  assert.equal(isPagePick("Is the team public?"), false);
});

// ── approvals and compounds are not topic-filtered ───────────────────────────

test("pickResultCards: FDA approvals and compounds stay even when their names miss the topic", () => {
  const sections = [
    {
      tool: "t",
      kind: "approval",
      items: [{ ...item("approval", 0), title: "RASONQUE (daraxonrasib)", summary: null }],
    },
    { tool: "t", kind: "compound", items: [{ ...item("compound", 0), title: "Sotorasib", summary: null }] },
    { tool: "t", kind: "paper", items: [{ ...item("paper", 0), title: "Unrelated weather paper", summary: null }] },
    { tool: "t", kind: "trial", items: [{ ...item("trial", 0), title: "Unrelated trial", summary: null }] },
  ];
  const cards = pickResultCards(sections as never, 5, "KRAS pancreatic cancer");
  assert.deepEqual(cards.map((c) => c.kind), ["approval", "compound"], "papers and trials are still filtered");
});

test("quickFacts: approved drugs and compounds are listed without a topic match; trials are not", () => {
  const sections = [
    { tool: "t", kind: "approval", items: [{ ...item("approval", 0, { raw: { brand: "RASONQUE" } }), title: "RASONQUE (daraxonrasib)" }] },
    { tool: "t", kind: "compound", items: [{ ...item("compound", 0), title: "Sotorasib" }] },
    { tool: "t", kind: "trial", items: [{ ...item("trial", 0), title: "Unrelated trial" }] },
  ];
  const rows = quickFacts(sections as never, "KRAS pancreatic cancer");
  assert.deepEqual(rows.map((r) => [r.label, r.text]), [["Approved", "RASONQUE"], ["Compounds", "Sotorasib"]]);
});

test("pickResultCards: all ten approvals for EGFR lung cancer survive the filter", () => {
  const approvals = Array.from({ length: 10 }, (_, i) => ({ ...item("approval", i), title: `Drug${i} (generic${i})`, summary: null }));
  const cards = pickResultCards([{ tool: "t", kind: "approval", items: approvals }] as never, 3, "EGFR lung cancer");
  assert.equal(cards.length, 3);
  assert.equal(countResults([{ tool: "t", kind: "approval", items: approvals }] as never), 10);
});

// ── a failed or slow search never changes what the panel decides ─────────────

test("resolveTopic: the backend's query wins; null, missing or blank falls back to the message's topic", () => {
  const content = "Find resources on KRAS pancreatic cancer";
  assert.equal(resolveTopic({ content, backendQuery: "KRAS inhibitors" }), "KRAS inhibitors");
  assert.equal(resolveTopic({ content, backendQuery: null }), "KRAS pancreatic cancer");
  assert.equal(resolveTopic({ content, backendQuery: undefined }), "KRAS pancreatic cancer");
  assert.equal(resolveTopic({ content, backendQuery: "  " }), "KRAS pancreatic cancer");
  assert.equal(resolveTopic({ content: "Private", backendQuery: "KRAS" }), null, "a pick is never a search");
  assert.equal(resolveTopic({ content: "thanks!", backendQuery: null }), null);
});

test("shouldShowPicker: never after an ordinary question, whatever the backend sent or the search did", () => {
  for (const q of ["KRAS pancreatic cancer", "Find resources on KRAS", "What is known about EGFR?", "Show clinical trials on EGFR"]) {
    assert.equal(shouldShowPicker(q, false), false, q);
  }
  assert.equal(shouldShowPicker("I work on KRAS in pancreatic cancer", false), true);
  assert.equal(shouldShowPicker("Create a living page on KRAS", false), true);
  assert.equal(shouldShowPicker("I work on KRAS in pancreatic cancer", true), false, "not while a page is being proposed");
});
