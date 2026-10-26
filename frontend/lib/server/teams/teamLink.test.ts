import test from "node:test";
import assert from "node:assert/strict";
import { parseTeamLink } from "./teamLink.ts";

const HERE = "https://project.smartdrugdiscovery.org";

test("a team link on this site, or on either SmartDrugDiscovery host, gives a relative path", () => {
  for (const raw of [
    "https://project.smartdrugdiscovery.org/teams/alpha-lab",
    "https://connect.smartdrugdiscovery.org/teams/alpha-lab",
    "https://project.smartdrugdiscovery.org/teams/alpha-lab?join=1",
    "https://connect.smartdrugdiscovery.org/teams/alpha-lab/#x",
    "  https://project.smartdrugdiscovery.org/teams/alpha-lab  ",
    "/teams/alpha-lab",
  ]) {
    assert.deepEqual(parseTeamLink(raw, HERE), { ok: true, slug: "alpha-lab", path: "/teams/alpha-lab" }, raw);
  }
});

test("the same origin is accepted, even a dev or preview host", () => {
  assert.deepEqual(parseTeamLink("http://localhost:3000/teams/abc-123", "http://localhost:3000"), {
    ok: true,
    slug: "abc-123",
    path: "/teams/abc-123",
  });
  assert.equal(parseTeamLink("https://sdd-project.vercel.app/teams/x1", "https://sdd-project.vercel.app").ok, true);
});

test("other hosts, look-alikes, other paths and other schemes are refused", () => {
  for (const raw of [
    "https://evil.example/teams/alpha",
    "https://project.smartdrugdiscovery.org.evil.example/teams/alpha",
    "https://evilproject.smartdrugdiscovery.org/teams/alpha",
    "https://user:pw@project.smartdrugdiscovery.org/teams/alpha",
    "https://project.smartdrugdiscovery.org:8443/teams/alpha",
    "http://connect.smartdrugdiscovery.org/teams/alpha",
    "//evil.example/teams/alpha",
    "https://project.smartdrugdiscovery.org/teams",
    "https://project.smartdrugdiscovery.org/teams/new",
    "https://project.smartdrugdiscovery.org/teams/alpha/settings",
    "https://project.smartdrugdiscovery.org/communities/alpha",
    "https://project.smartdrugdiscovery.org/pages/alpha",
    "https://project.smartdrugdiscovery.org/teams/Alpha",
    "https://project.smartdrugdiscovery.org/teams/../explore",
    "javascript:alert(1)",
    "data:text/plain,hello",
    "WIFI:T:WPA;S:net;P:pw;;",
    "hello world",
    "",
    "   ",
  ]) {
    assert.equal(parseTeamLink(raw, HERE).ok, false, raw);
  }
});

test("non-strings and huge input are refused", () => {
  assert.equal(parseTeamLink(null, HERE).ok, false);
  assert.equal(parseTeamLink(42, HERE).ok, false);
  assert.equal(parseTeamLink("https://project.smartdrugdiscovery.org/teams/" + "a".repeat(5000), HERE).ok, false);
});

test("the result never carries the other host: the visitor stays on this site", () => {
  const r = parseTeamLink("https://connect.smartdrugdiscovery.org/teams/alpha", HERE);
  assert.ok(r.ok && r.path.startsWith("/") && !r.path.includes("connect"));
});
