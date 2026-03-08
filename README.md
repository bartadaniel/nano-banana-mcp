# nano-banana-mcp

[![npm](https://img.shields.io/npm/v/@daniel.barta/nano-banana-mcp)](https://www.npmjs.com/package/@daniel.barta/nano-banana-mcp)

Standalone MCP server for generating and editing images with Google Gemini. No Gemini CLI required -- just an API key.

## Quick Start

1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

2. Add to your Claude Code settings (`~/.claude/settings.json`) or Claude Desktop config:

```json
{
  "mcpServers": {
    "nano-banana": {
      "command": "npx",
      "args": ["-y", "@daniel.barta/nano-banana-mcp"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

3. Restart Claude and ask it to generate an image.

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `GEMINI_API_KEY` | Yes | -- | Your Google AI API key |
| `GEMINI_MODEL` | No | `gemini-3.1-flash-image-preview` | Gemini model for image generation/editing |
| `GEMINI_DESCRIBE_MODEL` | No | `gemini-2.5-flash` | Gemini model for image description (text-only output) |
| `GEMINI_BASE_URL` | No | -- | Custom base URL for Gemini API (proxy support) |
| `OUTPUT_DIR` | No | `~/nano-banana-output` | Directory for saved images |

### Supported Models

| Model | Notes |
|-------|-------|
| `gemini-3.1-flash-image-preview` | Default. Latest, fastest |
| `gemini-3-pro-image-preview` | Higher quality, slower |
| `gemini-2.5-flash-image` | Fast, cost-effective |

## Tools

### `generate_image`

Generate an image from a text prompt. Supports batch generation (up to 4 images). Response contains a thumbnail preview; full-res image is saved to disk.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Text description of the image |
| `aspectRatio` | string | No | Aspect ratio (`1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`) |
| `size` | string | No | Image size (`512px`, `1K`, `2K`, `4K`) |
| `n` | number | No | Number of images to generate (1-4, default 1) |
| `negativePrompt` | string | No | Things to exclude from the generated image |
| `systemInstruction` | string | No | System instruction to guide the model |

### `edit_image`

Edit an existing image based on a text instruction. Supports multi-image input (up to 3 images total). Response contains a thumbnail preview; full-res image is saved to disk.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | What to change |
| `filePath` | string | Yes | Path to the source image |
| `additionalFilePaths` | string[] | No | Additional image paths (up to 2) for multi-image editing |
| `aspectRatio` | string | No | Aspect ratio (`1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`) |
| `size` | string | No | Image size (`512px`, `1K`, `2K`, `4K`) |
| `negativePrompt` | string | No | Things to exclude from the edited image |
| `systemInstruction` | string | No | System instruction to guide the model |

### `describe_image`

Get a text description of an image.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | string | Yes | Path to the image |
| `question` | string | No | Specific question about the image |
| `systemInstruction` | string | No | System instruction to guide the model |

## Thumbnails

To avoid hitting Claude Code's session file size limits, MCP responses contain **thumbnail previews** (max 512px, JPEG quality 80, ~20-50KB) instead of full-resolution images. Full-res images are always saved to disk at the path shown in the response metadata.

The first content block in generate/edit responses is a JSON metadata object:
```json
{
  "model": "gemini-3.1-flash-image-preview",
  "count": 1,
  "images": [
    { "filePath": "/Users/you/nano-banana-output/a-cat-1234567890.png", "mimeType": "image/png" }
  ]
}
```

## Development

```bash
git clone https://github.com/bartadaniel/nano-banana-mcp.git
cd nano-banana-mcp
npm install
npm run build
```

Use the local build in your config:

```json
{
  "mcpServers": {
    "nano-banana": {
      "command": "node",
      "args": ["path/to/nano-banana-mcp/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Testing

```bash
npm test
```

Runs 27 unit tests using Node.js built-in test runner (`node:test`). Tests cover error classes, Gemini API interactions (mocked), and file operations (real filesystem).

## License

MIT
