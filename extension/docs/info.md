# Lensight — Project Overview, PRD and Reference

_Last updated: 2026-10-05. Version 0.1.0 (MVP, pre-launch, not yet published to any store)._

This is the canonical "what is this project" reference. It combines the product requirements, the architecture, the honest feature status and the current project stats. Detailed sources:

- Research spec: `../../universal-ai-context-assistant-research.md`
- Audit: `../../REMEDIATION_REPORT_ai-context-assistant_2026-09-24.md`
- Engineering log: [`fixed.md`](fixed.md)
- Status matrix (source of truth for feature status): [`LIMITATIONS.md`](LIMITATIONS.md)
- [`ARCHITECTURE.md`](ARCHITECTURE.md), [`PRIVACY.md`](PRIVACY.md), [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md), [`SECURITY.md`](SECURITY.md), [`SETUP.md`](SETUP.md), [`PERFORMANCE.md`](PERFORMANCE.md), [`STORE_SUBMISSION.md`](STORE_SUBMISSION.md)
- `../../desktop-companion/README.md`

---

## 1. Product vision and positioning

**Lensight is a local-first AI context assistant.** It is a Chrome Manifest V3 browser extension, with an optional Tauri desktop companion, that lets a user ask natural-language questions about what they are viewing (a web page, a text selection, an imported PDF or file, or a group of captured sources) without copying content into a chatbot.

**The core guarantee:** capture, cleaning, chunking, embedding, vector storage and retrieval happen entirely on the device. Only the small, retrieval-narrowed context and the user's question can ever reach an AI model, and only a model the user chose. That model can be fully local.

**Positioning:** nothing else combines all four of these:

1. A genuinely local-first default.
2. A documented, honest per-platform capability matrix (L1–L7) instead of "AI everywhere" marketing.
3. One adapter architecture that treats web pages, selections, chats and PDFs as instances of a single schema.
4. User-swappable AI providers, including fully local ones.

The defensible position is privacy, honesty about limitations, and adapter extensibility. Lensight does not train models, so it does not compete on raw model quality.

**Honest claim used everywhere:** "Your content never leaves your device unless you explicitly choose a remote AI provider, and even then only the minimal retrieved context is sent." Lensight never claims "100% private" once a remote provider is active.

## 2. Problem statement

People spend much of their day inside content they cannot easily query: long chat threads, dense docs, dashboards, research papers, job postings. The usual workaround is to copy and paste into ChatGPT. That is slow, it loses context (formatting, timestamps, sender information), and it forces private content such as messages and work documents through a generic cloud chatbot with no local alternative.

## 3. Target users

| Segment | Status | Need |
|---|---|---|
| Technical power users who read and work across many tabs daily | **Primary (v1)** | A fast, trustworthy "ask about what I'm looking at" layer where privacy is a hard requirement |
| Researchers and students | Future | Multi-document synthesis |
| Knowledge workers | Future | Meeting and chat summarization, task extraction |
| Developers | Future | Documentation and code understanding |
| Job seekers | Future | Job-description analysis |

## 4. Core use cases (ranked by MVP priority)

1. **Generic web page Q&A and summarization.** Works anywhere with a normal DOM. Highest leverage, lowest risk.
2. **Selection-based Q&A.** Universal fallback for sites that cannot be fully parsed.
3. **WhatsApp Web conversation intelligence.** Summarize and extract links, tasks and dates from messages currently rendered in the DOM. Experimental.
4. **PDF understanding.** Locally imported, text-based PDFs.
5. **Multi-tab research sessions.** Ask across several captured sources at once.
6. **Local file import.** `.txt`, `.md`, `.csv`, `.json`, `.pdf`.

**MVP success flow:** open a website → invoke Lensight on the tab → capture the page → ask a question → local retrieval → answer with sources shown → click a citation to jump to the original text → delete the source when done.

**Non-goals for v1:** reading content the user is not already authorized to view; automated or continuous background scraping; bypassing anti-automation, encryption or authentication; a mobile app or native WhatsApp Desktop integration; multi-user or team features, payments, or a hosted backend.

## 5. Platform capability matrix

