# AI & Terminal Chatbot

Electron + React desktop app combining a streaming AI chat interface with a multi-tab command terminal.

## Requirements

- Node.js 18+
- npm
- [Ollama](https://ollama.com) running locally

```bash
ollama pull hf.co/mradermacher/mistral-7b-uncensored-GGUF:Q5_K_M
ollama pull hf.co/MaziyarPanahi/Qwen2.5-7B-Instruct-Uncensored-GGUF:Q5_K_M
ollama pull hf.co/second-state/Deepseek-Coder-6.7B-Instruct-GGUF:Q5_K_M
```

## Running in Development

**Terminal 1 — renderer**
```bash
npm install
npm start
```

## Build

```bash
npm run dist
```

Produces a Windows NSIS installer. For Linux, add to `package.json`:

```json
"linux": { "target": ["AppImage"], "category": "Utility" }
```

Then: `npm run build && electron-builder --linux`

> `node-pty` is a native addon — rebuild on the target platform with `npx electron-rebuild`.

## Configuration

Edit `config/settings.json`:

```json
{
  "model": "mistral",
  "timeout": 30000,
  "max_output": 65536
}
```

Also editable from the Settings modal inside the app.
