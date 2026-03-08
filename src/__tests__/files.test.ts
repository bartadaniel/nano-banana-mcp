import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, basename, resolve } from "node:path";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { saveImage, readImageAsBase64, createThumbnail, getOutputDir } from "../files.js";
import { ImageNotFoundError, AccessDeniedError } from "../errors.js";

// ---------------------------------------------------------------------------
// Test fixtures — real PNG images for realistic testing
// ---------------------------------------------------------------------------

// 1x1 red PNG
const RED_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64"
);

// Generate a larger test image (100x100 blue PNG) using sharp
let LARGE_PNG_BASE64: string;
let LARGE_PNG_BUFFER: Buffer;

before(async () => {
  LARGE_PNG_BUFFER = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
  })
    .png()
    .toBuffer();
  LARGE_PNG_BASE64 = LARGE_PNG_BUFFER.toString("base64");
});

// A 1000x600 test image for thumbnail size verification
let WIDE_IMAGE_BASE64: string;

before(async () => {
  const buf = await sharp({
    create: { width: 1000, height: 600, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  WIDE_IMAGE_BASE64 = buf.toString("base64");
});

// ===================================================================
// saveImage
// ===================================================================

describe("saveImage", () => {
  const savedPaths: string[] = [];

  after(async () => {
    for (const p of savedPaths) {
      if (existsSync(p)) await rm(p);
    }
  });

  it("saves PNG with .png extension for image/png", async () => {
    const base64 = RED_PIXEL_PNG.toString("base64");
    const path = await saveImage(base64, "image/png", "test-png");
    savedPaths.push(path);
    assert(path.endsWith(".png"));
    assert(existsSync(path));
  });

  it("saves JPEG with .jpg extension for image/jpeg", async () => {
    const jpegBuf = await sharp(RED_PIXEL_PNG).jpeg().toBuffer();
    const path = await saveImage(jpegBuf.toString("base64"), "image/jpeg", "test-jpeg");
    savedPaths.push(path);
    assert(path.endsWith(".jpg"));
  });

  it("saves WebP with .webp extension for image/webp", async () => {
    const webpBuf = await sharp(RED_PIXEL_PNG).webp().toBuffer();
    const path = await saveImage(webpBuf.toString("base64"), "image/webp", "test-webp");
    savedPaths.push(path);
    assert(path.endsWith(".webp"));
  });

  it("falls back to .png for unknown MIME type", async () => {
    const base64 = RED_PIXEL_PNG.toString("base64");
    const path = await saveImage(base64, "image/unknown-format", "test-fallback");
    savedPaths.push(path);
    assert(path.endsWith(".png"));
  });

  it("creates output directory if it does not exist", async () => {
    const base64 = RED_PIXEL_PNG.toString("base64");
    const path = await saveImage(base64, "image/png", "test-mkdir");
    savedPaths.push(path);
    assert(existsSync(path));
  });

  it("generates slug from prompt (lowercase, hyphens, no special chars)", async () => {
    const base64 = RED_PIXEL_PNG.toString("base64");
    const path = await saveImage(base64, "image/png", "A Beautiful Cat!!!");
    savedPaths.push(path);
    const name = basename(path);
    // Should be lowercase with hyphens
    assert.match(name, /^a-beautiful-cat-/);
  });

  it("truncates long prompts to 40 chars in filename", async () => {
    const base64 = RED_PIXEL_PNG.toString("base64");
    const longPrompt = "a".repeat(100);
    const path = await saveImage(base64, "image/png", longPrompt);
    savedPaths.push(path);
    const name = basename(path);
    // slug is max 40 chars, then dash, then timestamp, then .ext
    const slug = name.split("-").slice(0, -1).join("-"); // everything before the timestamp
    assert(slug.length <= 40, `slug "${slug}" should be <= 40 chars`);
  });

  it("handles prompts with special characters", async () => {
    const base64 = RED_PIXEL_PNG.toString("base64");
    const path = await saveImage(base64, "image/png", "café & résumé (100% done!)");
    savedPaths.push(path);
    const name = basename(path);
    // non-alphanumeric replaced with hyphens
    assert.match(name, /^caf-r-sum-100-done-/);
  });

  it("handles empty prompt", async () => {
    const base64 = RED_PIXEL_PNG.toString("base64");
    const path = await saveImage(base64, "image/png", "");
    savedPaths.push(path);
    assert(existsSync(path));
  });

  it("writes correct binary content that roundtrips", async () => {
    const base64 = RED_PIXEL_PNG.toString("base64");
    const path = await saveImage(base64, "image/png", "roundtrip-test");
    savedPaths.push(path);
    const written = await readFile(path);
    assert(written.equals(RED_PIXEL_PNG));
  });
});

// ===================================================================
// readImageAsBase64
// ===================================================================

describe("readImageAsBase64", () => {
  let testDir: string;

  before(async () => {
    // Use a subdirectory of cwd so files pass assertPathAllowed security check
    testDir = join(process.cwd(), `.test-tmp-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  after(async () => {
    await rm(testDir, { recursive: true });
  });

  // Test MIME detection for all supported extensions
  const MIME_CASES: Array<{ ext: string; expectedMime: string }> = [
    { ext: ".jpg", expectedMime: "image/jpeg" },
    { ext: ".jpeg", expectedMime: "image/jpeg" },
    { ext: ".png", expectedMime: "image/png" },
    { ext: ".webp", expectedMime: "image/webp" },
    { ext: ".gif", expectedMime: "image/gif" },
    { ext: ".bmp", expectedMime: "image/bmp" },
    { ext: ".tiff", expectedMime: "image/tiff" },
    { ext: ".tif", expectedMime: "image/tiff" },
    { ext: ".svg", expectedMime: "image/svg+xml" },
  ];

  for (const { ext, expectedMime } of MIME_CASES) {
    it(`detects ${expectedMime} for ${ext} extension`, async () => {
      const filePath = join(testDir, `test${ext}`);
      await writeFile(filePath, RED_PIXEL_PNG);

      const result = await readImageAsBase64(filePath);
      assert.equal(result.mimeType, expectedMime);
      assert.equal(result.base64, RED_PIXEL_PNG.toString("base64"));
    });
  }

  it("returns application/octet-stream for unknown extension", async () => {
    const filePath = join(testDir, "test.xyz");
    await writeFile(filePath, RED_PIXEL_PNG);

    const result = await readImageAsBase64(filePath);
    assert.equal(result.mimeType, "application/octet-stream");
  });

  it("handles uppercase extensions via case-insensitive matching", async () => {
    const filePath = join(testDir, "test.PNG");
    await writeFile(filePath, RED_PIXEL_PNG);

    const result = await readImageAsBase64(filePath);
    assert.equal(result.mimeType, "image/png");
  });

  it("roundtrips base64 encoding correctly", async () => {
    const filePath = join(testDir, "roundtrip.png");
    await writeFile(filePath, RED_PIXEL_PNG);

    const result = await readImageAsBase64(filePath);
    const decoded = Buffer.from(result.base64, "base64");
    assert(decoded.equals(RED_PIXEL_PNG));
  });
});

// ===================================================================
// readImageAsBase64 — error cases
// ===================================================================

describe("readImageAsBase64 errors", () => {
  it("throws ImageNotFoundError for nonexistent file", async () => {
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

  it("includes all tried paths in ImageNotFoundError", async () => {
    await assert.rejects(
      () => readImageAsBase64("some-image.png"),
      (err: unknown) => {
        assert(err instanceof ImageNotFoundError);
        // Should try: the path itself, cwd-relative, output-dir-relative, basename in output dir
        assert(err.triedPaths.length >= 4, `expected >= 4 tried paths, got ${err.triedPaths.length}`);
        return true;
      }
    );
  });

  it("throws AccessDeniedError for file outside allowed directories", async () => {
    // Create a file in /tmp which is outside cwd and OUTPUT_DIR
    const tmpFile = join(tmpdir(), `denied-test-${Date.now()}.png`);
    await writeFile(tmpFile, RED_PIXEL_PNG);

    try {
      await assert.rejects(
        () => readImageAsBase64(tmpFile),
        (err: unknown) => {
          assert(err instanceof AccessDeniedError);
          assert.equal(err.filePath, tmpFile);
          assert(err.allowedDirs.length > 0);
          return true;
        }
      );
    } finally {
      await rm(tmpFile);
    }
  });
});

// ===================================================================
// createThumbnail
// Per implementation: max 512px longest side, JPEG quality 80
// ===================================================================

describe("createThumbnail", () => {
  it("always returns image/jpeg MIME type", async () => {
    const result = await createThumbnail(LARGE_PNG_BASE64, "image/png");
    assert.equal(result.mimeType, "image/jpeg");
  });

  it("returns valid base64 that decodes to a JPEG", async () => {
    const result = await createThumbnail(LARGE_PNG_BASE64, "image/png");
    const buf = Buffer.from(result.base64, "base64");
    // JPEG magic bytes: FF D8 FF
    assert.equal(buf[0], 0xff);
    assert.equal(buf[1], 0xd8);
    assert.equal(buf[2], 0xff);
  });

  it("constrains longest side to 512px for landscape image", async () => {
    const result = await createThumbnail(WIDE_IMAGE_BASE64, "image/png");
    const metadata = await sharp(Buffer.from(result.base64, "base64")).metadata();
    assert(metadata.width! <= 512, `width ${metadata.width} should be <= 512`);
    assert(metadata.height! <= 512, `height ${metadata.height} should be <= 512`);
    // Landscape: width should be the constrained dimension
    assert.equal(metadata.width, 512);
    // Aspect ratio preserved: 1000:600 = 512:~307
    assert(metadata.height! >= 300 && metadata.height! <= 310);
  });

  it("constrains longest side to 512px for portrait image", async () => {
    const tallBuf = await sharp({
      create: { width: 400, height: 1000, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .png()
      .toBuffer();

    const result = await createThumbnail(tallBuf.toString("base64"), "image/png");
    const metadata = await sharp(Buffer.from(result.base64, "base64")).metadata();
    assert.equal(metadata.height, 512);
    assert(metadata.width! >= 200 && metadata.width! <= 210);
  });

  it("handles small images (sharp fit:inside may upscale to 512)", async () => {
    // 50x50 image — sharp's resize with fit: "inside" can upscale
    const smallBuf = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .png()
      .toBuffer();

    const result = await createThumbnail(smallBuf.toString("base64"), "image/png");
    const metadata = await sharp(Buffer.from(result.base64, "base64")).metadata();
    // Output is valid JPEG regardless of scaling behavior
    assert.equal(result.mimeType, "image/jpeg");
    assert(metadata.width! <= 512);
    assert(metadata.height! <= 512);
  });

  it("produces smaller output than a large input", async () => {
    const result = await createThumbnail(WIDE_IMAGE_BASE64, "image/png");
    const thumbSize = Buffer.from(result.base64, "base64").length;
    const origSize = Buffer.from(WIDE_IMAGE_BASE64, "base64").length;
    assert(thumbSize < origSize, `thumbnail (${thumbSize}B) should be smaller than original (${origSize}B)`);
  });

  it("handles image/jpeg input (converts to JPEG thumbnail)", async () => {
    const jpegBuf = await sharp(RED_PIXEL_PNG).jpeg().toBuffer();
    const result = await createThumbnail(jpegBuf.toString("base64"), "image/jpeg");
    assert.equal(result.mimeType, "image/jpeg");
    assert(result.base64.length > 0);
  });

  it("handles image/webp input (converts to JPEG thumbnail)", async () => {
    const webpBuf = await sharp(RED_PIXEL_PNG).webp().toBuffer();
    const result = await createThumbnail(webpBuf.toString("base64"), "image/webp");
    assert.equal(result.mimeType, "image/jpeg");
    assert(result.base64.length > 0);
  });
});

// ===================================================================
// getOutputDir
// ===================================================================

describe("getOutputDir", () => {
  it("returns a non-empty string", () => {
    const dir = getOutputDir();
    assert.equal(typeof dir, "string");
    assert(dir.length > 0);
  });

  it("returns an absolute path", () => {
    const dir = getOutputDir();
    assert(dir.startsWith("/"), `expected absolute path, got: ${dir}`);
  });

  it("defaults to ~/nano-banana-output when OUTPUT_DIR not set", () => {
    // This test verifies the default unless OUTPUT_DIR is explicitly set in env
    if (!process.env.OUTPUT_DIR) {
      const dir = getOutputDir();
      assert(dir.endsWith("nano-banana-output"), `expected path ending in nano-banana-output, got: ${dir}`);
    }
  });
});

// ===================================================================
// Path resolution (tested through readImageAsBase64)
// resolveImagePath tries 4 strategies:
//   1. Absolute/as-given path
//   2. Relative to cwd
//   3. Relative to OUTPUT_DIR
//   4. Basename in OUTPUT_DIR
// ===================================================================

describe("path resolution strategies", () => {
  it("finds file by absolute path", async () => {
    const base64 = RED_PIXEL_PNG.toString("base64");
    const filePath = await saveImage(base64, "image/png", "abs-path-test");

    try {
      const result = await readImageAsBase64(filePath);
      assert.equal(result.base64, base64);
    } finally {
      await rm(filePath);
    }
  });

  it("finds file by basename in output dir", async () => {
    const base64 = RED_PIXEL_PNG.toString("base64");
    const filePath = await saveImage(base64, "image/png", "basename-test");
    const name = basename(filePath);

    try {
      const result = await readImageAsBase64(name);
      assert.equal(result.base64, base64);
    } finally {
      await rm(filePath);
    }
  });

  it("finds file relative to cwd", async () => {
    // Save a file in the cwd
    const testFile = join(process.cwd(), `cwd-test-${Date.now()}.png`);
    await writeFile(testFile, RED_PIXEL_PNG);

    try {
      const result = await readImageAsBase64(basename(testFile));
      assert.equal(result.mimeType, "image/png");
    } finally {
      await rm(testFile);
    }
  });
});
