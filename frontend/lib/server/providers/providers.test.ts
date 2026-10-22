import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  CATEGORY_LABEL,
  cardFooterText,
  categoryCounts,
  categoryLabel,
  filterProviders,
  formatChicago,
  matchesQuery,
  referrerPath,
  similarProviders,
  summarizeActivity,
  trackedWebsiteUrl,
  visibleKeyFacts,
} from "./core.ts";
import { getAllProviders, getProviderBySlug, parseProvider, parseProviders, providerSlugs } from "./providers.ts";
import { LIMITS, TIMELINES, parseClaim, parseProviderRequest, parseQuote } from "./validate.ts";

const all = getAllProviders();

// ── loader and labels ────────────────────────────────────────────────────────

test("the loader returns the 22 companies with unique slugs", () => {
  assert.equal(all.length, 22);
  assert.equal(new Set(providerSlugs()).size, 22);
  const k = getProviderBySlug("kactus");
  assert.equal(k?.name, "KACTUS");
  assert.ok(Array.isArray(k?.services) && Array.isArray(k?.brochure_pages));
});

test("the loader rejects a missing slug or name and duplicate slugs", () => {
  assert.throws(() => parseProvider({ name: "No slug" }));
  assert.throws(() => parseProvider({ slug: "Bad Slug", name: "X" }));
  assert.throws(() => parseProviders([{ slug: "a", name: "A" }, { slug: "a", name: "B" }]));
  assert.throws(() => parseProviders({}));
  const p = parseProvider({ slug: "a", name: "A" });
  assert.deepEqual(p.services, []);
  assert.deepEqual(p.key_facts, []);
});

test("every cover and brochure page in the data exists on disk", () => {
  for (const p of all) {
    for (const f of [p.cover, ...p.brochure_pages]) {
      assert.ok(existsSync(path.join(process.cwd(), "public", f)), `${p.slug}: ${f}`);
    }
  }
});

test("categories are shown in plain words", () => {
  assert.equal(categoryLabel("CRO - Chemistry"), "Chemistry CRO");
  assert.equal(categoryLabel("AI/Software"), "AI & software");
  assert.equal(categoryLabel("Reagents/Consumables"), "Reagents & proteins");
  assert.equal(categoryLabel("CDMO/Manufacturing"), "Manufacturing");
  assert.equal(categoryLabel("CRO - Biology/Assays"), "Biology & structure");
  assert.equal(categoryLabel("Lab Instruments/Equipment"), "Instruments");
  assert.equal(categoryLabel("Other"), "Other");
  assert.equal(categoryLabel("Something new"), "Other");
  for (const p of all) assert.ok(p.category in CATEGORY_LABEL, p.category);
});

test("chips: only categories that have providers, with counts", () => {
  const chips = categoryCounts(all);
  assert.equal(chips.reduce((n, c) => n + c.count, 0), 22);
  assert.equal(chips.find((c) => c.label === "AI & software")?.count, 6);
  const some = categoryCounts([{ category: "AI/Software" }, { category: "AI/Software" }]);
  assert.deepEqual(some, [{ category: "AI/Software", label: "AI & software", count: 2 }]);
  assert.deepEqual(categoryCounts([]), []);
});

// ── search ───────────────────────────────────────────────────────────────────

test("search matches name, services and description; every word must match", () => {
  const p = { name: "Acme Bio", services: ["Peptide synthesis", "HPLC"], description: "Makes custom antibodies." };
  assert.ok(matchesQuery(p, ""));
  assert.ok(matchesQuery(p, "acme"));
  assert.ok(matchesQuery(p, "peptide"));
  assert.ok(matchesQuery(p, "ANTIBODIES custom"));
  assert.ok(matchesQuery(p, "hplc, synthesis"));
  assert.ok(!matchesQuery(p, "docking"));
  assert.ok(!matchesQuery(p, "peptide docking"));
});

test("filtering by search and category together", () => {
  assert.equal(filterProviders(all, "", null).length, 22);
  const chem = filterProviders(all, "", "CRO - Chemistry");
  assert.equal(chem.length, 5);
  assert.ok(chem.every((p) => p.category === "CRO - Chemistry"));
  assert.equal(filterProviders(all, "zzzzqqq", null).length, 0);
  const kactus = filterProviders(all, "kactus", null);
  assert.deepEqual(kactus.map((p) => p.slug), ["kactus"]);
  assert.equal(filterProviders(kactus, "kactus", "AI/Software").length, 0);
});

// ── key facts ────────────────────────────────────────────────────────────────

test("the key-facts strip is hidden when key_facts is empty", () => {
  const without = all.filter((p) => p.key_facts.length === 0);
  assert.ok(without.length > 0);
  for (const p of without) assert.deepEqual(visibleKeyFacts(p), []);
  const certara = getProviderBySlug("certara");
  assert.equal(visibleKeyFacts(certara!).length, 3);
  // half-filled facts are never shown
  assert.deepEqual(visibleKeyFacts({ key_facts: [{ value: "4x", label: "" }, { value: "", label: "Faster" }] }), []);
});

