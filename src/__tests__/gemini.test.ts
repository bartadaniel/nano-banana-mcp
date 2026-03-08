import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { GoogleGenAI } from "@google/genai";
import {
  generateImage,
  editImage,
  describeImage,
  getModelName,
  getDescribeModelName,
  _setClientForTesting,
} from "../gemini.js";
import {
  GeminiError,
  PromptBlockedError,
  GenerationStoppedError,
  NoImageError,
} from "../errors.js";

// ---------------------------------------------------------------------------
// Helpers — build mock API responses matching documented Gemini response shapes
// ---------------------------------------------------------------------------

const FAKE_BASE64 = Buffer.from("fake-image-data").toString("base64");

function makeMockClient(
  generateContentFn: (req: Record<string, unknown>) => unknown
): GoogleGenAI {
  return {
    models: { generateContent: async (req: Record<string, unknown>) => generateContentFn(req) },
  } as unknown as GoogleGenAI;
}

function makeMockClientStatic(response: unknown): GoogleGenAI {
  return makeMockClient(() => response);
}

/**
 * Build a response matching GenerateContentResponse with interleaved text + image parts.
 * Per API docs: image generation returns candidates[].content.parts with inlineData + optional text.
 */
function makeImageResponse(
  base64 = FAKE_BASE64,
  mimeType = "image/png",
  text?: string
) {
  const parts: unknown[] = [{ inlineData: { data: base64, mimeType } }];
  if (text) parts.push({ text });
  return {
    candidates: [{ finishReason: "STOP", content: { parts } }],
  };
}

function makeTextOnlyResponse(text: string) {
  return {
    candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
  };
}

function makeBlockedResponse(
  blockReason: string,
  blockReasonMessage?: string
) {
  return {
    promptFeedback: { blockReason, blockReasonMessage },
    candidates: [],
  };
}

function makeFinishReasonResponse(
  finishReason: string,
  finishMessage?: string
) {
  return {
    candidates: [{ finishReason, finishMessage }],
  };
}

// ===================================================================
// buildConfig (tested indirectly through generateImage/editImage)
// Per API docs: GenerateContentConfig must include responseModalities: ["TEXT","IMAGE"]
// and optionally imageConfig { aspectRatio, imageSize } and systemInstruction
// ===================================================================

