// --- Gemini API errors ---

export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiError";
  }
}

export class PromptBlockedError extends GeminiError {
  blockReason: string;
  blockReasonMessage?: string;

  constructor(blockReason: string, blockReasonMessage?: string) {
    const msg = `Gemini blocked the prompt: ${blockReason}${blockReasonMessage ? ` — ${blockReasonMessage}` : ""}`;
    super(msg);
    this.name = "PromptBlockedError";
    this.blockReason = blockReason;
    this.blockReasonMessage = blockReasonMessage;
  }
}

export class GenerationStoppedError extends GeminiError {
  reasons: string[];

  constructor(reasons: string[]) {
    super(`Gemini stopped generating: ${reasons.join("; ")}`);
    this.name = "GenerationStoppedError";
    this.reasons = reasons;
  }
}

export class NoImageError extends GeminiError {
  constructor(message = "No image in Gemini response") {
    super(message);
    this.name = "NoImageError";
  }
}

// --- File system errors ---

export class FileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileError";
  }
}

export class ImageNotFoundError extends FileError {
  filePath: string;
  triedPaths: string[];

  constructor(filePath: string, triedPaths: string[]) {
    super(`Image not found: ${filePath} (tried ${triedPaths.join(", ")})`);
    this.name = "ImageNotFoundError";
    this.filePath = filePath;
    this.triedPaths = triedPaths;
  }
}

export class AccessDeniedError extends FileError {
  filePath: string;
  allowedDirs: string[];

  constructor(filePath: string, allowedDirs: string[]) {
    super(`Access denied: ${filePath} is outside allowed directories (${allowedDirs.join(", ")})`);
    this.name = "AccessDeniedError";
    this.filePath = filePath;
    this.allowedDirs = allowedDirs;
  }
}
