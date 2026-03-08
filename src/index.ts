#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateImage, editImage, describeImage, getModelName, getDescribeModelName } from "./gemini.js";
import { saveImage, readImageAsBase64, createThumbnail, getOutputDir } from "./files.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

if (!process.env.GEMINI_API_KEY) {
  console.error("Error: GEMINI_API_KEY environment variable is required");
  process.exit(1);
}

const server = new McpServer({
  name: "nano-banana",
  version,
});

const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
const SIZES = ["512px", "1K", "2K", "4K"] as const;

server.registerTool(
  "generate_image",
  {
    description: `Generate an image from a text prompt using Google Gemini. Default model: ${getModelName()}. Supports batch generation (n=1-4). Response contains a thumbnail preview; full-res image is saved to ${getOutputDir()}.`,
    inputSchema: {
      prompt: z.string().describe("Text description of the image to generate"),
      aspectRatio: z
        .enum(ASPECT_RATIOS)
        .optional()
        .describe("Aspect ratio of the generated image"),
      size: z
        .enum(SIZES)
        .optional()
        .describe("Image size (512, 1K, 2K, 4K)"),
      n: z
        .number()
        .int()
        .min(1)
        .max(4)
        .optional()
        .describe("Number of images to generate (1-4, default 1)"),
      negativePrompt: z
        .string()
        .optional()
        .describe("Things to exclude from the generated image"),
      systemInstruction: z
        .string()
        .optional()
        .describe("System instruction to guide the model's behavior"),
    },
  },
  async ({ prompt, aspectRatio, size, n, negativePrompt, systemInstruction }) => {
    const results = await generateImage(prompt, { aspectRatio, size, n, negativePrompt, systemInstruction });

    type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
    const content: ContentBlock[] = [];
    const imagesMeta: { filePath: string; mimeType: string }[] = [];

    for (const result of results) {
      const filePath = await saveImage(result.base64, result.mimeType, prompt);
      const thumbnail = await createThumbnail(result.base64, result.mimeType);
      imagesMeta.push({ filePath, mimeType: result.mimeType });

      if (result.text) {
        content.push({ type: "text", text: result.text });
      }
      content.push({ type: "image", data: thumbnail.base64, mimeType: thumbnail.mimeType });
    }

    const metadata = { model: getModelName(), count: results.length, images: imagesMeta };
    content.unshift({ type: "text", text: JSON.stringify(metadata) });

    return { content };
  }
);

server.registerTool(
  "edit_image",
  {
    description: `Edit an existing image based on a text instruction using Google Gemini. Default model: ${getModelName()}. Supports multi-image input (up to 3 total). Response contains a thumbnail preview; full-res image is saved to ${getOutputDir()}.`,
    inputSchema: {
      prompt: z.string().describe("What to change in the image"),
      filePath: z.string().describe("Path to the source image"),
      additionalFilePaths: z
        .array(z.string())
        .max(2)
        .optional()
        .describe("Additional image paths for multi-image editing (up to 2)"),
      aspectRatio: z
        .enum(ASPECT_RATIOS)
        .optional()
        .describe("Aspect ratio of the output image"),
      size: z
        .enum(SIZES)
        .optional()
        .describe("Image size (512, 1K, 2K, 4K)"),
      negativePrompt: z
        .string()
        .optional()
        .describe("Things to exclude from the edited image"),
      systemInstruction: z
        .string()
        .optional()
        .describe("System instruction to guide the model's behavior"),
    },
  },
  async ({ prompt, filePath, additionalFilePaths, aspectRatio, size, negativePrompt, systemInstruction }) => {
    const primary = await readImageAsBase64(filePath);
    const images = [{ base64: primary.base64, mimeType: primary.mimeType }];

    if (additionalFilePaths) {
      for (const p of additionalFilePaths) {
        const img = await readImageAsBase64(p);
        images.push({ base64: img.base64, mimeType: img.mimeType });
      }
    }

    const result = await editImage(prompt, images, { aspectRatio, size, negativePrompt, systemInstruction });
    const savedPath = await saveImage(result.base64, result.mimeType, prompt);
    const thumbnail = await createThumbnail(result.base64, result.mimeType);

    type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
    const metadata = { model: getModelName(), count: 1, images: [{ filePath: savedPath, mimeType: result.mimeType }] };
    const content: ContentBlock[] = [
      { type: "text", text: JSON.stringify(metadata) },
    ];
    if (result.text) {
      content.push({ type: "text", text: result.text });
    }
    content.push({ type: "image", data: thumbnail.base64, mimeType: thumbnail.mimeType });

    return { content };
  }
);

server.registerTool(
  "describe_image",
  {
    description: `Get a text description of an image using Google Gemini. Default model: ${getDescribeModelName()}.`,
    inputSchema: {
      filePath: z.string().describe("Path to the image"),
      question: z
        .string()
        .optional()
        .describe("Specific question about the image"),
      systemInstruction: z
        .string()
        .optional()
        .describe("System instruction to guide the model's behavior"),
    },
  },
  async ({ filePath, question, systemInstruction }) => {
    const { base64, mimeType } = await readImageAsBase64(filePath);
    const description = await describeImage(base64, mimeType, question, systemInstruction);

    return {
      content: [{ type: "text" as const, text: description }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
