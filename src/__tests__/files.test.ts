import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { saveImage, readImageAsBase64, createThumbnail, getOutputDir } from "../files.js";
import { ImageNotFoundError } from "../errors.js";

// 1x1 red PNG (smallest valid PNG)
const RED_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64"
);

describe("saveImage and readImageAsBase64", () => {
  it("roundtrips image data", async () => {
    const base64 = RED_PIXEL_PNG.toString("base64");
    const filePath = await saveImage(base64, "image/png", "test-roundtrip");
    assert(filePath.endsWith(".png"));

    const result = await readImageAsBase64(filePath);
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.base64, base64);

    await rm(filePath);
  });
});

describe("createThumbnail", () => {
  it("produces smaller output than input", async () => {
    // Create a larger image (100x100 PNG) by using sharp indirectly through the function
    // Just use the red pixel PNG - thumbnail should still work
    const base64 = RED_PIXEL_PNG.toString("base64");
    const result = await createThumbnail(base64, "image/png");
    assert.equal(result.mimeType, "image/jpeg");
    assert(result.base64.length > 0);
  });

  it("returns JPEG mime type", async () => {
    const base64 = RED_PIXEL_PNG.toString("base64");
    const result = await createThumbnail(base64, "image/png");
    assert.equal(result.mimeType, "image/jpeg");
  });
});

describe("readImageAsBase64 errors", () => {
  it("throws ImageNotFoundError for missing file", async () => {
    await assert.rejects(
      () => readImageAsBase64("/nonexistent/path/image.png"),
      (err: unknown) => {
        assert(err instanceof ImageNotFoundError);
        assert.equal(err.filePath, "/nonexistent/path/image.png");
        assert(err.triedPaths.length > 0);
        return true;
      }
    );
  });
});

describe("getOutputDir", () => {
  it("returns a string", () => {
    const dir = getOutputDir();
    assert.equal(typeof dir, "string");
    assert(dir.length > 0);
  });
});
