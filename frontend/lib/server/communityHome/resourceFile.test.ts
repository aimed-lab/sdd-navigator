import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RESOURCE_FILE_BYTES,
  PPTX_MIME,
  checkResourceFile,
  pathBelongsTo,
  resourceFileMime,
  resourceFilePath,
  safeFilename,
  uploadFailureMessage,
} from "./resourceFile.ts";

const C = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";

test("a pptx is allowed, even when the browser reports no type", () => {
  assert.deepEqual(checkResourceFile({ name: "deck.pptx", size: 5_000_000, type: PPTX_MIME }), { ok: true, mime: PPTX_MIME });
  assert.deepEqual(checkResourceFile({ name: "Deck.PPTX", size: 5_000_000, type: "" }), { ok: true, mime: PPTX_MIME });
  assert.equal(resourceFileMime("x.pptx", "application/octet-stream"), PPTX_MIME);
});

test("size: 50 MB is fine, over it is refused with the reason", () => {
  assert.equal(checkResourceFile({ name: "a.pdf", size: MAX_RESOURCE_FILE_BYTES, type: "application/pdf" }).ok, true);
  assert.deepEqual(checkResourceFile({ name: "a.pdf", size: MAX_RESOURCE_FILE_BYTES + 1, type: "application/pdf" }), {
    ok: false,
    error: "File is too large (max 50 MB).",
  });
  assert.equal(checkResourceFile({ name: "a.pdf", size: 0, type: "application/pdf" }).ok, false);
});

test("other file kinds are refused with a message that names the allowed ones", () => {
  for (const name of ["a.exe", "a.docx", "a.ppt", "a.zip", "noext"]) {
    const r = checkResourceFile({ name, size: 10, type: "" });
    assert.equal(r.ok, false, name);
    if (!r.ok) assert.match(r.error, /PPTX/);
  }
});

test("paths are <community>/<resource>/<safe name>", () => {
  assert.equal(resourceFilePath(C, R, "My deck (v2).pptx"), `${C}/${R}/My_deck_v2.pptx`);
  assert.equal(safeFilename("../../etc/passwd"), "etcpasswd");
  assert.equal(safeFilename("   "), "file");
  assert.ok(!safeFilename("a/b\\c.pdf").includes("/"));
});

test("a returned path must sit under that community and resource", () => {
  assert.equal(pathBelongsTo(`${C}/${R}/deck.pptx`, C, R), true);
  assert.equal(pathBelongsTo(`${C}/${R}/sub/deck.pptx`, C, R), false);
  assert.equal(pathBelongsTo(`${C}/other/deck.pptx`, C, R), false);
  assert.equal(pathBelongsTo(`other/${R}/deck.pptx`, C, R), false);
  assert.equal(pathBelongsTo(`${C}/${R}/..`, C, R), false);
  assert.equal(pathBelongsTo(`${C}/${R}/`, C, R), false);
  assert.equal(pathBelongsTo(42, C, R), false);
});

test("storage refusals become plain messages, never blank", () => {
  assert.match(uploadFailureMessage(413, ""), /too large/);
  assert.match(uploadFailureMessage(400, '{"message":"mime type application/x is not supported"}'), /isn't allowed/);
  assert.match(uploadFailureMessage(403, '{"message":"new row violates row-level security policy"}'), /Upload not allowed/);
  assert.match(uploadFailureMessage(404, '{"message":"Bucket not found"}'), /bucket/);
  assert.match(uploadFailureMessage(0, ""), /interrupted/);
  assert.match(uploadFailureMessage(500, "boom"), /error 500/);
});
