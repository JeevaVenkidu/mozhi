# Changelog

All notable changes to Mozhi will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Initial community health documentation (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`).
- GitHub issue and pull request templates.

---

## [0.1.0] - 2026-10-20

### Added
- **Local Small Language Model (SLM) Inference**:
  - In-browser execution using Transformers.js (`@huggingface/transformers` v4.3.1) and ONNX runtime.
  - Pinned snapshot of `onnx-community/SmolLM2-360M-Instruct-ONNX` (Apache 2.0).
  - WebGPU hardware acceleration with automatic graceful fallback to WASM CPU inference.
  - Local model management tab in Settings (download, status indicator, smoke test, cache purge).
- **Online BYOK Provider**:
  - User-configurable OpenAI-compatible HTTPS endpoint, custom model name, and API key.
  - Test connection utility in Settings.
- **Prompt Enhancement Modes**:
  - `Typo & Grammar Fix`: Surface-level correction preserving tone, meaning, and technical identifiers (supported locally and online).
  - `Light`: Clarity and phrasing refinement with minimal structural changes (online only).
  - `Balanced`: Clear, actionable structuring with constraints and bullet points (online only).
  - `Advanced`: Full prompt engineering architecture across domains (Role, Task, Context, Steps, Output Format, Constraints) (online only).
- **Website Integration**:
  - One-click prompt insertion into ChatGPT (`chatgpt.com` and `chat.openai.com`).
  - Text insertion without auto-submitting.
- **Workflow & Persistence**:
  - Unsent popup drafts and previous results persist across popup dismissal in `chrome.storage.local`.
  - Side-by-side prompt comparison view.
  - Reset draft and copy-to-clipboard actions.
- **Diagnostics & Privacy**:
  - Built-in API error logger with defense-in-depth sanitization (redacting API keys, bearer tokens, URL credentials, and query parameters).
  - Diagnostic export to Markdown for safe bug reporting.
  - Complete data wipe option removing all local settings, keys, and model cache.
