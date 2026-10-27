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
