import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GeminiError,
  PromptBlockedError,
  GenerationStoppedError,
  NoImageError,
  FileError,
  ImageNotFoundError,
} from "../errors.js";

describe("GeminiError", () => {
  it("has correct name and message", () => {
    const err = new GeminiError("test message");
    assert.equal(err.name, "GeminiError");
    assert.equal(err.message, "test message");
    assert(err instanceof Error);
  });
});

describe("PromptBlockedError", () => {
  it("stores blockReason and blockReasonMessage", () => {
    const err = new PromptBlockedError("SAFETY", "unsafe content");
    assert.equal(err.name, "PromptBlockedError");
    assert.equal(err.blockReason, "SAFETY");
    assert.equal(err.blockReasonMessage, "unsafe content");
    assert(err instanceof GeminiError);
    assert(err instanceof Error);
  });

  it("works without blockReasonMessage", () => {
    const err = new PromptBlockedError("OTHER");
    assert.equal(err.blockReason, "OTHER");
    assert.equal(err.blockReasonMessage, undefined);
    assert.match(err.message, /OTHER/);
  });
});

describe("GenerationStoppedError", () => {
  it("stores reasons array", () => {
    const reasons = ["MAX_TOKENS", "SAFETY"];
    const err = new GenerationStoppedError(reasons);
    assert.equal(err.name, "GenerationStoppedError");
    assert.deepEqual(err.reasons, reasons);
    assert(err instanceof GeminiError);
    assert.match(err.message, /MAX_TOKENS; SAFETY/);
  });
});

describe("NoImageError", () => {
  it("has default message", () => {
    const err = new NoImageError();
    assert.equal(err.name, "NoImageError");
    assert.equal(err.message, "No image in Gemini response");
    assert(err instanceof GeminiError);
  });

  it("accepts custom message", () => {
    const err = new NoImageError("custom");
    assert.equal(err.message, "custom");
  });
});

describe("FileError", () => {
  it("has correct name", () => {
    const err = new FileError("file problem");
    assert.equal(err.name, "FileError");
    assert(err instanceof Error);
    assert(!(err instanceof GeminiError));
  });
});

describe("ImageNotFoundError", () => {
  it("stores filePath and triedPaths", () => {
    const err = new ImageNotFoundError("test.png", ["/a/test.png", "/b/test.png"]);
    assert.equal(err.name, "ImageNotFoundError");
    assert.equal(err.filePath, "test.png");
    assert.deepEqual(err.triedPaths, ["/a/test.png", "/b/test.png"]);
    assert(err instanceof FileError);
    assert(err instanceof Error);
  });
});

