import test from "node:test";
import assert from "node:assert/strict";
import { avatarOverflow, byLine, fileKind } from "./teamUi.ts";

test("fileKind: by the first file name, else by the link", () => {
  assert.equal(fileKind({ files: [{ filename: "Deck.PPTX" }], url: null }), "slides");
  assert.equal(fileKind({ files: [{ filename: "paper.pdf" }], url: null }), "pdf");
  assert.equal(fileKind({ files: [{ filename: "gel.JPG" }], url: null }), "image");
  assert.equal(fileKind({ files: [{ filename: "notes.docx" }], url: null }), "link");
  assert.equal(fileKind({ files: [], url: "https://example.org/a.pdf?x=1" }), "pdf");
  assert.equal(fileKind({ files: [], url: "https://example.org/talk" }), "link");
  assert.equal(fileKind({ files: [], url: null }), "link");
});

test("avatarOverflow: +N only past six", () => {
  assert.equal(avatarOverflow(3), "");
  assert.equal(avatarOverflow(6), "");
  assert.equal(avatarOverflow(9), "+3");
});

test("byLine: whatever part is known", () => {
  assert.equal(byLine("Ana", "Oct 3, 2026"), "by Ana · Oct 3, 2026");
  assert.equal(byLine(null, "Oct 3, 2026"), "Oct 3, 2026");
  assert.equal(byLine("Ana", ""), "by Ana");
});

import { COVER_STYLE, addedMessage, coverBadge, firstLine, formatBytes, isPhoto, nameHue, splitResources, swipeStep, wrapIndex } from "./teamUi.ts";

const R = (id: string, filename: string, created_at: string, url: string | null = null) => ({
  id,
  files: filename ? [{ filename }] : [],
  url,
  created_at,
});

test("photos never appear under documents; photos come newest first", () => {
  const items = [
    R("a", "deck.pptx", "2026-10-01"),
    R("b", "booth.jpg", "2026-10-02"),
    R("c", "paper.pdf", "2026-10-03"),
    R("d", "team.PNG", "2026-10-05"),
    R("e", "", "2026-10-04", "https://example.org/talk"),
    R("f", "", "2026-10-06", "https://example.org/pic.webp?x=1"),
  ];
  const { documents, photos } = splitResources(items);
  assert.deepEqual(documents.map((r) => r.id), ["a", "c", "e"]);
  assert.deepEqual(photos.map((r) => r.id), ["f", "d", "b"]);
  assert.equal(isPhoto(items[1]), true);
  assert.equal(isPhoto(items[0]), false);
  // every item lands in exactly one list
  assert.equal(documents.length + photos.length, items.length);
});

test("cover badges: SLIDES orange, PDF red, LINK blue", () => {
  assert.equal(COVER_STYLE.slides.badge, "SLIDES");
  assert.equal(COVER_STYLE.pdf.badge, "PDF");
  assert.equal(COVER_STYLE.link.badge, "LINK");
  assert.equal(coverBadge("link", true), "FILE");
  assert.equal(coverBadge("link", false), "LINK");
  assert.equal(coverBadge("slides", true), "SLIDES");
});

test("formatBytes", () => {
  assert.equal(formatBytes(0), "");
  assert.equal(formatBytes(undefined), "");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(310 * 1024), "310 KB");
  assert.equal(formatBytes(2.4 * 1024 * 1024), "2.4 MB");
  assert.equal(formatBytes(48 * 1024 * 1024), "48 MB");
});

test("toast text by kind", () => {
  assert.equal(addedMessage("slides"), "Slides added");
  assert.equal(addedMessage("pdf"), "PDF added");
  assert.equal(addedMessage("image"), "Photo added");
  assert.equal(addedMessage("link"), "Document added");
});

test("lightbox: wrap around and swipe direction", () => {
  assert.equal(wrapIndex(5, 5), 0);
  assert.equal(wrapIndex(-1, 5), 4);
  assert.equal(wrapIndex(2, 5), 2);
  assert.equal(wrapIndex(3, 0), 0);
  assert.equal(swipeStep(-80), 1);
  assert.equal(swipeStep(80), -1);
  assert.equal(swipeStep(20), 0);
  assert.equal(swipeStep(-49), 0);
});

test("team card helpers", () => {
  assert.equal(nameHue("Booth team"), nameHue("Booth team"));
  assert.ok(nameHue("x") >= 0 && nameHue("x") < 360);
  assert.equal(firstLine("\n\nHello world\nsecond"), "Hello world");
  assert.equal(firstLine(null), "");
  assert.equal(firstLine("a".repeat(100), 10), "aaaaaaaaa…");
});

import { TEAM_VIEWS, isStartHere, latestItems, learnLine, parseView, startHereFirst, tileCount, typeLine, viewHref } from "./teamUi.ts";

test("?view= is one of four sections, else the home", () => {
  assert.deepEqual([...TEAM_VIEWS], ["slides", "learn", "photos", "people"]);
  assert.equal(parseView("learn"), "learn");
  assert.equal(parseView(["photos", "x"]), "photos");
  for (const bad of ["", "Slides", "settings", "../x", undefined, null]) assert.equal(parseView(bad as string | undefined), null);
  assert.equal(viewHref("t-1", null), "/teams/t-1");
  assert.equal(viewHref("t-1", "people"), "/teams/t-1?view=people");
});

test("cover type line", () => {
  assert.equal(typeLine({ files: [{ filename: "a.pptx", sizeBytes: 42 * 1024 * 1024 }], url: null }), "PowerPoint · 42 MB");
  assert.equal(typeLine({ files: [{ filename: "a.pdf", sizeBytes: 120 * 1024 }], url: null }), "PDF · 120 KB");
  assert.equal(typeLine({ files: [], url: "https://x.org" }), "Link");
  assert.equal(typeLine({ files: [{ filename: "n.docx", sizeBytes: 0 }], url: null }), "File");
});

test("Start here comes first; Learn lines", () => {
  const pages = [{ title: "How an agent works" }, { title: "Start here: AI in Medicine" }, { title: "Five ways" }];
  assert.deepEqual(startHereFirst(pages).map((p) => p.title), ["Start here: AI in Medicine", "How an agent works", "Five ways"]);
  assert.equal(isStartHere("  start HERE"), true);
  assert.equal(isStartHere("Not start here"), false);
  assert.equal(learnLine(2, "Oct 26"), "2 new papers");
  assert.equal(learnLine(1, "Oct 26"), "1 new paper");
  assert.equal(learnLine(0, "Oct 26"), "Updated Oct 26");
  assert.equal(learnLine(0, ""), "");
});

test("latest in this team: three newest across documents, photos and pages", () => {
  const out = latestItems({
    resources: [
      { id: "a", title: "Deck", created_at: "2026-10-01", files: [{ filename: "d.pptx" }], url: null },
      { id: "b", title: "Booth", created_at: "2026-10-05", files: [{ filename: "b.jpg" }], url: null },
    ],
    pages: [
      { pageId: "p1", title: "Agents", createdAt: "2026-10-03" },
      { pageId: "p2", title: "Steering", createdAt: "2026-09-20" },
    ],
  });
  assert.deepEqual(out.map((i) => [i.kind, i.title]), [["photos", "Booth"], ["learn", "Agents"], ["slides", "Deck"]]);
});

test("tile counts", () => {
  assert.equal(tileCount("slides", 1), "1 file");
  assert.equal(tileCount("slides", 3), "3 files");
  assert.equal(tileCount("learn", 4), "4 pages");
  assert.equal(tileCount("photos", 0), "0");
  assert.equal(tileCount("people", 4), "4");
});