test("card footer: the location, else 'N services'", () => {
  assert.equal(cardFooterText({ location: "Waltham, United States", services: ["a"] }), "Waltham, United States");
  assert.equal(cardFooterText({ location: "", services: ["a", "b", "c"] }), "3 services");
  assert.equal(cardFooterText({ location: " ", services: ["a"] }), "1 service");
});

// ── similar providers ────────────────────────────────────────────────────────

test("similar providers: same category, not itself, at most 3", () => {
  const k = getProviderBySlug("kactus")!;
  const s = similarProviders(all, k, 3);
  assert.equal(s.length, 3);
  assert.ok(s.every((p) => p.category === k.category && p.slug !== k.slug));
  const only = getProviderBySlug("fovus");
  const lone = all.filter((p) => p.category === "Other");
  assert.equal(lone.length, 1);
  assert.deepEqual(similarProviders(all, lone[0]), []);
  assert.ok(only);
});

// ── tracked website link ─────────────────────────────────────────────────────

test("the website link only goes to the provider's own website, with utm added", () => {
  for (const p of all) {
    const url = trackedWebsiteUrl(p);
    assert.ok(url, p.slug);
    const u = new URL(url!);
    const own = new URL(p.website);
    assert.equal(u.host, own.host);
    assert.equal(u.pathname, own.pathname);
    assert.equal(u.searchParams.get("utm_source"), "smartdrugdiscovery");
    assert.equal(u.searchParams.get("utm_medium"), "directory");
  }
  assert.equal(
    trackedWebsiteUrl({ website: "https://kactusbio.com/" }),
    "https://kactusbio.com/?utm_source=smartdrugdiscovery&utm_medium=directory"
  );
});

test("existing query parameters on the website are kept", () => {
  const u = new URL(trackedWebsiteUrl({ website: "https://example.com/p?ref=x" })!);
  assert.equal(u.searchParams.get("ref"), "x");
  assert.equal(u.searchParams.get("utm_medium"), "directory");
});

test("no usable website, no redirect: empty, junk and non-http schemes give null", () => {
  for (const w of ["", "  ", "not a url", "javascript:alert(1)", "data:text/html,x", "ftp://example.com/", "//evil.com"]) {
    assert.equal(trackedWebsiteUrl({ website: w }), null, w);
  }
});

test("an unknown slug has no provider, so the page and the redirect answer 404", () => {
  assert.equal(getProviderBySlug("no-such-company"), null);
  assert.equal(getProviderBySlug(""), null);
  assert.equal(getProviderBySlug("../../etc/passwd"), null);
  assert.equal(getProviderBySlug("admin"), null);
});

test("referrer is stored as a path only", () => {
  assert.equal(referrerPath("https://example.com/collaborate/providers?q=secret#x"), "/collaborate/providers");
  assert.equal(referrerPath(""), "");
  assert.equal(referrerPath(null), "");
  assert.equal(referrerPath("garbage"), "");
  assert.ok(referrerPath("https://a.com/" + "x".repeat(500)).length <= 200);
});

// ── admin summary ────────────────────────────────────────────────────────────

test("activity summary counts views and clicks in the last 30 days, zeros included", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  const rows = summarizeActivity(
    ["a", "b", "c"],
    [
      { slug: "a", event: "profile_view", created_at: "2026-10-24T00:00:00Z" },
      { slug: "a", event: "profile_view", created_at: "2026-10-01T00:00:00Z" },
      { slug: "a", event: "website_click", created_at: "2026-10-20T00:00:00Z" },
      { slug: "b", event: "profile_view", created_at: "2026-09-01T00:00:00Z" }, // too old
      { slug: "zzz", event: "profile_view", created_at: "2026-10-24T00:00:00Z" }, // not a provider
    ],
    now
  );
  assert.deepEqual(rows, [
    { slug: "a", views: 2, clicks: 1 },
    { slug: "b", views: 0, clicks: 0 },
    { slug: "c", views: 0, clicks: 0 },
  ]);
});

// ── forms ────────────────────────────────────────────────────────────────────

test("quote form: needs a need and a timeline; budget and message are optional", () => {
  const ok = parseQuote({ need: "  Ten analogues  ", timeline: TIMELINES[1], budget: "", message: "" });
  assert.ok(ok.ok && ok.value.need === "Ten analogues");
  assert.ok(!parseQuote({ need: "", timeline: TIMELINES[0] }).ok);
  assert.ok(!parseQuote({ need: "x", timeline: "whenever" }).ok);
  assert.ok(!parseQuote({ need: "x", timeline: "" }).ok);
  assert.ok(!parseQuote({ need: "x".repeat(LIMITS.need + 1), timeline: TIMELINES[0] }).ok);
  assert.ok(!parseQuote({ need: "x", timeline: TIMELINES[0], budget: "x".repeat(LIMITS.budget + 1) }).ok);
  assert.ok(!parseQuote(null).ok);
});