**Levels:** L1 native web integration (full DOM extraction) · L2 supported web app (custom adapter, some fragility) · L3 selection-based · L4 screenshot + OCR · L5 file import · L6 desktop integration · L7 unsupported (explained, not faked).

The research-doc level says what is technically achievable. The "Lensight status" column comes from `LIMITATIONS.md` and says what actually runs today.

| Platform / source | Level | Method | Lensight status today |
|---|---|---|---|
| Normal website / article | L1 | DOM + Readability-style extraction | **Implemented** (`genericWebAdapter.ts`) |
| Text selection, any page | L3 | `window.getSelection()` | **Implemented** (`selectionAdapter.ts`) |
| Modern SPA / dashboard | L1–L2 | DOM, with per-framework tuning | **Partially supported.** Generic adapter only, no MutationObserver wait |
| GitHub | L1 | DOM | **Partially supported.** Falls through to the generic adapter |
| WhatsApp Web | L2 | Scoped DOM adapter + scroll-and-collect | **Experimental.** Fixture-tested only, never against a live session |
| Gmail | L2 | Scoped DOM adapter | **Not supported** (Planned) |
| Google Docs | L2–L3 | Accessibility tree / selection | **Not supported** (Planned). Selection capture works as a fallback |
| LinkedIn | L2 | Scoped, user-triggered DOM adapter | **Not supported** (Planned) |
| YouTube transcripts | L2 | Transcript panel / caption track | **Not supported** (Planned) |
| PDF, imported file | L5 (L1 quality) | pdf.js on the file bytes | **Implemented for text-based PDFs** |
| PDF, open in Chrome's viewer | — | `extractFromUrl()` library function | **Not wired to any UI.** Import the file instead |
| Scanned / image-only PDF | L4 | OCR | **Not supported** (Planned) |
| Local files: txt / md / csv / json / pdf | L5 | `localFileAdapter.ts` | **Implemented** |
| Local files: docx | L5 | — | **Not supported** (Planned). Explicit error, not faked |
| Open Shadow DOM | L1 | Shadow-piercing traversal | **Not specifically supported.** The generic adapter has no shadow-root traversal; use selection capture |
| Cross-origin iframe, closed Shadow DOM, DRM | L7 | None | **Not supported, by design** (browser security boundary) |
| Canvas-rendered content | L4 | Screenshot + OCR | **Not supported** (OCR Planned) |
| Native desktop apps (WhatsApp Desktop, Slack) | L6 | Desktop companion + OS accessibility APIs | **Not built.** The companion exists but has no accessibility-API integration |
| Mobile browser / mobile apps | L5 / L7 | Share-sheet import only | **Not supported** (out of scope for v1) |

**UX rule:** every source shows its actual capability level (`SourceCapabilityBadge.tsx`). Lensight never shows a generic "AI is reading this page" claim when the true level is lower.

## 6. Privacy architecture

**Data flow:** Page / selection / file → content script or file adapter (extraction) → local cleaning and chunking → local embeddings → local IndexedDB vector store → local top-k retrieval → **[boundary]** → AI provider → answer → citations resolved locally to chunk IDs.

Everything before the boundary stays on the device in every mode. Only the retrieved chunks (each capped at 4,000 characters) and the user's question can cross it, never the full page, other tabs or browsing history.

### Modes

| Mode | Embeddings | Generation | What leaves the device | Enforcement |
|---|---|---|---|---|
| **A — Fully local** | `hashingEmbeddingProvider` (default), or `transformersEmbeddingProvider` (opt-in one-time model download) | `extractiveLocalProvider` (default, returns ranked excerpts) or `ollamaProvider` (user-installed Ollama on `localhost`) | **Nothing.** The only network event possible is the public model-file download from Hugging Face if Transformers.js is opted into, which contains no user content | `providerSelection.ts` can only construct local providers in Mode A, even with stale remote settings in storage, and refuses any non-loopback Ollama URL (`ModeAViolationError`). The Settings UI filters and force-resets as a second layer. |
| **B — Local data, remote AI** | Local | Gemini or an OpenAI-compatible endpoint, with the user's own key | One HTTPS request per question: fixed system instruction, the question, the retrieved excerpts (from the current source or selected session only), model name, and API key | Plain `http://` remote endpoints are refused. Unscoped questions are rejected by the background. The Gemini key goes in a header, not the URL. |
| **C — User configurable** | Local | User-chosen | Same as B | In this version B and C behave identically in code. "Mix per source" is not built. |