describe("buildConfig via generateImage", () => {
  it("always sets responseModalities to TEXT and IMAGE", async () => {
    let capturedConfig: Record<string, unknown> = {};
    _setClientForTesting(makeMockClient((req) => {
      capturedConfig = req.config as Record<string, unknown>;
      return makeImageResponse();
    }));

    await generateImage("a cat");
    assert.deepEqual(capturedConfig.responseModalities, ["TEXT", "IMAGE"]);
  });

  it("does not set imageConfig when no aspectRatio or size", async () => {
    let capturedConfig: Record<string, unknown> = {};
    _setClientForTesting(makeMockClient((req) => {
      capturedConfig = req.config as Record<string, unknown>;
      return makeImageResponse();
    }));

    await generateImage("a cat");
    assert.equal(capturedConfig.imageConfig, undefined);
  });

  it("sets imageConfig.aspectRatio only", async () => {
    let capturedConfig: Record<string, unknown> = {};
    _setClientForTesting(makeMockClient((req) => {
      capturedConfig = req.config as Record<string, unknown>;
      return makeImageResponse();
    }));

    await generateImage("a cat", { aspectRatio: "16:9" });
    const ic = capturedConfig.imageConfig as Record<string, unknown>;
    assert.equal(ic.aspectRatio, "16:9");
    assert.equal(ic.imageSize, undefined);
  });

  it("sets imageConfig.imageSize only", async () => {
    let capturedConfig: Record<string, unknown> = {};
    _setClientForTesting(makeMockClient((req) => {
      capturedConfig = req.config as Record<string, unknown>;
      return makeImageResponse();
    }));

    await generateImage("a cat", { size: "2K" });
    const ic = capturedConfig.imageConfig as Record<string, unknown>;
    assert.equal(ic.imageSize, "2K");
    assert.equal(ic.aspectRatio, undefined);
  });

  it("sets both aspectRatio and imageSize", async () => {
    let capturedConfig: Record<string, unknown> = {};
    _setClientForTesting(makeMockClient((req) => {
      capturedConfig = req.config as Record<string, unknown>;
      return makeImageResponse();
    }));

    await generateImage("a cat", { aspectRatio: "4:3", size: "4K" });
    const ic = capturedConfig.imageConfig as Record<string, unknown>;
    assert.equal(ic.aspectRatio, "4:3");
    assert.equal(ic.imageSize, "4K");
  });

  it("passes systemInstruction as string (valid per ContentUnion type)", async () => {
    let capturedConfig: Record<string, unknown> = {};
    _setClientForTesting(makeMockClient((req) => {
      capturedConfig = req.config as Record<string, unknown>;
      return makeImageResponse();
    }));

    await generateImage("a cat", { systemInstruction: "Be creative" });
    assert.equal(capturedConfig.systemInstruction, "Be creative");
  });

  it("does not set systemInstruction when not provided", async () => {
    let capturedConfig: Record<string, unknown> = {};
    _setClientForTesting(makeMockClient((req) => {
      capturedConfig = req.config as Record<string, unknown>;
      return makeImageResponse();
    }));

    await generateImage("a cat");
    assert.equal(capturedConfig.systemInstruction, undefined);
  });

  // Per SDK docs: imageSize supported values are "1K", "2K", "4K" (and "512px" for Flash models)
  it("passes documented imageSize values through to config", async () => {
    for (const size of ["512px", "1K", "2K", "4K"]) {
      let capturedConfig: Record<string, unknown> = {};
      _setClientForTesting(makeMockClient((req) => {
        capturedConfig = req.config as Record<string, unknown>;
        return makeImageResponse();
      }));

      await generateImage("a cat", { size });
      const ic = capturedConfig.imageConfig as Record<string, unknown>;
      assert.equal(ic.imageSize, size, `imageSize should be "${size}"`);
    }
  });

  // Per SDK docs: aspectRatio supported values for Gemini image models
  it("passes documented aspectRatio values through to config", async () => {
    const documented = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
    for (const ar of documented) {
      let capturedConfig: Record<string, unknown> = {};
      _setClientForTesting(makeMockClient((req) => {
        capturedConfig = req.config as Record<string, unknown>;
        return makeImageResponse();
      }));

      await generateImage("a cat", { aspectRatio: ar });
      const ic = capturedConfig.imageConfig as Record<string, unknown>;
      assert.equal(ic.aspectRatio, ar, `aspectRatio should be "${ar}"`);
    }
  });
});

// ===================================================================
// Negative prompt (no native API support — prompt injection approach)
// Per Google docs: "Describe what you want, not what you don't."
// negativePrompt was a legacy Imagen-only field, not available in generateContent.
// ===================================================================

describe("negative prompt injection", () => {
  it("appends [Do NOT include: ...] suffix to prompt text", async () => {
    let capturedText = "";
    _setClientForTesting(makeMockClient((req) => {
      const contents = req.contents as Array<{ parts: Array<{ text?: string }> }>;
      capturedText = contents[0].parts.find((p) => p.text)?.text ?? "";
      return makeImageResponse();
    }));

    await generateImage("a sunset", { negativePrompt: "clouds, rain" });
    assert.equal(capturedText, "a sunset\n\n[Do NOT include: clouds, rain]");
  });

  it("leaves prompt unchanged when negativePrompt is undefined", async () => {
    let capturedText = "";
    _setClientForTesting(makeMockClient((req) => {
      const contents = req.contents as Array<{ parts: Array<{ text?: string }> }>;
      capturedText = contents[0].parts.find((p) => p.text)?.text ?? "";
      return makeImageResponse();
    }));

    await generateImage("a sunset");
    assert.equal(capturedText, "a sunset");
  });

  it("applies negative prompt in editImage too", async () => {
    let capturedText = "";
    _setClientForTesting(makeMockClient((req) => {
      const contents = req.contents as Array<{ parts: Array<{ text?: string }> }>;
      capturedText = contents[0].parts.find((p) => p.text)?.text ?? "";
      return makeImageResponse();
    }));

    await editImage("fix colors", [{ base64: "img", mimeType: "image/png" }], {
      negativePrompt: "blur",
    });
    assert.match(capturedText, /\[Do NOT include: blur\]/);
  });
});

