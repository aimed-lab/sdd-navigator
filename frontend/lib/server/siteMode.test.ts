import test from "node:test";
import assert from "node:assert/strict";
import {
  TEAMS_BRAND,
  TEAMS_MODE_BLOCKED,
  accountLinks,
  footerLinks,
  isTeamsMode,
  navPillars,
  siteTitle,
  teamsModeRedirects,
} from "../siteMode.ts";

test("only NEXT_PUBLIC_SITE_MODE=teams turns teams mode on", () => {
  assert.equal(isTeamsMode("teams"), true);
  for (const v of [undefined, "", "Teams", "team", "normal", "true"]) assert.equal(isTeamsMode(v), false);
});

test("normal mode: no redirects, original nav, footer and title", () => {
  assert.deepEqual(teamsModeRedirects(false), []);
  assert.deepEqual(navPillars(false).map((l) => l.href), ["/explore", "/collaborate", "/promote"]);
  assert.deepEqual(accountLinks(false).map((l) => l.href), ["/projects", "/pages", "/saved"]);
  assert.deepEqual(footerLinks(false).map((l) => l.label), ["About", "Explore", "Collaborate", "Promote", "Contact"]);
  assert.equal(siteTitle("Your teams", false), "Your teams · SmartDrugDiscovery");
});

test("teams mode nav is Teams and My pages only", () => {
  assert.deepEqual(navPillars(true), [
    { label: "Teams", href: "/" },
    { label: "My pages", href: "/pages" },
  ]);
  const all = [...navPillars(true), ...accountLinks(true), ...footerLinks(true)].map((l) => l.href);
  for (const h of all) assert.ok(!TEAMS_MODE_BLOCKED.some((b) => h === b || h.startsWith(b + "/")), h);
});

test("teams mode redirects every drug-discovery route and its sub-paths to /", () => {
  const r = teamsModeRedirects(true);
  for (const p of ["/explore", "/collaborate", "/promote", "/communities", "/phgdh"]) {
    assert.ok(r.some((x) => x.source === p && x.destination === "/"), p);
    assert.ok(r.some((x) => x.source === `${p}/:path*` && x.destination === "/"), p);
  }
  assert.ok(r.every((x) => x.permanent === false));
});

test("teams mode keeps teams, pages, login, auth, api, settings", () => {
  const sources = teamsModeRedirects(true).map((x) => x.source);
  for (const keep of ["/teams", "/pages", "/login", "/auth", "/api", "/settings"]) {
    assert.ok(!sources.some((s) => s === keep || s.startsWith(keep + "/")), keep);
  }
});

test("teams mode title uses the Teams brand", () => {
  assert.equal(siteTitle("Your teams", true), `Your teams · ${TEAMS_BRAND}`);
});
