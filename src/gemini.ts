import {
  GoogleGenAI,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type ImageConfig,
  type Part,
} from "@google/genai";
import {
  GeminiError,
  PromptBlockedError,
  GenerationStoppedError,
  NoImageError,
} from "./errors.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-image-preview";
const DESCRIBE_MODEL = process.env.GEMINI_DESCRIBE_MODEL || "gemini-2.5-flash";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set");
    const baseUrl = process.env.GEMINI_BASE_URL;
    client = new GoogleGenAI({
      apiKey,
      ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
    });
  }
  return client;
}

export interface GenerateOptions {
  aspectRatio?: string;
  size?: string;
  negativePrompt?: string;
  systemInstruction?: string;
}

export interface ImageResult {
  base64: string;
  mimeType: string;
  text?: string;
}

function buildConfig(options?: GenerateOptions): GenerateContentConfig {
  const config: GenerateContentConfig = {
    responseModalities: ["TEXT", "IMAGE"],
  };

  if (options?.aspectRatio || options?.size) {
    const imageConfig: ImageConfig = {};
    if (options.aspectRatio) imageConfig.aspectRatio = options.aspectRatio;
    if (options.size) imageConfig.imageSize = options.size;
    config.imageConfig = imageConfig;
  }

  if (options?.systemInstruction) {
    config.systemInstruction = options.systemInstruction;
  }

  return config;
}

function applyNegativePrompt(prompt: string, negativePrompt?: string): string {
  if (!negativePrompt) return prompt;
  return `${prompt}\n\n[Do NOT include: ${negativePrompt}]`;
}

function getValidCandidateParts(response: GenerateContentResponse, errorMessage: string): Part[] {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    const detail = response.promptFeedback?.blockReasonMessage;
    throw new PromptBlockedError(blockReason, detail);
  }

  const candidates = response.candidates ?? [];
  if (candidates.length === 0) throw new GeminiError(errorMessage);

  for (const candidate of candidates) {
    const finishReason = candidate.finishReason;
    if (!finishReason || finishReason === "STOP") {
      return candidate.content?.parts ?? [];
    }
  }

  const reasons = candidates
    .map((c) => {
      const reason = c.finishReason;
      const detail = c.finishMessage;
      return detail ? `${reason} — ${detail}` : reason;
    })
    .filter((r): r is string => r !== undefined);
  throw new GenerationStoppedError(reasons);
}

function extractImageFromResponse(response: GenerateContentResponse): ImageResult {
  const parts = getValidCandidateParts(response, "No response from Gemini");

  let imageData: { base64: string; mimeType: string } | null = null;
  const textParts: string[] = [];

  for (const part of parts) {
    if (part.inlineData) {
      if (!part.inlineData.data) {
        throw new NoImageError("Gemini returned image data with missing base64 content");
      }
      if (!part.inlineData.mimeType) {
        throw new NoImageError("Gemini returned image data with missing MIME type");
      }
      imageData = {
        base64: part.inlineData.data,
        mimeType: part.inlineData.mimeType,
      };
    } else if (part.text) {
      textParts.push(part.text);
    }
  }

  if (!imageData) throw new NoImageError();

  return {
    ...imageData,
    text: textParts.length > 0 ? textParts.join("\n") : undefined,
  };
}

export async function generateImage(
  prompt: string,
  options?: GenerateOptions & { n?: number }
): Promise<ImageResult[]> {
  const ai = getClient();
  const count = options?.n ?? 1;
  const config = buildConfig(options);
  const text = applyNegativePrompt(prompt, options?.negativePrompt);

  const generate = async (): Promise<ImageResult> => {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text }] }],
      config,
    });
    return extractImageFromResponse(response);
  };

  return Promise.all(Array.from({ length: count }, () => generate()));
}

export async function editImage(
  prompt: string,
  images: Array<{ base64: string; mimeType: string }>,
  options?: GenerateOptions
): Promise<ImageResult> {
  const ai = getClient();
  const text = applyNegativePrompt(prompt, options?.negativePrompt);

  const imageParts = images.map((img) => ({
    inlineData: { data: img.base64, mimeType: img.mimeType },
  }));

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [...imageParts, { text }],
      },
    ],
    config: buildConfig(options),
  });

  return extractImageFromResponse(response);
}

export async function describeImage(
  imageBase64: string,
  mimeType: string,
  question?: string,
  systemInstruction?: string
): Promise<string> {
  const ai = getClient();

  const prompt = question || "Describe this image in detail.";

  const response = await ai.models.generateContent({
    model: DESCRIBE_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: imageBase64, mimeType } },
          { text: prompt },
        ],
      },
    ],
    ...(systemInstruction ? { config: { systemInstruction } } : {}),
  });

  const parts = getValidCandidateParts(response, "No description from Gemini");

  const text = parts
    .filter((part) => part.text)
    .map((part) => part.text as string)
    .join("\n");

  if (!text) throw new GeminiError("No description from Gemini");

  return text;
}

export function _setClientForTesting(mockClient: GoogleGenAI): void {
  client = mockClient;
}

export function getModelName(): string {
  return MODEL;
}

export function getDescribeModelName(): string {
  return DESCRIBE_MODEL;
}
