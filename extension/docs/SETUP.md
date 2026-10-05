# Setup

## Install

```bash
npm install
```

Requires Node.js ≥ 22.13 (pdfjs-dist 6.x and vitest 5 engine requirement).
The project `.npmrc` sets `onnxruntime-node-install=skip`. `onnxruntime-node`,
pulled in by `@huggingface/transformers` for Node use only, ships its CPU
binaries in the npm tarball, and its postinstall would otherwise try to
download optional CUDA binaries from GitHub. The extension itself uses
`onnxruntime-web`.

## Before submitting to the Chrome Web Store

See [`STORE_SUBMISSION.md`](STORE_SUBMISSION.md). Two things are still
outstanding and need a person: hosting [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md)
(after filling in its placeholders) and linking it in the listing, and
manually verifying the toolbar-icon and keyboard-shortcut flows in a real
headed Chrome.

## Develop

```bash
npm run dev
```

This runs `wxt` in dev mode, which builds to `.output/chrome-mv3-dev` (or
similar) and hot-reloads on save.

## Build

```bash
npm run build
```

Produces a production build in `.output/chrome-mv3/`.

## Load the unpacked extension in Chrome

1. Run `npm run build` (or `npm run dev` for a live dev build).
2. Open `chrome://extensions`.
3. Enable "Developer mode" (top right).
4. Click "Load unpacked" and select `.output/chrome-mv3/`.
5. Click the extension icon to open the popup, or use "Open side panel" —
   the side panel is the primary UI.

## Configure a remote AI provider (move off Basic Local Mode)

With no provider configured, the extension uses:
- `hashingEmbeddingProvider` for embeddings (no network, no setup), and
- `extractiveLocalProvider` for "answers" (clearly labeled "Basic local
  mode — no AI model configured"; it returns the top matching excerpts, not
  a generated answer).

