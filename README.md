# AI Research Assistant

A self-hosted, all-in-one AI workspace built with Node.js and Express. It combines web-grounded deep research, a conversational chat, code generation, structured debates, essay and letter writing, voice conversations, and file/document analysis (with OCR) into a single web UI.

The app is provider-agnostic: it works with **OpenAI**, **OpenRouter**, or a **fully local Ollama** instance, and automatically falls back between providers. An **Offline Mode** locks everything to local Ollama so no data leaves your machine.

## Features

- **Deep Research** – Web search (via Serper) + page fetching and extraction, synthesized by the LLM into an evidence-based brief with inline citations `[n]`, confidence levels, and LaTeX math rendering. Detail levels: Brief / Standard / Deep, with 1–8 sources.
- **AI Chat** – Multi-turn chat with a reasoning-focused system prompt.
- **Code Generation** – Generates complete, runnable code for a target language/framework/style.
- **Debate Generator** – Structured debates in Pro/Con, multi-perspective, or formal formats with adjustable depth.
- **Essay & Letter Writer** – Argumentative, expository, narrative, descriptive, compare/contrast, cause/effect essays plus formal/informal letters; configurable word count, academic level, and tone.
- **Voice AI** – Realtime voice conversation via OpenAI's Realtime API (WebRTC) or a text-based voice assistant endpoint.
- **File Analysis** – Upload a file (up to 10 MB) and get a summary, detailed analysis, step-by-step question solving, or run a custom instruction on it. Images are handled through OCR (e.g. OCR.Space), so screenshots of questions can be solved.
- **Notes** – Simple local notes store that recent notes get injected into research prompts as extra context.
- **Offline Mode** – Toggle at runtime; forces local-only Ollama and disables web search, OCR, and realtime.

## Tech Stack

- **Backend:** Node.js, Express, Multer, Undici, Cheerio
- **Frontend:** Vanilla HTML/CSS/JS with MathJax, PWA-ready (service worker included)
- **LLM Providers:** OpenAI, OpenRouter, Ollama (local)

## Getting Started

### Prerequisites

- Node.js 18+
- At least one LLM provider:
  - An [OpenAI](https://platform.openai.com/) API key, or
  - An [OpenRouter](https://openrouter.ai/) API key, or
  - A local [Ollama](https://ollama.com/) instance

### Installation

```bash
git clone https://github.com/gamer-09/reseacrchai-assistant.git
cd reseacrchai-assistant
npm install
```

### Configuration

Copy `.env.example` to `.env` and fill in what you have:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PORT` | Server port (default `3009`) |
| `LLM_PROVIDER` | Optional. Force `openai`, `openrouter`, or `ollama`. Auto-detected if unset. |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | OpenAI model (default `gpt-4o-mini`) |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OPENROUTER_MODEL` | OpenRouter model (default `openai/gpt-4o-mini`) |
| `OLLAMA_BASE_URL` | Local Ollama URL (default `http://localhost:11434`) |
| `OLLAMA_MODEL` | Ollama model (default `llama3.1`) |
| `SERPER_API_KEY` | Serper API key for web search (optional but recommended for research) |
| `OCR_SPACE_API_KEY` | OCR.Space key for image OCR (optional) |
| `OFFLINE_MODE` | Set `true` to start in Offline Mode (local Ollama only) |

### Running

```bash
npm start        # production
npm run dev      # with nodemon hot-reload
```

Then open **http://localhost:3009**.

## Project Structure

```
├── public/              # Frontend pages (research, chat, code, debate, essay, voice)
├── src/
│   ├── ai/
│   │   ├── llmClient.js # Provider-agnostic LLM client with automatic fallback
│   │   ├── search.js    # Web search via Serper
│   │   ├── fetchPage.js # Page fetching + text extraction
│   │   ├── ocr.js       # OCR for uploaded images
│   │   └── notesStore.js# Simple notes persistence
│   ├── config/
│   │   └── runtimeConfig.js # Runtime offline-mode toggle
│   └── server.js        # Express app + all API routes
└── data/                # Notes storage (created at runtime)
```

## API Overview

| Endpoint | Method | Description |
|---|---|---|
| `/api/research` | POST | Web-grounded research with citations |
| `/api/chat` | POST | Chat completions with auto-fallback |
| `/api/codegen` | POST | Code generation |
| `/api/debate` | POST | Structured debate generation |
| `/api/essay` | POST | Essay/letter generation |
| `/api/voice` | POST | Voice assistant (text) |
| `/api/realtime/offer` | POST | OpenAI Realtime WebRTC SDP exchange |
| `/api/file-analyze` | POST | File upload analysis (multipart) |
| `/api/notes` | GET/POST | List/add notes |
| `/api/providers` | GET | Detect configured providers |
| `/api/offline` | GET/POST | Get/set offline mode |
| `/healthz` | GET | Health check |

## License

MIT