With no remote provider configured, Mode B behaves like Mode A.

Mode A has four honestly different states (hashing + extractive; hashing + Ollama; Transformers.js + extractive; Transformers.js + Ollama). `PrivacyIndicator.tsx` discloses which one is active.

### Permissions (least privilege)

| Permission | Purpose |
|---|---|
| `activeTab` | One-time access to the tab the user invokes Lensight on |
| `scripting` | On-demand injection of the capture script into that tab. No content script is registered for all sites (`"content_scripts"` is absent from the built manifest) |
| `storage` | Settings, API key, preferences, diagnostics, shortcut hand-off |
| `sidePanel` | Primary UI |
| host `http://localhost/*` | Reach the user's own Ollama daemon |

Not requested: `tabs`, `history`, `bookmarks`, `cookies`, `webRequest`, `<all_urls>`. There is no telemetry, analytics or crash reporting of any kind. Diagnostics are a local ring buffer of 50 events whose format cannot hold page text.

### User controls

Context in use panel (view or remove individual excerpts), delete session, delete all data, export all data (JSON), import data (validated before any write), storage usage, clear stored API key. Uninstalling removes everything.

## 7. Security model summary

| Threat | Mitigation |
|---|---|
| Prompt injection from page content | `promptTemplate.ts#buildPrompt` is the only place a prompt is assembled. It separates SYSTEM / USER QUESTION / `<untrusted_context>`; NFKC-normalizes and strips invisible characters; escapes every fence-tag spelling (case, whitespace, `_`/`-`, attributes, full-width, homoglyphs); defangs fake `[chunk_id:]` and SYSTEM lines; and caps chunks at 4,000 characters. Hidden DOM text is not captured. Covered by the mandatory `promptTemplate.test.ts` plus 19 adversarial tests. Residual risk: degraded answer quality, which can be mitigated but not solved. |
| Model-triggered actions | No tool calling. `AIProvider.generate()` returns only an answer string and chunk IDs. |
| Leaked API key | `chrome.storage.local` only (never `sync`), never logged, never hard-coded; Gemini key in the `x-goog-api-key` header; `http://` remote endpoints refused. Residual risk: local malware or a renderer exploit in an injected tab. |
| Messages from untrusted contexts | The background accepts messages only from `chrome-extension://<id>/` pages and validates every field at runtime (`messaging/validate.ts`). |
| XSS | React text rendering. No `dangerouslySetInnerHTML` in `src/ui`. |
| Remote code | All code ships in the package, including the ONNX Runtime WASM. The build fails if `cdn.jsdelivr.net` appears in any emitted file. CSP: `script-src 'self' 'wasm-unsafe-eval'`. |
| Malicious PDF | `pdfjs-dist` 6.4.299 (CVE-2024-4367 code path gone upstream), `enableXfa: false`, no font-face, 2,000-page cap, http(s) links only. |
| Vulnerable dependencies | Production advisories: 0. Five high advisories in dev-only Tailwind 3 tooling (`braces`). |
| Companion local API | Bound to `127.0.0.1` only; Host-header check against DNS rebinding (421); CORS only for Tauri webview origins. |

## 8. System architecture

```
Side panel / Popup / Options (extension pages)
   │  chrome.runtime messaging (sender must be chrome-extension://<id>; validate.ts)
   ▼
Background service worker (entrypoints/background.ts)
   │                                   Side panel ──scripting.executeScript (activeTab)──▶ Content script
   │                                                                                       │ SourceAdapters
   ▼                                                                                       ▼
rag/ingest.ts: clean.ts → chunk.ts → store (db.ts) → embed (embedBatches.ts) ◀── StructuredDocument
   │            (rolls back the stored source on embedding failure)
   ▼
IndexedDB: sources · documents · chunks · embeddings · sessions · conversations · messages
   │
rag/retrieve.ts → vectorStore.ts (cosine top-k, scoped to source/session and active embedding modelId)
   │
security/promptTemplate.ts (SYSTEM / USER QUESTION / <untrusted_context>)
   │
ai/providerSelection.ts → AIProvider (extractive-local | Ollama | Gemini | OpenAI-compatible)
   │
rag/orchestrator.ts → answer + citations → ChatBox.tsx / CitationLink.tsx
```