// ===================================================================
// generateImage
// Per API docs: Gemini returns ONE image per generateContent call.
// Batch generation uses Promise.all with N parallel calls.
// ===================================================================

describe("generateImage", () => {
  beforeEach(() => {
    _setClientForTesting(makeMockClientStatic(makeImageResponse()));
  });

  it("returns array with single result by default", async () => {
    const results = await generateImage("a cat");
    assert.equal(results.length, 1);
    assert.equal(results[0].base64, FAKE_BASE64);
    assert.equal(results[0].mimeType, "image/png");
    assert.equal(results[0].text, undefined);
  });

  it("returns n results via parallel calls (n=4 max)", async () => {
    let callCount = 0;
    _setClientForTesting(makeMockClient(() => {
      callCount++;
      return makeImageResponse();
    }));

    const results = await generateImage("a cat", { n: 4 });
    assert.equal(results.length, 4);
    assert.equal(callCount, 4, "should make 4 separate API calls");
  });

  it("defaults n to 1 when not specified", async () => {
    let callCount = 0;
    _setClientForTesting(makeMockClient(() => {
      callCount++;
      return makeImageResponse();
    }));

    await generateImage("a cat");
    assert.equal(callCount, 1);
  });

  // Per API docs: response may contain interleaved text + image parts
  it("extracts text alongside image from interleaved response", async () => {
    _setClientForTesting(makeMockClientStatic(makeImageResponse(FAKE_BASE64, "image/png", "Here is your cat")));
    const results = await generateImage("a cat");
    assert.equal(results[0].text, "Here is your cat");
    assert.equal(results[0].base64, FAKE_BASE64);
  });

  it("concatenates multiple text parts with newlines", async () => {
    _setClientForTesting(makeMockClientStatic({
      candidates: [{
        finishReason: "STOP",
        content: {
          parts: [
            { text: "Part 1" },
            { inlineData: { data: FAKE_BASE64, mimeType: "image/png" } },
            { text: "Part 2" },
          ],
        },
      }],
    }));

    const results = await generateImage("a cat");
    assert.equal(results[0].text, "Part 1\nPart 2");
  });

  it("sends correct model name in request", async () => {
    let capturedModel = "";
    _setClientForTesting(makeMockClient((req) => {
      capturedModel = req.model as string;
      return makeImageResponse();
    }));

    await generateImage("a cat");
    assert.equal(capturedModel, getModelName());
  });

  it("sends contents with role 'user' and text part", async () => {
    let capturedContents: unknown = null;
    _setClientForTesting(makeMockClient((req) => {
      capturedContents = req.contents;
      return makeImageResponse();
    }));

    await generateImage("a cat");
    const contents = capturedContents as Array<{ role: string; parts: Array<{ text: string }> }>;
    assert.equal(contents[0].role, "user");
    assert.equal(contents[0].parts[0].text, "a cat");
  });

  // Edge case: n=0 produces empty result array (no validation in code)
  it("returns empty array when n=0", async () => {
    let callCount = 0;
    _setClientForTesting(makeMockClient(() => {
      callCount++;
      return makeImageResponse();
    }));

    const results = await generateImage("a cat", { n: 0 });
    assert.equal(results.length, 0);
    assert.equal(callCount, 0, "should make zero API calls");
  });

  // Edge case: if one parallel call fails, Promise.all rejects with the first error
  it("rejects with first error when one of n parallel calls fails", async () => {
    let callCount = 0;
    _setClientForTesting(makeMockClient(() => {
      callCount++;
      if (callCount === 2) return makeBlockedResponse("SAFETY", "unsafe");
      return makeImageResponse();
    }));

    await assert.rejects(() => generateImage("test", { n: 3 }), (err: unknown) => {
      assert(err instanceof PromptBlockedError);
      return true;
    });
  });
});

