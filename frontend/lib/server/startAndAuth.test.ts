import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { postLoginPath, safeCallback } from "../safeRedirect.ts";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("postLoginPath: no callback or just / goes to the home page", () => {
  for (const raw of [undefined, null, "", "/", 5]) assert.equal(postLoginPath(raw), "/");
});

test("postLoginPath: a real callback is kept exactly", () => {
  for (const raw of ["/teams/new?name=Lung%20Lab", "/teams/lung-ab12?join=signin", "/explore/EGFR", "/pages"]) {
    assert.equal(postLoginPath(raw), raw);
  }
});

test("postLoginPath: an unsafe callback counts as none", () => {
  for (const raw of ["https://evil.example", "//evil.example", String.raw`/\evil`, "javascript:alert(1)"]) {
    assert.equal(postLoginPath(raw), "/");
  }
  assert.equal(safeCallback("/explore/x"), "/explore/x"); // unchanged helper
});

test("the login page and the SSO callback both use postLoginPath", () => {
  assert.match(read("app/login/page.tsx"), /postLoginPath\(searchParams\.get\("callbackUrl"\)\)/);
  assert.match(read("app/auth/callback/route.ts"), /postLoginPath\(url\.searchParams\.get\("next"\)\)/);
});

test("/start redirects to /collaborate and its old pieces are gone", () => {
  assert.match(read("app/start/page.tsx"), /redirect\("\/collaborate"\)/);
  assert.ok(!existsSync(new URL("../../components/start/StartAssistantTile.tsx", import.meta.url)));
  assert.ok(!existsSync(new URL("../startRules.ts", import.meta.url)));
});

test("account menu: My teams first, no Getting started, desktop and mobile", () => {
  const nav = read("components/Nav.tsx");
  assert.ok(!nav.includes('href="/start"') && !nav.includes("Getting started"));
  assert.equal(nav.split("My teams").length - 1, 2);
  // The other account links (projects, pages, saved) come from accountLinks() in lib/siteMode.ts.
  assert.ok(nav.indexOf('href="/teams"') < nav.indexOf("ACCOUNT.map"));
  assert.ok(nav.lastIndexOf('href="/teams"') < nav.lastIndexOf("ACCOUNT.map"));
  assert.ok(!nav.includes("Your teams"));
});

test("Collaborate: three cards, communities only, old boxes gone", () => {
  const src = read("app/collaborate/page.tsx");
  for (const t of ['title="Your teams"', 'title="Communities"', 'title="Service providers"']) assert.ok(src.includes(t), t);
  assert.match(src, /listCommunities\(\)/);
  assert.ok(src.includes("md:grid-cols-3") && src.includes("grid-cols-1"));
  assert.ok(!src.includes("Find a service provider"));
});

// Every API route the assistant panel calls refuses with 401 before doing any work.
for (const [file, firstWork] of [
  ["app/api/assistant/route.ts", "limiter.limited"],
  ["app/api/pages/similar/route.ts", "getDb()"],
  ["app/api/pages/route.ts", "req.json()"],
] as const) {
  test(`${file}: 401 when signed out, before any backend call`, () => {
    const src = read(file);
    const gate = src.indexOf("getCurrentUser()");
    const status = src.indexOf("status: 401");
    assert.ok(gate > 0 && status > gate, "has a 401 gate");
    assert.ok(gate < src.indexOf(firstWork, gate + 1) || src.indexOf(firstWork) > gate, "gate comes first");
    assert.ok(status < src.indexOf(firstWork, status));
  });
}

test("the panel and the Explore answer card do not call the assistant when signed out", () => {
  assert.match(read("components/explore/AssistantChat.tsx"), /if \(!content \|\| typing \|\| !user\) return;/);
  assert.match(read("components/explore/AssistantChat.tsx"), /Sign in to use the assistant\. It can find research, make wiki pages and create teams for you\./);
  assert.match(read("components/explore/AnswerCard.tsx"), /if \(!user\) \{\s*setState\(\{ kind: "failed" \}\)/);
});
