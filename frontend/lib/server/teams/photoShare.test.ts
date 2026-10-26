import test from "node:test";
import assert from "node:assert/strict";
import { fitWithin, linkedInUrl, photoCaption, shareRoute, xUrl } from "./photoShare.ts";

const file = { name: "p.jpg" } as unknown as File;

test("caption: team name only when there is no description", () => {
  assert.equal(photoCaption("Alpha Lab", null), "At Alpha Lab");
  assert.equal(photoCaption("Alpha Lab", "   "), "At Alpha Lab");
  assert.equal(photoCaption("  Alpha Lab ", undefined), "At Alpha Lab");
});

test("caption: adds the description after a dash", () => {
  assert.equal(photoCaption("Alpha Lab", "Drug repurposing"), "At Alpha Lab - Drug repurposing");
});

test("caption: nothing hardcoded, no hashtags", () => {
  const c = photoCaption("Zed", "Quux");
  assert.equal(c, "At Zed - Quux");
  assert.ok(!c.includes("#"));
});

test("share route: native only when canShare accepts the file", () => {
  assert.equal(shareRoute({ share: () => {}, canShare: () => true }, file), "native");
  assert.equal(shareRoute({ share: () => {}, canShare: () => false }, file), "fallback");
});

test("share route: fallback when unsupported, no photo, or canShare throws", () => {
  assert.equal(shareRoute(undefined, file), "fallback");
  assert.equal(shareRoute({}, file), "fallback");
  assert.equal(shareRoute({ share: () => {} }, file), "fallback");
  assert.equal(shareRoute({ share: () => {}, canShare: () => true }, null), "fallback");
  assert.equal(
    shareRoute({ share: () => {}, canShare: () => { throw new Error("x"); } }, file),
    "fallback",
  );
});

test("intent urls encode the caption", () => {
  assert.equal(xUrl("a b&c"), "https://twitter.com/intent/tweet?text=a%20b%26c");
  assert.equal(linkedInUrl("a b"), "https://www.linkedin.com/feed/?shareActive=true&text=a%20b");
});

test("fitWithin scales the longest side to 1600 and never upscales", () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
});