// ===================================================================
// editImage
// Per API docs: images sent as inlineData { data (base64), mimeType } in parts.
// Gemini 2.5 Flash Image supports up to 3 input images.
// ===================================================================

describe("editImage", () => {
  beforeEach(() => {
    _setClientForTesting(makeMockClientStatic(makeImageResponse()));
  });

  it("sends single image as inlineData part followed by text", async () => {
    let capturedParts: unknown[] = [];
    _setClientForTesting(makeMockClient((req) => {
      const contents = req.contents as Array<{ parts: unknown[] }>;
      capturedParts = contents[0].parts;
      return makeImageResponse();
    }));

    await editImage("make brighter", [{ base64: "imgdata", mimeType: "image/jpeg" }]);

    // Per API docs: inlineData parts then text part
    assert.equal(capturedParts.length, 2);
    const imgPart = capturedParts[0] as { inlineData: { data: string; mimeType: string } };
    assert.equal(imgPart.inlineData.data, "imgdata");
    assert.equal(imgPart.inlineData.mimeType, "image/jpeg");
    const textPart = capturedParts[1] as { text: string };
    assert.equal(textPart.text, "make brighter");
  });

  it("sends multiple images as inlineData parts", async () => {
    let capturedParts: unknown[] = [];
    _setClientForTesting(makeMockClient((req) => {
      const contents = req.contents as Array<{ parts: unknown[] }>;
      capturedParts = contents[0].parts;
      return makeImageResponse();
    }));

    const images = [
      { base64: "img1", mimeType: "image/png" },
      { base64: "img2", mimeType: "image/jpeg" },
      { base64: "img3", mimeType: "image/webp" },
    ];
    await editImage("combine these", images);

    // 3 inlineData parts + 1 text part = 4 total
    assert.equal(capturedParts.length, 4);
    for (let i = 0; i < 3; i++) {
      const part = capturedParts[i] as { inlineData: { data: string; mimeType: string } };
      assert.equal(part.inlineData.data, images[i].base64);
      assert.equal(part.inlineData.mimeType, images[i].mimeType);
    }
    const textPart = capturedParts[3] as { text: string };
    assert.equal(textPart.text, "combine these");
  });

  // Per official Google docs: gemini-3.1-flash-image-preview supports up to 14 reference images
  it("sends up to 10 images (1 primary + 9 additional per tool schema)", async () => {
    let capturedParts: unknown[] = [];
    _setClientForTesting(makeMockClient((req) => {
      const contents = req.contents as Array<{ parts: unknown[] }>;
      capturedParts = contents[0].parts;
      return makeImageResponse();
    }));

    const images = Array.from({ length: 10 }, (_, i) => ({
      base64: `img${i}`,
      mimeType: "image/png",
    }));
    await editImage("combine all", images);

    // 10 inlineData parts + 1 text part = 11 total
    assert.equal(capturedParts.length, 11);
    for (let i = 0; i < 10; i++) {
      const part = capturedParts[i] as { inlineData: { data: string; mimeType: string } };
      assert.equal(part.inlineData.data, `img${i}`);
    }
    const textPart = capturedParts[10] as { text: string };
    assert.equal(textPart.text, "combine all");
  });

  it("returns extracted image result", async () => {
    const result = await editImage("fix", [{ base64: "x", mimeType: "image/png" }]);
    assert.equal(result.base64, FAKE_BASE64);
    assert.equal(result.mimeType, "image/png");
  });

  it("passes aspectRatio and size through to config", async () => {
    let capturedConfig: Record<string, unknown> = {};
    _setClientForTesting(makeMockClient((req) => {
      capturedConfig = req.config as Record<string, unknown>;
      return makeImageResponse();
    }));

    await editImage("fix", [{ base64: "x", mimeType: "image/png" }], {
      aspectRatio: "3:2",
      size: "2K",
    });
    const ic = capturedConfig.imageConfig as Record<string, unknown>;
    assert.equal(ic.aspectRatio, "3:2");
    assert.equal(ic.imageSize, "2K");
  });

  it("passes systemInstruction through to config", async () => {
    let capturedConfig: Record<string, unknown> = {};
    _setClientForTesting(makeMockClient((req) => {
      capturedConfig = req.config as Record<string, unknown>;
      return makeImageResponse();
    }));

    await editImage("fix", [{ base64: "x", mimeType: "image/png" }], {
      systemInstruction: "Professional style",
    });
    assert.equal(capturedConfig.systemInstruction, "Professional style");
  });

  it("uses the image generation model (not describe model)", async () => {
    let capturedModel = "";
    _setClientForTesting(makeMockClient((req) => {
      capturedModel = req.model as string;
      return makeImageResponse();
    }));

    await editImage("fix", [{ base64: "x", mimeType: "image/png" }]);
    assert.equal(capturedModel, getModelName());
  });

  // Edge case: empty images array sends only text part
  it("sends only text part when images array is empty", async () => {
    let capturedParts: unknown[] = [];
    _setClientForTesting(makeMockClient((req) => {
      const contents = req.contents as Array<{ parts: unknown[] }>;
      capturedParts = contents[0].parts;
      return makeImageResponse();
    }));

    await editImage("create from scratch", []);
    assert.equal(capturedParts.length, 1);
    assert.equal((capturedParts[0] as { text: string }).text, "create from scratch");
  });
});