test("claim form: name, role and a valid work email are required", () => {
  assert.ok(parseClaim({ name: "Ada", role: "CEO", work_email: "ada@acme.com", note: "" }).ok);
  assert.ok(!parseClaim({ name: "", role: "CEO", work_email: "ada@acme.com" }).ok);
  assert.ok(!parseClaim({ name: "Ada", role: "", work_email: "ada@acme.com" }).ok);
  assert.ok(!parseClaim({ name: "Ada", role: "CEO", work_email: "ada" }).ok);
  assert.ok(!parseClaim({ name: "Ada", role: "CEO", work_email: "ada@acme.com", note: "n".repeat(LIMITS.note + 1) }).ok);
});

test("list-your-services form: all five fields, a real website and email", () => {
  const good = { company: "Acme", website: "acme.com", contact_name: "Ada", email: "ada@acme.com", offer: "Custom synthesis" };
  const r = parseProviderRequest(good);
  assert.ok(r.ok && r.value.website === "https://acme.com/");
  for (const key of Object.keys(good)) {
    assert.ok(!parseProviderRequest({ ...good, [key]: "" }).ok, key);
  }
  assert.ok(!parseProviderRequest({ ...good, website: "javascript:alert(1)" }).ok);
  assert.ok(!parseProviderRequest({ ...good, website: "localhost" }).ok);
  assert.ok(!parseProviderRequest({ ...good, email: "nope" }).ok);
  assert.ok(!parseProviderRequest({ ...good, offer: "o".repeat(LIMITS.offer + 1) }).ok);
  assert.ok(!parseProviderRequest({ ...good, company: "c".repeat(LIMITS.company + 1) }).ok);
});

// ── synonyms ─────────────────────────────────────────────────────────────────

const doc = (name: string, text: string) => ({ name, services: [text], description: "" });

test("synonyms: each group finds the others, in both directions", () => {
  const pairs: [string, string][] = [
    ["ADME", "DMPK studies"],
    ["DMPK", "pharmacokinetics"],
    ["pharmacokinetics", "ADME"],
    ["tox", "toxicology"],
    ["toxicology", "safety assessment"],
    ["safety", "tox testing"],
    ["protein expression", "recombinant proteins"],
    ["recombinant proteins", "protein expression"],
    ["cryo-EM", "structural biology"],
    ["structural biology", "crystallography"],
    ["crystallography", "cryo-EM"],
    ["HTS", "screening"],
    ["screening", "HTS campaigns"],
    ["CDMO", "manufacturing"],
    ["manufacturing", "CDMO services"],
    ["AI", "machine learning"],
    ["machine learning", "AI platform"],
  ];
  for (const [q, text] of pairs) assert.ok(matchesQuery(doc("Acme", text), q), `${q} -> ${text}`);
});

test("synonyms: unrelated text still does not match, and short terms need a whole word", () => {
  assert.ok(!matchesQuery(doc("Acme", "peptide synthesis"), "ADME"));
  assert.ok(!matchesQuery(doc("Acme", "peptide synthesis"), "AI"));
  assert.ok(!matchesQuery(doc("Acme", "main street maintenance"), "AI"));
  assert.ok(!matchesQuery(doc("Acme", "stoxic"), "tox"));
  assert.ok(!matchesQuery(doc("Acme", "protein folding"), "protein expression"));
});

test("synonyms combine with other words, and plain search is unchanged", () => {
  const p = doc("Acme", "DMPK and in vivo studies");
  assert.ok(matchesQuery(p, "adme in vivo"));
  assert.ok(!matchesQuery(p, "adme docking"));
  assert.ok(matchesQuery(doc("Acme", "biosynthesis"), "synthesis"));
});

test("synonyms work on the real list", () => {
  const hit = (q: string) => filterProviders(all, q, null).map((p) => p.slug);
  assert.deepEqual(hit("pharmacokinetics").sort(), hit("dmpk").sort());
  assert.deepEqual(hit("ADME").sort(), hit("pharmacokinetics").sort());
  assert.deepEqual(hit("machine learning").sort(), hit("ai").sort());
  assert.ok(hit("ai").length > 0);
});

// ── dates ────────────────────────────────────────────────────────────────────

test("dates are shown in Chicago time", () => {
  assert.equal(formatChicago("2026-10-22T06:46:00Z"), "Oct 22, 1:46 AM"); // CDT, UTC-5
  assert.equal(formatChicago("2026-12-05T21:05:00Z"), "Dec 5, 3:05 PM"); // CST, UTC-6
  assert.equal(formatChicago("2026-10-22T00:30:00Z"), "Oct 21, 7:30 PM");
  assert.equal(formatChicago("not a date"), "");
});
