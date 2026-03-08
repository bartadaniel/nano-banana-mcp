#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateImage, editImage, describeImage } from "./gemini.js";
import { saveImage, readImageAsBase64, createThumbnail } from "./files.js";

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

const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] as const;
const SIZES = ["512", "1K", "2K", "4K"] as const;

server.registerTool(
  "generate_image",
  {
    description: "Generate an image from a text prompt using Google Gemini",
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
    },
  },
  async ({ prompt, aspectRatio, size }) => {
    const result = await generateImage(prompt, { aspectRatio, size });
    const filePath = await saveImage(result.base64, result.mimeType, prompt);
    const thumbnail = await createThumbnail(result.base64, result.mimeType);

    const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
      { type: "text", text: `Image saved to: ${filePath}` },
    ];
    if (result.text) {
      content.push({ type: "text", text: result.text });
    }
    content.push({ type: "image", data: thumbnail.base64, mimeType: thumbnail.mimeType });

    return { content };
  }
);

server.registerTool(
  "edit_image",
  {
    description: "Edit an existing image based on a text instruction using Google Gemini",
    inputSchema: {
      prompt: z.string().describe("What to change in the image"),
      filePath: z.string().describe("Path to the source image"),
      aspectRatio: z
        .enum(ASPECT_RATIOS)
        .optional()
        .describe("Aspect ratio of the output image"),
      size: z
        .enum(SIZES)
        .optional()
        .describe("Image size (512, 1K, 2K, 4K)"),
    },
  },
  async ({ prompt, filePath, aspectRatio, size }) => {
    const { base64: inputBase64, mimeType: inputMime } =
      await readImageAsBase64(filePath);
    const result = await editImage(prompt, inputBase64, inputMime, { aspectRatio, size });
    const savedPath = await saveImage(result.base64, result.mimeType, prompt);
    const thumbnail = await createThumbnail(result.base64, result.mimeType);

    const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
      { type: "text", text: `Edited image saved to: ${savedPath}` },
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
    description: "Get a text description of an image using Google Gemini",
    inputSchema: {
      filePath: z.string().describe("Path to the image"),
      question: z
        .string()
        .optional()
        .describe("Specific question about the image"),
    },
  },
  async ({ filePath, question }) => {
    const { base64, mimeType } = await readImageAsBase64(filePath);
    const description = await describeImage(base64, mimeType, question);

    return {
      content: [{ type: "text" as const, text: description }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