// ===================================================================
// describeImage
// Per API docs: uses a text-only model (no responseModalities: IMAGE needed)
// ===================================================================

describe("describeImage", () => {
  it("uses the describe model, not the image model", async () => {
    let capturedModel = "";
    _setClientForTesting(makeMockClient((req) => {
      capturedModel = req.model as string;
      return makeTextOnlyResponse("A landscape");
    }));

    await describeImage("base64data", "image/png");
    assert.equal(capturedModel, getDescribeModelName());
    assert.notEqual(capturedModel, getModelName());
  });

  it("uses default prompt when no question provided", async () => {
    let capturedText = "";
    _setClientForTesting(makeMockClient((req) => {
      const contents = req.contents as Array<{ parts: Array<{ text?: string }> }>;
      capturedText = contents[0].parts.find((p) => p.text)?.text ?? "";
      return makeTextOnlyResponse("A cat");
    }));

    await describeImage("base64data", "image/png");
    assert.equal(capturedText, "Describe this image in detail.");
  });

  it("uses custom question when provided", async () => {
    let capturedText = "";
    _setClientForTesting(makeMockClient((req) => {
      const contents = req.contents as Array<{ parts: Array<{ text?: string }> }>;
      capturedText = contents[0].parts.find((p) => p.text)?.text ?? "";
      return makeTextOnlyResponse("3 cats");
    }));

    await describeImage("base64data", "image/png", "How many cats?");
    assert.equal(capturedText, "How many cats?");
  });

  it("sends image as inlineData part", async () => {
    let capturedParts: unknown[] = [];
    _setClientForTesting(makeMockClient((req) => {
      const contents = req.contents as Array<{ parts: unknown[] }>;
      capturedParts = contents[0].parts;
      return makeTextOnlyResponse("desc");
    }));

    await describeImage("mybase64", "image/jpeg");
    const imgPart = capturedParts[0] as { inlineData: { data: string; mimeType: string } };
    assert.equal(imgPart.inlineData.data, "mybase64");
    assert.equal(imgPart.inlineData.mimeType, "image/jpeg");
  });

  it("passes systemInstruction in config when provided", async () => {
    let capturedConfig: unknown = undefined;
    _setClientForTesting(makeMockClient((req) => {
      capturedConfig = req.config;
      return makeTextOnlyResponse("desc");
    }));

    await describeImage("base64", "image/png", undefined, "Be concise");
    assert.deepEqual(capturedConfig, { systemInstruction: "Be concise" });
  });

  it("does not send config when no systemInstruction", async () => {
    let capturedConfig: unknown = "SENTINEL";
    _setClientForTesting(makeMockClient((req) => {
      capturedConfig = req.config;
      return makeTextOnlyResponse("desc");
    }));

    await describeImage("base64", "image/png");
    assert.equal(capturedConfig, undefined);
  });

  it("returns text description", async () => {
    _setClientForTesting(makeMockClientStatic(makeTextOnlyResponse("A beautiful landscape")));
    const result = await describeImage("base64", "image/png");
    assert.equal(result, "A beautiful landscape");
  });

  it("concatenates multiple text parts", async () => {
    _setClientForTesting(makeMockClientStatic({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: "Line 1" }, { text: "Line 2" }] },
      }],
    }));

    const result = await describeImage("base64", "image/png");
    assert.equal(result, "Line 1\nLine 2");
  });

  it("throws GeminiError when response has no text", async () => {
    _setClientForTesting(makeMockClientStatic({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [] },
      }],
    }));

    await assert.rejects(() => describeImage("base64", "image/png"), (err: unknown) => {
      assert(err instanceof GeminiError);
      assert.match(err.message, /No description/);
      return true;
    });
  });
});

