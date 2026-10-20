# Mozhi (மொழி) — Local-First Prompt Enhancer

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![WXT](https://img.shields.io/badge/Built_with-WXT-purple.svg)](https://wxt.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)

**Mozhi** improves your prompts before you send them to an AI platform. Rooted in the Tamil concept of language and clear expression (*mozhi* / **மொழி**), it provides a fast, minimal, local-first workflow for turning rough thoughts into structured, effective prompts—while keeping you in complete control of where your text is processed.

---

## Key Features

- **Local-First Privacy**: Run spelling and grammar correction entirely inside your browser using an in-browser Small Language Model (SLM) via WebGPU/WASM. No prompts leave your machine in local mode.
- **BYOK Online Provider**: Bring Your Own Key for any OpenAI-compatible HTTPS endpoint (OpenAI, OpenRouter, Groq, local proxy, etc.) for deeper prompt architecture.
- **No Silent Fallback**: Mozhi **never** silently sends local prompts to a remote API if local execution fails.
- **Surface-Level to Deep Architecture**: Four tailored enhancement modes suited for everything from typo fixes to domain-specific prompt engineering.
- **Safe ChatGPT Integration**: Insert enhanced prompts directly into the active ChatGPT prompt area without auto-submitting.
- **Draft Persistence**: Unsent drafts and enhancement results survive popup dismissal via browser profile storage.
- **Sanitized Diagnostics**: Inspect, copy, and export API error logs with automated scrubbing of API keys, bearer tokens, and credentials.

---

## Enhancement Modes

Mozhi provides four enhancement modes. Local SLM and Online BYOK handle different levels of complexity:

| Mode | Target Runtime | Max Input Length | Purpose & Behavior |
| :--- | :--- | :--- | :--- |
| **Typo & Grammar Fix** (`typo`) | **Local SLM** & **Online BYOK** | 300 chars (Local)<br>20,000 chars (Online) | Surface-level fixes only (spelling, capitalization, punctuation, grammar). Preserves exact wording, voice, code snippets, URLs, and technical identifiers. Returns clean text unchanged. |
| **Light** (`light`) | **Online BYOK only** | 20,000 chars | Clarity improvements and smoother phrasing with minimal edits. Keeps original length, structure, and natural voice. |
| **Balanced** (`balanced`) | **Online BYOK only** | 20,000 chars | Makes requests clear and actionable. Organizes objectives, adds concise formatting constraints, and uses placeholders for missing info. |
| **Advanced** (`advanced`) | **Online BYOK only** | 20,000 chars | Full prompt architecture. Constructs modular blocks (Role, Task, Context, Steps, Output Format, Constraints) tailored to coding, writing, research, or analysis. |

---

## Architecture & Privacy Model

Mozhi is designed to guarantee user consent and transparency:

```
                  ┌──────────────────────────────────────────────┐
                  │                 Mozhi Popup                  │
                  │        (User enters or edits prompt)         │
                  └──────────────────────┬───────────────────────┘
                                         │
                        Selected Mode & Provider?
                         /                      \
        [Local Provider]                         [Online BYOK Provider]
               │                                            │
    Mode === 'typo'?                                  Valid HTTPS URL
     Input <= 300 chars?                               & API Key?
      /              \                                      │
    (Yes)            (No: User Error)                       ▼
      │                                       POST /chat/completions
      ▼                                       (Sends prompt to user's
┌─────────────────────────────────┐           custom remote endpoint)
│       In-Browser Worker         │
│   (Transformers.js / ONNX)      │
│  - WebGPU (Primary)             │
│  - WASM CPU (Fallback)          │
│  Prompts stay 100% on-device    │
└─────────────────────────────────┘
```

### Extension Permissions
Mozhi requests minimal Chrome permissions:
- `storage`: Preserves settings, API keys, and unsent popup drafts across sessions.
- `activeTab`: Injects enhanced prompt text only when the user explicitly clicks **Insert into ChatGPT**.
- `scripting`: Executes the insertion helper in the active ChatGPT tab.
- **Optional Host Permissions**:
  - `https://huggingface.co/*`, `https://*.huggingface.co/*`, `https://*.hf.co/*`: Requested only when you choose to download the local model.
  - `https://*/*`: Requested only when configuring a custom remote HTTPS endpoint for Online BYOK.

### Local Model Storage & Execution
- **Model**: Pinned to [`onnx-community/SmolLM2-360M-Instruct-ONNX`](https://huggingface.co/onnx-community/SmolLM2-360M-Instruct-ONNX) (Apache 2.0).
- **Download**: The model is **never** bundled with the extension. It is downloaded on-demand from Hugging Face (~272 MB for WebGPU, ~386 MB for WASM) into the browser profile's Cache Storage (`mozhi-local-model-cache`) after you click **Download model** in Settings.
- **Offline**: Once downloaded, local prompt correction functions completely offline.
- **Storage Wipe**: Clicking **Clear saved data** in Settings removes the model cache, preferences, and saved draft session.

### Storage Security Notice
> [!NOTE]
> Like all standard browser extensions, settings, prompt drafts, and online API keys are stored in `chrome.storage.local`. Chrome **does not encrypt** this storage on disk. Anyone with direct administrative access to your operating system account or browser profile folder can inspect stored values. If you are on a shared or untrusted workstation, use the **Remove API Key** or **Clear saved data** actions in Settings before leaving.

---

## Getting Started (Development)

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or later recommended)
- `npm` (v9 or later)
- Google Chrome or a Chromium-based browser (Brave, Edge)

### 1. Clone the repository
```sh
git clone https://github.com/JeevaVenkidu/mozhi.git
cd mozhi
```

### 2. Install dependencies
```sh
npm install
```

### 3. Run in development mode
```sh
npm run dev
```
WXT will spin up a development build with hot module reloading (HMR) and automatically launch a test Chrome instance.

### 4. Build for production and load in Chrome
To build the extension bundle manually:
```sh
npm run build
```

To load into Chrome:
1. Open Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** on (top-right corner).
3. Click **Load unpacked** (top-left).
4. Select the `.output/chrome-mv3` directory inside the project folder.
5. Pin Mozhi from the extensions menu.

---

## Configuring Providers

### Local SLM Setup
1. Click the Mozhi extension icon to open the popup.
2. Click the gear icon (**Settings**) in the top right to open settings in a new tab.
3. Under **Local Model**, inspect your browser's WebGPU support status.
4. Click **Download model**. Grant the optional host permission for `huggingface.co` when prompted.
5. Once the download and automatic one-token startup test succeed, the badge will change to **Ready**.
6. In the popup, select **Local** under Provider to use on-device prompt correction.

### Online BYOK Setup
Mozhi works with any OpenAI-compatible chat completion endpoint:
1. Open Mozhi **Settings**.
2. Under **Online Provider**, configure your details:
   - **API Base URL**: `https://api.openai.com/v1` (or your custom HTTPS proxy / provider URL).
   - **Model**: `gpt-4o-mini` (or your preferred model, e.g. `gpt-4o`, `claude-3-5-sonnet`, `deepseek-chat`).
   - **API Key**: Enter your key (e.g., `sk-proj-EXAMPLE_KEY_DO_NOT_COMMIT`).
3. Click **Test connection** to verify connectivity.
4. Click **Save settings**.

---

## Available Scripts

| Command | Action |
| :--- | :--- |
| `npm run dev` | Starts WXT development server with live reload. |
| `npm run build` | Builds the production extension into `.output/chrome-mv3`. |
| `npm run zip` | Packages the production build into a `.zip` file for Chrome Web Store submission. |
| `npm run typecheck` | Runs `tsc --noEmit` to validate all TypeScript types. |
| `npm test` | Runs the full Vitest suite (22+ unit and integration test files). |
| `npm run test:watch` | Runs Vitest in interactive watch mode. |

---

## Known Limitations

- **Local Model Task Scope**: The local model is optimized specifically for **Typo & Grammar Fix**. It will reject requests in `light`, `balanced`, or `advanced` modes and instruct you to switch to Online BYOK.
- **Local Character Limit**: Local prompt correction is provisionally limited to **300 characters** per request to prevent browser worker memory spikes and thermal throttling. Prompts exceeding 300 characters require Online BYOK.
- **Insertion Target**: The one-click insert action currently supports `chatgpt.com` and `chat.openai.com`. On other websites, use the **Copy** button.

---

## Contributing

Contributions, bug reports, and suggestions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before submitting pull requests.

---

## Security

To report security vulnerabilities privately, please review our [SECURITY.md](SECURITY.md). Do not report vulnerabilities through public GitHub issues.

---

## License

This project is licensed under the [MIT License](LICENSE) &copy; 2026 Jeeva Venkidu.

The SmolLM2 model weights downloaded by the user are licensed under [Apache License 2.0](https://huggingface.co/datasets/choosealicense/licenses/blob/main/markdown/apache-2.0.md) by Hugging Face.
# mozhi
