# Contributing to Mozhi

Thank you for your interest in contributing to Mozhi! We welcome community contributions, bug reports, and ideas to improve the extension.

Mozhi is maintained by an independent developer. To keep contributions efficient and enjoyable for everyone, please review these lightweight guidelines.

---

## Code of Conduct

All contributors and participants are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## How to Report Bugs

1. Check existing [GitHub Issues](https://github.com/JeevaVenkidu/mozhi/issues) to ensure the bug hasn't already been reported.
2. If it is new, open an issue using the Bug Report template.
3. Include:
   - Your Chrome or Chromium version.
   - Operating system.
   - Provider used (Local SLM or Online BYOK).
   - Steps to reproduce the problem.
   - Expected behavior vs. actual behavior.
   - Sanitized diagnostic logs if applicable (available in Mozhi **Settings → Error logs → Copy Markdown**).

> [!CAUTION]
> **Never include API keys, passwords, or personal credentials in issue reports.** The built-in diagnostic log copy tool automatically redacts known key patterns, but please review any snippet before posting publicly.

---

## Proposing Feature Requests

If you have an idea for a new enhancement mode, integration, or UI improvement:
1. Open an issue with the Feature Request template.
2. Explain the use case and why this improvement would benefit users.
3. Discuss the concept before opening a complex PR to make sure it aligns with Mozhi's privacy-first design principles.

---

## Development Setup

### 1. Prerequisites
- Node.js (v18+)
- npm (v9+)
- Google Chrome or Chromium-based browser

### 2. Getting the code
```sh
git clone https://github.com/JeevaVenkidu/mozhi.git
cd mozhi
npm install
```

### 3. Running locally
```sh
npm run dev
```
WXT will start a development server and launch an isolated Chrome profile with hot-module reload enabled.

### 4. Running verification checks
Before submitting a pull request, ensure all tests and type checks pass cleanly:

```sh
# Run TypeScript compilation check
npm run typecheck

# Run test suite
npm test

# Verify production build
npm run build
```

---

## Pull Request Guidelines

1. **Fork and branch**: Create a feature branch from `main` (e.g. `git checkout -b feature/your-feature-name`).
2. **Atomic commits**: Keep commits focused and provide clear, descriptive commit messages.
3. **Preserve privacy guarantees**:
   - Mozhi must **never** send prompts to an unconfirmed remote server.
   - Local model operations must stay on-device in Web Workers.
   - Avoid collecting telemetry or analytics without explicit consent.
4. **Add or update tests**: If you add new behavior or fix a bug, please include tests under `tests/`.
5. **No CLA or DCO required**: We keep the contribution process lightweight. By submitting a PR, you agree that your contribution is provided under the project's [MIT License](LICENSE).