// ===================================================================
// BlockedReason handling
// Per API docs, all documented BlockedReason values:
// BLOCKED_REASON_UNSPECIFIED, SAFETY, OTHER, BLOCKLIST,
// PROHIBITED_CONTENT, IMAGE_SAFETY, MODEL_ARMOR, JAILBREAK
// ===================================================================

describe("PromptBlockedError for all documented BlockedReason values", () => {
  const BLOCKED_REASONS = [
    "BLOCKED_REASON_UNSPECIFIED",
    "SAFETY",
    "OTHER",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "IMAGE_SAFETY",
    "MODEL_ARMOR",
    "JAILBREAK",
  ];

  for (const reason of BLOCKED_REASONS) {
    it(`throws PromptBlockedError for blockReason=${reason}`, async () => {
      _setClientForTesting(makeMockClientStatic(makeBlockedResponse(reason, `Blocked: ${reason}`)));

      await assert.rejects(() => generateImage("test"), (err: unknown) => {
        assert(err instanceof PromptBlockedError);
        assert.equal(err.blockReason, reason);
        assert.equal(err.blockReasonMessage, `Blocked: ${reason}`);
        return true;
      });
    });
  }

  it("handles blockReason without blockReasonMessage", async () => {
    _setClientForTesting(makeMockClientStatic(makeBlockedResponse("SAFETY")));

    await assert.rejects(() => generateImage("test"), (err: unknown) => {
      assert(err instanceof PromptBlockedError);
      assert.equal(err.blockReason, "SAFETY");
      assert.equal(err.blockReasonMessage, undefined);
      return true;
    });
  });

  it("throws PromptBlockedError in editImage too", async () => {
    _setClientForTesting(makeMockClientStatic(makeBlockedResponse("IMAGE_SAFETY", "Unsafe content")));

    await assert.rejects(
      () => editImage("test", [{ base64: "x", mimeType: "image/png" }]),
      (err: unknown) => {
        assert(err instanceof PromptBlockedError);
        assert.equal(err.blockReason, "IMAGE_SAFETY");
        return true;
      }
    );
  });

  it("throws PromptBlockedError in describeImage too", async () => {
    _setClientForTesting(makeMockClientStatic(makeBlockedResponse("SAFETY")));

    await assert.rejects(
      () => describeImage("base64", "image/png"),
      (err: unknown) => {
        assert(err instanceof PromptBlockedError);
        return true;
      }
    );
  });
});

