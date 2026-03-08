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
  PromptBlockedError,
  GenerationStoppedError,
  NoImageError,
} from "../errors.js";

const FAKE_BASE64 = Buffer.from("fake-image-data").toString("base64");

function makeMockClient(response: unknown): GoogleGenAI {
  return {
    models: {
      generateContent: async () => response,
    },
  } as unknown as GoogleGenAI;
}

function makeImageResponse(base64 = FAKE_BASE64, mimeType = "image/png", text?: string) {
  const parts: unknown[] = [{ inlineData: { data: base64, mimeType } }];
  if (text) parts.push({ text });
  return {
    candidates: [{ finishReason: "STOP", content: { parts } }],
  };
}

function makeTextResponse(text: string) {
  return {
    candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
  };
}

describe("generateImage", () => {
  beforeEach(() => {
    _setClientForTesting(makeMockClient(makeImageResponse()));
  });

  it("returns single image by default", async () => {
    const results = await generateImage("a cat");
    assert.equal(results.length, 1);
    assert.equal(results[0].base64, FAKE_BASE64);
    assert.equal(results[0].mimeType, "image/png");
  });

  it("returns n images in batch", async () => {
    const results = await generateImage("a cat", { n: 3 });
    assert.equal(results.length, 3);
    for (const r of results) {
      assert.equal(r.base64, FAKE_BASE64);
    }
  });

  it("includes text when present", async () => {
    _setClientForTesting(makeMockClient(makeImageResponse(FAKE_BASE64, "image/png", "Here is your cat")));
    const results = await generateImage("a cat");
    assert.equal(results[0].text, "Here is your cat");
  });

  it("applies negative prompt to text", async () => {
    let capturedContents: unknown = null;
    const mock = {
      models: {
        generateContent: async (req: { contents: unknown }) => {
          capturedContents = req.contents;
          return makeImageResponse();
        },
      },
    } as unknown as GoogleGenAI;
    _setClientForTesting(mock);

    await generateImage("a cat", { negativePrompt: "dogs" });
    const parts = (capturedContents as Array<{ parts: Array<{ text: string }> }>)[0].parts;
    assert.match(parts[0].text, /\[Do NOT include: dogs\]/);
  });

  it("passes systemInstruction in config", async () => {
    let capturedConfig: unknown = null;
    const mock = {
      models: {
        generateContent: async (req: { config: unknown }) => {
          capturedConfig = req.config;
          return makeImageResponse();
        },
      },
    } as unknown as GoogleGenAI;
    _setClientForTesting(mock);

    await generateImage("a cat", { systemInstruction: "Be creative" });
    assert.equal((capturedConfig as { systemInstruction: string }).systemInstruction, "Be creative");
  });
});

describe("editImage", () => {
  beforeEach(() => {
    _setClientForTesting(makeMockClient(makeImageResponse()));
  });

  it("sends multiple images", async () => {
    let capturedParts: unknown[] = [];
    const mock = {
      models: {
        generateContent: async (req: { contents: Array<{ parts: unknown[] }> }) => {
          capturedParts = req.contents[0].parts;
          return makeImageResponse();
        },
      },
    } as unknown as GoogleGenAI;
    _setClientForTesting(mock);

    const images = [
      { base64: "img1", mimeType: "image/png" },
      { base64: "img2", mimeType: "image/jpeg" },
    ];
    await editImage("combine these", images);
    // 2 image parts + 1 text part
    assert.equal(capturedParts.length, 3);
  });

  it("returns image result", async () => {
    const result = await editImage("fix it", [{ base64: "img1", mimeType: "image/png" }]);
    assert.equal(result.base64, FAKE_BASE64);
    assert.equal(result.mimeType, "image/png");
  });
});

describe("describeImage", () => {
  it("returns text description", async () => {
    _setClientForTesting(makeMockClient(makeTextResponse("A beautiful landscape")));
    const result = await describeImage("base64data", "image/png");
    assert.equal(result, "A beautiful landscape");
  });

  it("passes systemInstruction when provided", async () => {
    let capturedConfig: unknown = null;
    const mock = {
      models: {
        generateContent: async (req: { config?: unknown }) => {
          capturedConfig = req.config;
          return makeTextResponse("desc");
        },
      },
    } as unknown as GoogleGenAI;
    _setClientForTesting(mock);

    await describeImage("base64data", "image/png", undefined, "Be concise");
    assert.equal((capturedConfig as { systemInstruction: string }).systemInstruction, "Be concise");
  });
});

describe("error handling", () => {
  it("throws PromptBlockedError on blocked prompt", async () => {
    _setClientForTesting(makeMockClient({
      promptFeedback: { blockReason: "SAFETY", blockReasonMessage: "unsafe" },
    }));
    await assert.rejects(() => generateImage("bad prompt"), (err: unknown) => {
      assert(err instanceof PromptBlockedError);
      assert.equal(err.blockReason, "SAFETY");
      return true;
    });
  });

  it("throws GenerationStoppedError on non-STOP finish", async () => {
    _setClientForTesting(makeMockClient({
      candidates: [{ finishReason: "MAX_TOKENS" }],
    }));
    await assert.rejects(() => generateImage("test"), (err: unknown) => {
      assert(err instanceof GenerationStoppedError);
      assert.deepEqual(err.reasons, ["MAX_TOKENS"]);
      return true;
    });
  });

  it("throws NoImageError when no image in response", async () => {
    _setClientForTesting(makeMockClient(makeTextResponse("just text")));
    await assert.rejects(() => generateImage("test"), (err: unknown) => {
      assert(err instanceof NoImageError);
      return true;
    });
  });
});

describe("getModelName / getDescribeModelName", () => {
  it("returns model strings", () => {
    assert.equal(typeof getModelName(), "string");
    assert.equal(typeof getDescribeModelName(), "string");
    assert(getModelName().length > 0);
    assert(getDescribeModelName().length > 0);
  });
});
