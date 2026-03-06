# nano-banana-mcp

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
        "GEMINI_API_KEY": "your-api-key",
        "GEMINI_MODEL": "gemini-2.5-flash-image"
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
| `GEMINI_MODEL` | No | `gemini-2.5-flash-image` | Gemini model for image generation/editing |
| `GEMINI_DESCRIBE_MODEL` | No | `gemini-2.5-flash` | Gemini model for image description (text-only output) |
| `OUTPUT_DIR` | No | `~/nano-banana-output` | Directory for saved images |

### Supported Models

| Model | Notes |
|-------|-------|
| `gemini-2.5-flash-image` | Default. Fast, cost-effective |
| `gemini-3-pro-image-preview` | Higher quality, slower |
| `gemini-3.1-flash-image-preview` | Latest, fastest |

## Tools

### `generate_image`

Generate an image from a text prompt.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Text description of the image |
| `aspectRatio` | string | No | Aspect ratio (e.g. `16:9`, `1:1`, `4:3`) |
| `size` | string | No | Image size (`512`, `1K`, `2K`, `4K`) |

### `edit_image`

Edit an existing image based on a text instruction.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | What to change |
| `filePath` | string | Yes | Path to the source image |
| `aspectRatio` | string | No | Aspect ratio (e.g. `16:9`, `1:1`, `4:3`) |
| `size` | string | No | Image size (`512`, `1K`, `2K`, `4K`) |

### `describe_image`

Get a text description of an image.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | string | Yes | Path to the image |
| `question` | string | No | Specific question about the image |

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

## License

MIT
