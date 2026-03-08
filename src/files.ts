import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, extname, basename, sep } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import sharp from "sharp";
import { AccessDeniedError, ImageNotFoundError } from "./errors.js";

const OUTPUT_DIR = process.env.OUTPUT_DIR || resolve(homedir(), "nano-banana-output");

export function getOutputDir(): string {
  return OUTPUT_DIR;
}

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".svg": "image/svg+xml",
};

const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",
};

function generateFilename(prompt: string, ext: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const timestamp = Date.now();
  return `${slug}-${timestamp}.${ext}`;
}

export async function saveImage(
  base64: string,
  mimeType: string,
  prompt: string
): Promise<string> {
  const ext = EXT_MAP[mimeType] || "png";
  const filename = generateFilename(prompt, ext);
  const dir = resolve(OUTPUT_DIR);
  await mkdir(dir, { recursive: true });
  const filePath = resolve(dir, filename);
  await writeFile(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

export async function readImageAsBase64(
  filePath: string
): Promise<{ base64: string; mimeType: string }> {
  const resolved = resolveImagePath(filePath);
  const buffer = await readFile(resolved);
  const ext = extname(resolved).toLowerCase();
  const mimeType = MIME_MAP[ext] || "application/octet-stream";
  return { base64: buffer.toString("base64"), mimeType };
}

function assertPathAllowed(resolvedPath: string): void {
  const canonical = realpathSync(resolvedPath);

  const allowedDirs: string[] = [];

  try {
    allowedDirs.push(realpathSync(process.cwd()));
  } catch {
    // cwd may not be resolvable in rare cases
  }

  try {
    allowedDirs.push(realpathSync(resolve(OUTPUT_DIR)));
  } catch {
    // OUTPUT_DIR may not exist yet
  }

  const isAllowed = allowedDirs.some(
    (dir) => canonical === dir || canonical.startsWith(dir + sep)
  );

  if (!isAllowed) {
    throw new AccessDeniedError(resolvedPath, allowedDirs);
  }
}

function resolveImagePath(filePath: string): string {
  // Try absolute path first
  if (existsSync(filePath)) {
    const resolved = resolve(filePath);
    assertPathAllowed(resolved);
    return resolved;
  }

  // Try relative to cwd
  const fromCwd = resolve(process.cwd(), filePath);
  if (existsSync(fromCwd)) {
    assertPathAllowed(fromCwd);
    return fromCwd;
  }

  // Try relative to output dir
  const fromOutput = resolve(OUTPUT_DIR, filePath);
  if (existsSync(fromOutput)) {
    assertPathAllowed(fromOutput);
    return fromOutput;
  }

  // Try just the basename in output dir
  const fromOutputBase = resolve(OUTPUT_DIR, basename(filePath));
  if (existsSync(fromOutputBase)) {
    assertPathAllowed(fromOutputBase);
    return fromOutputBase;
  }

  const triedPaths = [
    filePath,
    resolve(process.cwd(), filePath),
    resolve(OUTPUT_DIR, filePath),
    resolve(OUTPUT_DIR, basename(filePath)),
  ];
  throw new ImageNotFoundError(filePath, triedPaths);
}

const THUMBNAIL_MAX_SIZE = 512;
const THUMBNAIL_QUALITY = 80;

export async function createThumbnail(
  base64: string,
  mimeType: string
): Promise<{ base64: string; mimeType: "image/jpeg" }> {
  const input = Buffer.from(base64, "base64");
  const output = await sharp(input)
    .resize(THUMBNAIL_MAX_SIZE, THUMBNAIL_MAX_SIZE, { fit: "inside" })
    .jpeg({ quality: THUMBNAIL_QUALITY })
    .toBuffer();
  return { base64: output.toString("base64"), mimeType: "image/jpeg" };
}