**Use the Settings page** (right-click the extension icon → Options, or
click "Settings" in the side panel header) to configure a real provider:
pick a privacy mode (with an honest note on what that mode means, reused
from `docs/PRIVACY.md`), pick Gemini or an OpenAI-compatible endpoint, and
paste an API key — it's masked as you type, saved only to
`chrome.storage.local`, and never shown again in plaintext (only a "key
configured" indicator persists across reloads).

Equivalently, for scripting/testing, you can still set the same
`chrome.storage.local` keys directly from the extension's service worker
console:

```js
chrome.storage.local.set({
  providerKind: 'gemini',       // or 'openai-compatible'
  apiKey: 'YOUR_KEY_HERE',      // never commit this; user-supplied only
  model: 'gemini-1.5-flash',    // optional
});
```

For an OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq, or local
Ollama's OpenAI-compatible surface):

```js
chrome.storage.local.set({
  providerKind: 'openai-compatible',
  apiKey: 'YOUR_KEY_HERE',            // omit/blank for a local Ollama endpoint
  baseUrl: 'http://localhost:11434/v1', // or https://api.openai.com/v1, etc.
  model: 'llama3.1',
});
```

API keys are **never** hardcoded anywhere in this codebase — see
`docs/SECURITY.md`.

## Use Mode A (fully local) — three real local options

Mode A restricts generation to local-only providers, in both the Settings
UI and independently in `src/core/ai/providerSelection.ts`. Pick a privacy
mode of **A** on the Settings page, then choose:

- **Embeddings**: "Hashing / bag-of-words" (default, zero setup) or
  "Transformers.js neural embeddings" — the latter downloads
  `Xenova/all-MiniLM-L6-v2` (~90MB) from Hugging Face's CDN the first time
  it's used, then caches it. **Not exercised end-to-end in this build
  environment** — this sandbox's outbound network policy blocked the
  download (see `docs/LIMITATIONS.md` for the real error). The provider
  code itself is real and unit tested against a mocked model call.
- **Generation**: "Basic local mode" (extractive, zero setup — returns
  ranked excerpts, not a generated answer) or "Ollama" — the latter requires
  you to separately [install Ollama](https://ollama.com) and run it on your
  own machine (`ollama serve`, then `ollama pull llama3.1` or another model
  of your choice); the extension only makes an HTTP request to it, it does
  not and cannot bundle or run the model itself. If Ollama isn't reachable
  at `http://localhost:11434` (or whatever base URL you configure), asking a
  question shows a clear, actionable error instead of a silent fallback:
  `Ollama not reachable at http://localhost:11434 — install Ollama and pull
  a model, or switch providers in Settings.` **Not exercised against a real
  Ollama installation in this build environment** — no Ollama daemon is
  installed here; the HTTP request/response contract is verified against a
  mocked daemon in `tests/unit/ollamaProvider.test.ts`.

  **CORS note (not separately verified here):** the request to Ollama is
  made from the extension's background service worker
  (`chrome-extension://<id>` origin). Ollama's default configuration may not
  send permissive CORS headers for that origin. If you see a network/CORS
  error rather than the "not reachable" message, start Ollama with
  `OLLAMA_ORIGINS=chrome-extension://*` (or your extension's specific id) in
  its environment. This is a real, documented Ollama configuration
  requirement, not something this codebase can control from inside the
  extension.

Equivalently via the service worker console:

```js
chrome.storage.local.set({
  privacyMode: 'A',
  embeddingProviderKind: 'transformers', // or 'hashing'
  providerKind: 'ollama',                // or 'extractive-local'
  ollamaBaseUrl: 'http://localhost:11434',
  model: 'llama3.1',
});
```

## Import a local file

In the side panel, click "Import file…" next to "Capture this page" /
"Capture selection" and pick a `.txt`, `.md`, `.csv`, `.json`, or `.pdf`
file. It's parsed on-device (via `localFileAdapter.ts`, delegating to
`pdfAdapter.ts` for PDFs) and indexed exactly like a captured page — no
network call involved. `.docx` is not yet supported; picking one shows a
clear "Planned" error rather than silently doing nothing.

## Create a research session (multi-tab / cross-source retrieval)

Open "Research sessions" in the side panel, type a name, and click
"Create". With a session selected as the active retrieval scope (instead of
"Current source only"), click "+ current" on any captured source (page,
selection, PDF, or file import) to add it to that session — then questions
you ask are answered using the top-matching chunks across every source in
the session, not just the one you most recently captured.

## Tests

```bash
npm run test       # vitest unit tests (94 tests, see report for detail)
npm run compile    # tsc --noEmit type check
npm run test:e2e   # playwright e2e smoke test
```

**Known limitation in this build environment:** `npm run test:e2e` requires
downloading a Chromium browser binary via `npx playwright install`, which in
this sandboxed environment was blocked by the outbound network policy
(`cdn.playwright.dev` returned 403 from the egress proxy). The e2e test
itself (`tests/e2e/smoke.spec.ts`) is real, complete code — it bundles the
actual `genericWebAdapter` + `clean` + `chunk` modules with esbuild
(`tests/e2e/build-harness.mjs`, which does run successfully in this
environment) and would execute them against a real Chromium DOM given a
working browser install. The same real adapter/chunk pipeline logic is
additionally covered by `tests/unit/genericWebAdapter.test.ts` using jsdom,
which does run and pass in this environment, as a substitute check.

## Capturing a page (since the 2026-09-24 audit)

The extension no longer injects a content script into every site. To capture
a page, first invoke the extension **on that tab** — click the toolbar icon
(then "Open side panel") or press Ctrl/Cmd+Shift+E — which gives it Chrome's
one-time `activeTab` access; then use "Capture this page" / "Capture
selection". If you navigate the tab elsewhere and capture fails with "The
assistant doesn't have access to this tab", invoke it on the tab again.
Browser-internal pages (chrome://…, the Chrome Web Store) can never be read.