### Core abstractions

| Interface | File | Implementations |
|---|---|---|
| `SourceAdapter` (`detect`, `getCapabilityLevel`, `extractCurrentPage`, `extractSelection`, `getMetadata`, `getConfidence`) | `src/core/adapters/SourceAdapter.ts` | `genericWebAdapter` (L1), `selectionAdapter` (L3), `whatsappAdapter` (L2, Experimental). Async L5 file adapters (`pdfAdapter`, `localFileAdapter`) emit the same `StructuredDocument` schema but deliberately do not implement the synchronous interface. |
| `EmbeddingProvider` (`name`, `modelId`, `dimensions`, `embed`) | `src/core/ai/embeddings/EmbeddingProvider.ts` | `hashingEmbeddingProvider` (default, `hashing-bow-v1`, 256-dim); `transformersEmbeddingProvider` (`Xenova/all-MiniLM-L6-v2`, q8, 384-dim) |
| `AIProvider` (`name`, `mode`, `generate(system, question, untrustedContext, history?)`) | `src/core/ai/providers/AIProvider.ts` | `extractiveLocalProvider` (default), `OllamaProvider`, `GeminiProvider`, `OpenAICompatibleProvider` |

The orchestrator and retrieval import only the interfaces. `providerSelection.ts` constructs concrete providers fresh on every request from stored settings.

### RAG pipeline

Cleaning (whitespace and entity normalization, boilerplate) → normalization → paragraph- and heading-aware chunking (about 300–500 tokens, about 60 tokens of overlap, no mid-sentence splits, hard character caps) → metadata and source anchor → local embeddings (batches of 24 with a real macrotask yield between them) → IndexedDB → brute-force cosine top-k → prompt assembly → generation → citations. Reranking and ANN indexing are deliberately deferred.

### Data model

UserSettings (in `chrome.storage.local`), Source, Document, Chunk, Embedding, Session, Conversation, Message. Relationships: Session 1–N Source; Source 1–1 Document; Document 1–N Chunk; Chunk 1–1 Embedding.

### Desktop companion

`desktop-companion/` is a Rust workspace. `core` (`lensight-companion-core`) has no GUI dependency: Ollama health check, an `axum` HTTP API on `127.0.0.1:47291` (`GET /health`, `POST /ocr`), an OCR stub, and file-picker contract types. `src-tauri` (`lensight-companion`) is the Tauri shell with a native file picker and the static `ui/index.html`. **The extension does not call the companion yet.**

## 9. Feature status (from `LIMITATIONS.md`)

### Implemented

- Generic web page capture (L1) and selection capture (L3), with injection on demand under `activeTab`. Hidden text is excluded and nested blocks are de-duplicated.
- PDF import (text-based) with per-page anchors, metadata and links. Local file import for txt, md, csv, json and pdf, up to 25 MB.
- Cleaning, chunking, IndexedDB storage, brute-force cosine retrieval scoped to the active embedding model.
- Research sessions: create, add or remove sources, delete, and cross-source retrieval.
- Retrieval scope "current source only" vs. "active session", enforced by the background.
- Zero-setup local pipeline (hashing embeddings + extractive answers, no network, no key).
- Runtime provider selection, with Mode A enforced independently of the UI.
- Mode A, B and C selectable in Settings.
- Ollama provider for Mode A. The HTTP contract is verified against a mocked daemon only.
- Gemini and OpenAI-compatible providers. Code-complete, but not network-verified (no API key available in the environment).
- Transformers.js embeddings, runtime-selectable. The pipeline is verified in real Chromium with a synthetic model only.
- Prompt-injection defense with adversarial tests.
- Side panel with Context panel, Privacy indicator, Chat box, citations and citation click-through; popup (opens the side panel); options page; command palette (Ctrl/Cmd+K); onboarding; diagnostics; keyboard shortcuts Ctrl/Cmd+Shift+E and Ctrl/Cmd+Shift+Y.
- Data controls: export, import (validated), delete all, delete session, remove an excerpt, storage usage.
- Dark and light mode (`darkMode: 'media'`). axe-core WCAG 2.0/2.1 A/AA: 0 violating nodes across 7 audits.

