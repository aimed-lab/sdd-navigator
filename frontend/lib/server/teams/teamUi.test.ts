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