// ===================================================================
// FinishReason handling
// Per API docs, all documented FinishReason values.
// STOP and undefined = success. Everything else = GenerationStoppedError.
// Image-specific: IMAGE_SAFETY, IMAGE_PROHIBITED_CONTENT, IMAGE_RECITATION,
//                 IMAGE_OTHER, NO_IMAGE
// ===================================================================

describe("FinishReason handling", () => {
  it("succeeds on finishReason=STOP", async () => {
    _setClientForTesting(makeMockClientStatic(makeImageResponse()));
    const results = await generateImage("test");
    assert.equal(results.length, 1);
  });

  it("succeeds on undefined finishReason (treated as STOP)", async () => {
    _setClientForTesting(makeMockClientStatic({
      candidates: [{
        content: { parts: [{ inlineData: { data: FAKE_BASE64, mimeType: "image/png" } }] },
      }],
    }));

    const results = await generateImage("test");
    assert.equal(results.length, 1);
  });

  // All non-STOP documented finishReasons should throw GenerationStoppedError
  // FINISH_REASON_UNSPECIFIED is a truthy string — our code only treats
  // falsy (!finishReason) or "STOP" as success, so this is an error case
  it("throws GenerationStoppedError for FINISH_REASON_UNSPECIFIED (truthy non-STOP string)", async () => {
    _setClientForTesting(makeMockClientStatic(makeFinishReasonResponse("FINISH_REASON_UNSPECIFIED")));

    await assert.rejects(() => generateImage("test"), (err: unknown) => {
      assert(err instanceof GenerationStoppedError);
      assert(err.reasons.includes("FINISH_REASON_UNSPECIFIED"));
      return true;
    });
  });

  // All non-STOP documented finishReasons should throw GenerationStoppedError
  const NON_STOP_REASONS = [
    "MAX_TOKENS",
    "SAFETY",
    "RECITATION",
    "LANGUAGE",
    "OTHER",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "SPII",
    "MALFORMED_FUNCTION_CALL",
    // Image-specific finish reasons (especially relevant for image generation)
    "IMAGE_SAFETY",
    "IMAGE_PROHIBITED_CONTENT",
    "IMAGE_RECITATION",
    "IMAGE_OTHER",
    "NO_IMAGE",
    "UNEXPECTED_TOOL_CALL",
  ];

  for (const reason of NON_STOP_REASONS) {
    it(`throws GenerationStoppedError for finishReason=${reason}`, async () => {
      _setClientForTesting(makeMockClientStatic(makeFinishReasonResponse(reason)));

      await assert.rejects(() => generateImage("test"), (err: unknown) => {
        assert(err instanceof GenerationStoppedError);
        assert(err.reasons.includes(reason));
        return true;
      });
    });
  }

  it("includes finishMessage in GenerationStoppedError when present", async () => {
    _setClientForTesting(makeMockClientStatic(
      makeFinishReasonResponse("IMAGE_SAFETY", "Generated image contains unsafe content")
    ));

    await assert.rejects(() => generateImage("test"), (err: unknown) => {
      assert(err instanceof GenerationStoppedError);
      assert(err.reasons.some((r: string) => r.includes("IMAGE_SAFETY") && r.includes("Generated image contains unsafe content")));
      return true;
    });
  });

  it("throws GeminiError when candidates array is empty", async () => {
    _setClientForTesting(makeMockClientStatic({ candidates: [] }));

    await assert.rejects(() => generateImage("test"), (err: unknown) => {
      assert(err instanceof GeminiError);
      assert(!(err instanceof PromptBlockedError));
      assert(!(err instanceof GenerationStoppedError));
      return true;
    });
  });

  it("throws GeminiError when candidates is undefined", async () => {
    _setClientForTesting(makeMockClientStatic({}));

    await assert.rejects(() => generateImage("test"), (err: unknown) => {
      assert(err instanceof GeminiError);
      return true;
    });
  });
});

