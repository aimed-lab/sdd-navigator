import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { postLoginPath, safeCallback } from "../safeRedirect.ts";
import { firstName, welcomeLine, START_SIGN_IN } from "../startRules.ts";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("postLoginPath: no callback or just / goes to /start", () => {
  for (const raw of [undefined, null, "", "/", 5]) assert.equal(postLoginPath(raw), "/start");
});

test("postLoginPath: a real callback is kept exactly", () => {
  for (const raw of ["/teams/new?name=Lung%20Lab", "/teams/lung-ab12?join=signin", "/explore/EGFR", "/pages"]) {
    assert.equal(postLoginPath(raw), raw);
  }
});

test("postLoginPath: an unsafe callback counts as none", () => {
  for (const raw of ["https://evil.example", "//evil.example", String.raw`/\evil`, "javascript:alert(1)"]) {
    assert.equal(postLoginPath(raw), "/start");
  }
  assert.equal(safeCallback("/explore/x"), "/explore/x"); // unchanged helper
});

test("the login page and the SSO callback both use postLoginPath", () => {
  assert.match(read("app/login/page.tsx"), /postLoginPath\(searchParams\.get\("callbackUrl"\)\)/);
  assert.match(read("app/auth/callback/route.ts"), /postLoginPath\(url\.searchParams\.get\("next"\)\)/);
});

test("welcome line: first name, or just Welcome.", () => {
  assert.equal(welcomeLine(firstName("Ana Maria Lopez", "x@y.org")), "Welcome, Ana.");
  assert.equal(welcomeLine(firstName("", "x@y.org")), "Welcome.");
  assert.equal(welcomeLine(firstName(null)), "Welcome.");
  // the account's fallback name is the email prefix: not a name
  assert.equal(welcomeLine(firstName("karthik2311", "karthik2311@gmail.com")), "Welcome.");
  assert.equal(START_SIGN_IN, "/login?callbackUrl=/start");
});

test("/start: signed out redirects to sign-in; tiles are the four asked for", () => {
  const src = read("app/start/page.tsx");
  assert.match(src, /if \(!session\) redirect\(START_SIGN_IN\)/);
  for (const t of ["Create a team", "Your teams", "Explore research"]) assert.ok(src.includes(t), t);
  assert.ok(read("components/start/StartAssistantTile.tsx").includes("Ask the AI assistant"));
  assert.match(src, /href="\/teams\/new"/);
  assert.match(src, /href="\/explore"/);
  assert.match(src, /listMyTeamsNewest\(5\)/);
});

test("account menu: Getting started first, desktop and mobile", () => {
  const nav = read("components/Nav.tsx");
  assert.equal(nav.split('href="/start"').length - 1, 2);
  assert.ok(nav.indexOf('href="/start"') < nav.indexOf('href="/projects"'));
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
