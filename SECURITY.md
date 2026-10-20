# Security Policy

The security of Mozhi and its users is taken seriously. As a local-first browser extension that handles prompt editing and API credentials, Mozhi is designed with a defense-in-depth model to keep user data private and under user control.

---

## Supported Versions

Only the latest release of Mozhi receives active security patches.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

---

## Reporting a Vulnerability

If you discover a security vulnerability or privacy flaw in Mozhi, please report it **responsibly and privately**.

### How to Report
- **Preferred Method**: Use [GitHub Private Vulnerability Reporting](https://github.com/JeevaVenkidu/mozhi/security/advisories/new) on the repository.
- **Alternative Method**: If private reporting is unavailable, reach out directly to the maintainer via **[INSERT SECURITY CONTACT EMAIL OR PRIVATE CONTACT METHOD]**.

### What to Include
To help assess and resolve the issue quickly, please include:
1. A clear description of the vulnerability and its potential security/privacy impact.
2. Step-by-step instructions or a minimal Proof of Concept (PoC) demonstrating how to reproduce the vulnerability.
3. The browser version, operating system, and extension version tested.
4. Any proposed mitigations or code fixes, if available.

### What NOT to Disclose Publicly
- Please **do not** open public GitHub issues, discussions, or social media posts regarding suspected vulnerabilities until an advisory and fix have been coordinated.
- Do not include real API keys, credentials, or personal prompt data in your report.

---

## Scope & Architectural Context

Please keep in mind the following platform characteristics when evaluating potential issues:

- **`chrome.storage.local` Security**: As with standard Chrome extensions, `chrome.storage.local` is not encrypted at rest by the browser. A local attacker with physical or administrative access to the user's local operating system account can read extension storage directly. This is documented in [README.md](README.md) and is a platform limitation rather than an exploitable remote vulnerability.
- **DOM Insertion Scope**: Mozhi uses Chrome's `scripting` and `activeTab` permissions to insert prompts into `chatgpt.com` and `chat.openai.com`. Prompt insertion is triggered only upon an explicit user click and never submits forms automatically.
- **Local Model Execution**: Local inference runs inside an isolated browser Web Worker with no background network calls after the initial model download from Hugging Face.