// ===================================================================
// extractImageFromResponse edge cases
// Per API docs: Part.inlineData.data is "Required" (base64), Part.inlineData.mimeType is "Required"
// ===================================================================

describe("image extraction from response", () => {
  it("throws NoImageError when inlineData.data is missing", async () => {
    _setClientForTesting(makeMockClientStatic({
      candidates: [{
        finishReason: "STOP",
        content: {
          parts: [{ inlineData: { mimeType: "image/png" } }],
        },
      }],
    }));

    await assert.rejects(() => generateImage("test"), (err: unknown) => {
      assert(err instanceof NoImageError);
      assert.match(err.message, /missing base64/);
      return true;
    });
  });

  it("throws NoImageError when inlineData.mimeType is missing", async () => {
    _setClientForTesting(makeMockClientStatic({
      candidates: [{
        finishReason: "STOP",
        content: {
          parts: [{ inlineData: { data: FAKE_BASE64 } }],
        },
      }],
    }));

    await assert.rejects(() => generateImage("test"), (err: unknown) => {
      assert(err instanceof NoImageError);
      assert.match(err.message, /missing MIME type/);
      return true;
    });
  });

  // Per API docs: "model might not create the exact number of images" / may return only text
  it("throws NoImageError when response contains only text (no image generated)", async () => {
    _setClientForTesting(makeMockClientStatic(makeTextOnlyResponse("I cannot generate that image")));

    await assert.rejects(() => generateImage("test"), (err: unknown) => {
      assert(err instanceof NoImageError);
      return true;
    });
  });

  it("throws NoImageError when parts array is empty", async () => {
    _setClientForTesting(makeMockClientStatic({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [] },
      }],
    }));

    await assert.rejects(() => generateImage("test"), (err: unknown) => {
      assert(err instanceof NoImageError);
      return true;
    });
  });

  it("handles response where content.parts is undefined", async () => {
    _setClientForTesting(makeMockClientStatic({
      candidates: [{
        finishReason: "STOP",
        content: {},
      }],
    }));

    await assert.rejects(() => generateImage("test"), (err: unknown) => {
      assert(err instanceof NoImageError);
      return true;
    });
  });

  it("handles response where content is undefined", async () => {
    _setClientForTesting(makeMockClientStatic({
      candidates: [{ finishReason: "STOP" }],
    }));

    await assert.rejects(() => generateImage("test"), (err: unknown) => {
      assert(err instanceof NoImageError);
      return true;
    });
  });

  // Per API docs: response can have multiple image parts — we use the last one
  it("uses the last image when response has multiple inlineData parts", async () => {
    _setClientForTesting(makeMockClientStatic({
      candidates: [{
        finishReason: "STOP",
        content: {
          parts: [
            { inlineData: { data: "first", mimeType: "image/png" } },
            { inlineData: { data: "second", mimeType: "image/jpeg" } },
          ],
        },
      }],
    }));

    const results = await generateImage("test");
    assert.equal(results[0].base64, "second");
    assert.equal(results[0].mimeType, "image/jpeg");
  });
});

// ===================================================================
// getModelName / getDescribeModelName
// ===================================================================

describe("model name exports", () => {
  it("getModelName returns a non-empty string", () => {
    const name = getModelName();
    assert.equal(typeof name, "string");
    assert(name.length > 0);
  });

  it("getDescribeModelName returns a non-empty string", () => {
    const name = getDescribeModelName();
    assert.equal(typeof name, "string");
    assert(name.length > 0);
  });

  it("image and describe models are different", () => {
    assert.notEqual(getModelName(), getDescribeModelName());
  });
});
