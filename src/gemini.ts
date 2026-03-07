import {
  GoogleGenAI,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type ImageConfig,
  type Part,
} from "@google/genai";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-image";
const DESCRIBE_MODEL = process.env.GEMINI_DESCRIBE_MODEL || "gemini-2.5-flash";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export interface GenerateOptions {
  aspectRatio?: string;
  size?: string;
}

interface ImageResult {
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

  return config;
}

function getValidCandidateParts(response: GenerateContentResponse, errorMessage: string): Part[] {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    const detail = response.promptFeedback?.blockReasonMessage;
    throw new Error(
      `Gemini blocked the prompt: ${blockReason}${detail ? ` — ${detail}` : ""}`
    );
  }

  const candidates = response.candidates ?? [];
  if (candidates.length === 0) throw new Error(errorMessage);

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
    .join("; ");
  throw new Error(`Gemini stopped generating: ${reasons}`);
}

function extractImageFromResponse(response: GenerateContentResponse): ImageResult {
  const parts = getValidCandidateParts(response, "No response from Gemini");

  let imageData: { base64: string; mimeType: string } | null = null;
  const textParts: string[] = [];

  for (const part of parts) {
    if (part.inlineData) {
      if (!part.inlineData.data) {
        throw new Error("Gemini returned image data with missing base64 content");
      }
      if (!part.inlineData.mimeType) {
        throw new Error("Gemini returned image data with missing MIME type");
      }
      imageData = {
        base64: part.inlineData.data,
        mimeType: part.inlineData.mimeType,
      };
    } else if (part.text) {
      textParts.push(part.text);
    }
  }

  if (!imageData) throw new Error("No image in Gemini response");

  return {
    ...imageData,
    text: textParts.length > 0 ? textParts.join("\n") : undefined,
  };
}

export async function generateImage(
  prompt: string,
  options?: GenerateOptions
): Promise<ImageResult> {
  const ai = getClient();

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: buildConfig(options),
  });

  return extractImageFromResponse(response);
}

export async function editImage(
  prompt: string,
  imageBase64: string,
  mimeType: string,
  options?: GenerateOptions
): Promise<ImageResult> {
  const ai = getClient();

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: imageBase64, mimeType } },
          { text: prompt },
        ],
      },
    ],
    config: buildConfig(options),
  });

  return extractImageFromResponse(response);
}

export async function describeImage(
  imageBase64: string,
  mimeType: string,
  question?: string
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
  });

  const parts = getValidCandidateParts(response, "No description from Gemini");

  const text = parts
    .filter((part) => part.text)
    .map((part) => part.text as string)
    .join("\n");

  if (!text) throw new Error("No description from Gemini");

  return text;
}