### Experimental

- WhatsApp Web adapter (fixture-tested only).
- Companion native file picker (never compiled or run here).
- Companion Tauri GUI shell (code complete, does not compile in this sandbox).

### Partially supported

- SPA tuning. GitHub via the generic adapter. Mode C (no per-source mixing).
- Desktop companion: the core crate works; there is no extension integration and no OS-accessibility integration.

### Not supported / Planned

Gmail, Google Docs, LinkedIn and YouTube adapters; `.docx` import; OCR for scanned PDFs and canvas content; browser-viewed PDF capture (library function only); extension → companion wiring; ANN indexing; reranking; mobile; a packaged companion binary; team features and monetization.

### Behavior change to know about

Since the audit, capture requires invoking Lensight on the tab first (toolbar icon or shortcut). This is the deliberate least-privilege trade-off for dropping `<all_urls>`.

## 10. Tech stack and rationale

| Layer | Choice | Version (package.json) | Why |
|---|---|---|---|
| Extension platform | Chrome Manifest V3 | — | Only forward-compatible target. MV2 is deprecated. |
| Framework / build | WXT | ^0.21.4 | Simpler config and better MV3-native DX than Plasmo. Handles manifest generation, options/popup/side-panel wiring, runtime content-script registration. |
| UI | React + TypeScript + Tailwind CSS | React ^18.3.1, TS ^5.5.4, Tailwind ^3.4.10 | Mature, typed, fast to iterate. Tailwind `dark:` variants give consistent dark mode. Tailwind 4 migration deferred. |
| Storage / vector index | IndexedDB via `idb` | ^8.0.0 | Browser-native, no WASM, no CSP friction. Brute force is enough at MVP scale. |
| PDF parsing | `pdfjs-dist` | ^6.4.299 | Mozilla's parser. Parses the file's own bytes independent of the viewer. 6.x removes the CVE-2024-4367 path. |
| Local embeddings (opt-in) | `@huggingface/transformers` + `onnxruntime-web/wasm` | ^4.3.0 | Real on-device neural embeddings. The WASM runtime is packaged, so there is no remote code. |
| Local generation | Ollama (user-installed) | — | A browser extension cannot bundle a multi-GB LLM. Ollama runs locally at usable speed. |
| Remote providers | Gemini API; OpenAI-compatible (OpenAI, OpenRouter, Groq, self-hosted) | — | One adapter covers most providers. The user brings their own key. No single-vendor dependency. |
| Unit tests | Vitest, jsdom, fake-indexeddb, pdf-lib | Vitest ^5.0.3 | Fast. Real PDFs generated at test time. Real IndexedDB semantics. |
| E2E / browser | Playwright; axe-core for accessibility | ^1.47.0 | Real-Chromium checks. |
| Desktop companion | Rust + Tauri (+ `axum`) | — | Lighter than Electron, strong OS API access. The GUI-free `core` crate is testable anywhere. |
| Runtime requirement | Node.js ≥ 22.13 | — | pdfjs-dist 6.x and Vitest 5 engine requirement. |

There is no backend service.

## 11. Competitive landscape (from the research doc)

| Product | Privacy model | Local processing | Platform | Gap Lensight targets |
|---|---|---|---|---|
| ChatGPT browser features | Cloud-only | None | Web + apps | No local mode, no persistent local index, no site adapters |
| Perplexity (Comet browser) | Cloud-only | None | Own browser | Requires switching browsers; no local mode |
| Microsoft Copilot in Edge | Cloud; enterprise controls only on paid tiers | None | Edge only | Locked to Edge; no local-only option |
| Gemini in Chrome | Partly on-device (Gemini Nano) for narrow tasks, rest cloud | Partial | Chrome only | Closed, not user-configurable, no explicit local RAG |
| Arc / Arc Search | Cloud | None | Own browser | Browser lock-in; a feature, not a platform |
| OSS "Ollama + browser" extensions | Local if configured | Yes | Chrome / Firefox | Prove demand, but lack polished UX, adapters, RAG and citations |
| Obsidian plugins / Notion AI / Mem | Varies | Varies | Desktop apps | No live capture of what is on screen in the browser |

## 12. Project stats (measured 2026-10-05)

### Browser extension (`ai-context-assistant/`)

| Metric | Value |
|---|---|
| Source files (`src/` + `entrypoints/`, `.ts`/`.tsx`) | 57 files, 7,112 lines |
| Test files (`tests/`, `.ts`/`.tsx`) | 28 files, 2,917 lines (26 unit test files + e2e spec and harness) |
| Unit tests | **224 passed / 224** in 26 files (`npm run test`) |
| E2E smoke | 1 passed (Chromium 1194, audit config) |
| Docs (`docs/*.md`, before this file, `fixed.md` and `pitch.md`) | 9 files, 1,248 lines |
| `npm audit --omit=dev` | 0 advisories |
| axe-core violating nodes | 0 (7 audits) |
| Built package | ~16.84 MB (14.26 MB ONNX Runtime WASM); `background.js` ~2.33 MB |
| Test history | 130 (18 files) → 221 (26) after audit → 224 (26) after DEP-01 |

### Desktop companion (`desktop-companion/`)

| Metric | Value |
|---|---|
| Rust source | 8 files, 837 lines (`core/src`: 5 files, 728 lines; `src-tauri/src`: 3 files, 109 lines) |
| UI | `ui/index.html`, 73 lines |
| Tests | **18 passed / 18** (`cargo test -p lensight-companion-core`); 14 before the audit |
| `cargo clippy --all-targets` | 0 warnings (at audit) |
| Tauri shell build | Fails in this sandbox: missing `gdk-3.0`/webkit2gtk |

### Audit summary

52 issues found (9 P1, 21 P2, 22 P3); 44 fixed, 6 deferred, 1 won't fix, 1 not reproducible. Every production CVE has since been resolved (DEP-01). See [`fixed.md`](fixed.md).

## 13. Release readiness

| Target | Status |
|---|---|
| Personal unpacked use | Ready, pending one manual headed-browser check of the `activeTab` and shortcut flows |
| Chrome Web Store | Code-side blockers resolved (production CVEs, CDN string, `eval`, privacy policy text). Remaining tasks need a person: fill and host `PRIVACY_POLICY.md`, complete the dashboard disclosures, and do the manual headed-browser verification. See `STORE_SUBMISSION.md`. |
| Desktop companion | Core library ready. The GUI is unverified and no installer has been built. |

## 14. Roadmap

From the research doc and the open items in `LIMITATIONS.md`:

1. **Launch readiness:** manual headed-browser verification, hosted privacy policy, store listing, real-network verification of Transformers.js, Ollama, Gemini and OpenAI-compatible providers.
2. **Source breadth:** live-verified WhatsApp adapter with a self-test loop; Gmail, Google Docs, GitHub-specific, LinkedIn and YouTube transcript adapters; `.docx`; OCR.
3. **Local AI depth:** extension → companion wiring; companion GUI build and packaging; native-app accessibility integration (L6).
4. **Scale and quality:** ANN indexing past about 50k chunks, reranking, per-provider model settings, vector storage migration, Mode C per-source mixing.
5. **Engineering hygiene:** Tailwind 4 migration, ESLint, component tests for Settings, PrivacyIndicator, Onboarding and Diagnostics; `cargo audit`.
6. **Monetization (designed for, not built):** Free / Pro / Team tiers, configured on the existing provider abstractions and Session/Source data model.
7. **Later:** mobile share-sheet import, opt-in automations, team and shared knowledge.
