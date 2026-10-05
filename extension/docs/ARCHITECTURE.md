# Architecture

## Pipeline (diagram-in-text)

```
Extension UI (Side Panel / Popup / Options)
        |  chrome.runtime messaging — sender must be an extension page;
        |  every message runtime-validated (src/core/messaging/validate.ts)
Background Service Worker (entrypoints/background.ts)

Side Panel --chrome.scripting.executeScript (activeTab, on demand)-->
Content Script (entrypoints/content.ts, registration: 'runtime')  <- registers SourceAdapters
        |
SourceAdapter.extractCurrentPage() / .extractSelection()
   - genericWebAdapter (Level 1)
   - selectionAdapter  (Level 3)
   - whatsappAdapter   (Level 2, EXPERIMENTAL — see LIMITATIONS.md)
        |
   (separate async import paths, not page-extraction — see below)
   - pdfAdapter.extractFromBytes()/.extractFromUrl() (Level 5)
   - localFileAdapter.extractLocalFile()             (Level 5)
        |
StructuredDocument
        |
core/processing/clean.ts   (whitespace/entity normalization, boilerplate lines)
core/processing/chunk.ts   (paragraph/heading aware, ~300-500 tokens, overlap)
        |
Chunk[]
        |
core/ai/providerSelection.ts (selects EmbeddingProvider + AIProvider from stored privacyMode/providerKind — the ONLY hardcoded default is its own fallback-to-local behavior)
        |
core/ai/embeddings/*EmbeddingProvider  (hashingEmbeddingProvider default; transformersEmbeddingProvider when opted in)
        |
Embedding[] --> core/storage/db.ts (IndexedDB: sources/documents/chunks/embeddings/...)
        |
core/rag/retrieve.ts  (embed query, cosine-similarity top-k via vectorStore.ts, scoped to the active embedding model id)
        |
core/security/promptTemplate.ts (SYSTEM / USER / <untrusted_context> separation)
        |
core/ai/providers/*AIProvider  (extractiveLocalProvider default; ollamaProvider / geminiProvider / openAICompatibleProvider optional)
        |
core/rag/orchestrator.ts (ties retrieval + prompt + provider together)
        |
Answer + Citation[] --> back to UI (ChatBox.tsx, CitationLink.tsx)
```

## Key interfaces

### SourceAdapter (`src/core/adapters/SourceAdapter.ts`)

```ts
interface SourceAdapter {
  sourceType: SourceType;
  detect(doc: Document): boolean;
  getCapabilityLevel(): CapabilityLevel; // 1-7
  extractCurrentPage(doc: Document): StructuredDocument | null;
  extractSelection(selection: Selection | null): StructuredDocument | null;
  getMetadata(doc: Document): SourceMetadata;
  getConfidence(): ConfidenceLevel;
}
```

Implemented: `genericWebAdapter` (L1), `selectionAdapter` (L3). Experimental:
`whatsappAdapter` (L2) — see LIMITATIONS.md for why it's labeled
Experimental rather than Implemented. Gmail (L2), Google Docs (L2-L3),
LinkedIn (L2), YouTube transcripts (L2) remain documented future adapters,
not present here.

### PDF and local file "adapters" (`pdfAdapter.ts`, `localFileAdapter.ts`)

Both are Level 5 (file/structured-format extraction) and both are
deliberately **async**, so neither literally implements `SourceAdapter`'s
synchronous `extractCurrentPage(doc): StructuredDocument | null` signature —
pdf.js parsing (and `File.text()`/`File.arrayBuffer()`) are inherently
promise-based. They produce the same `StructuredDocument`/`Chunk` output
schema everything else does, which is what the RAG pipeline actually
depends on; this is a documented, intentional deviation, not an oversight.

- `pdfAdapter.ts` — real `pdfjs-dist` 6.x parsing (`legacy/build/pdf.mjs`
  plus `pdf.worker.mjs`, loaded lazily and installed as
  `globalThis.pdfjsWorker` so pdf.js parses in-thread inside the MV3 service
  worker, which has no Web Worker and forbids runtime `import()`), per-page text turned into a `heading`
  block ("Page N") + `paragraph` block per page so the existing
  `chunkDocument()` pipeline attaches the page number to each chunk's
  `sourceAnchor.headingPath` with zero changes to the core `Chunk` schema.
  Also extracts Title/Author metadata and `Link` annotation URIs
  (`page.getAnnotations()`). Text-based PDFs only — no OCR, so
  scanned/image-only PDFs yield little or no text (see LIMITATIONS.md).
- `localFileAdapter.ts` — accepts a browser `File`; txt/md are turned into
  heading/paragraph/list-item blocks the same way `genericWebAdapter` does;
  csv is parsed with a small hand-written RFC-4180-ish parser
  (`parseCsv()`) into one `list-item` block per row; json is flattened into
  `path: value` lines (better for cosine-similarity retrieval than dumping
  raw JSON syntax); `.pdf` delegates to `pdfAdapter`; `.docx` throws a clear
  "Planned, not implemented" error rather than faking extraction.

### WhatsApp adapter (`whatsappAdapter.ts`) — EXPERIMENTAL

Row-based extraction against documented-but-unverifiable WhatsApp Web DOM
conventions (`[data-id]` per message row, `.copyable-text[data-pre-plain-text]`
carrying `"[time] Sender: "`, `.message-in`/`.message-out` for direction).
Also exports:
- `collectRecentMessages(container, maxMessages, { onScroll, waitTick })` —
  addresses the research doc's virtualization problem (WhatsApp Web only
  keeps a window of rows mounted) by repeatedly re-parsing + de-duplicating
  by `data-id` between caller-supplied scroll/wait steps, which is what
  makes it unit-testable against simulated DOM mutations in jsdom.
- `extractLinksFromMessages()` / `extractDateMentions()` — regex-based
  conversation-intelligence quick actions over already-extracted messages.
- `toConversationTimelineDocument()` — builds a `StructuredDocument` from an
  ordered message list; the actual chunking is still done by the existing,
  unmodified `chunkDocument()` (`src/core/processing/chunk.ts`), per the
  "don't duplicate chunking logic" design constraint.

### EmbeddingProvider (`src/core/ai/embeddings/EmbeddingProvider.ts`)

```ts
interface EmbeddingProvider {
  name: string;
  modelId: string;
  dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

- `hashingEmbeddingProvider` — DEFAULT. Deterministic feature-hashing /
  bag-of-words, no network, no model download.
- `transformersEmbeddingProvider` — real neural embeddings via
  `@huggingface/transformers` v4 (`Xenova/all-MiniLM-L6-v2`, `dtype: 'q8'`,
  384 dimensions; migrated from `@xenova/transformers` 2.x in DEP-01), NOT the
  default, requires a one-time model download. Now runtime-selectable (Phase
  6): `core/ai/providerSelection.ts`'s `selectEmbeddingProvider()` returns it
  when the stored `embeddingProviderKind` is `'transformers'`, and
  `entrypoints/background.ts` calls that selector fresh for both ingestion
  (`ingestExtractedDocument`) and query-time embedding (`ASK_QUESTION`), so
  it is a genuine settings-driven choice, not a hardcoded default anywhere.
  See LIMITATIONS.md for exactly what was/wasn't verified about the real
  model download in this build environment.
- **Embedding-model scoping in retrieval**: `core/storage/vectorStore.ts`'s
  `retrieveTopK()` and `core/rag/retrieve.ts`'s `retrieveRelevantChunks()`
  now filter candidate embeddings to the active embedding provider's
  `modelId`. This matters once embedding provider selection is a runtime
  choice: `hashing-bow-v1` (256-dim) and `transformers-all-MiniLM-L6-v2`
  (384-dim) vectors are not comparable, so mixing them in one cosine-
  similarity ranking would silently produce meaningless scores. The honest
  behavior enforced here is "no match under the current embedding model"
  for sources indexed under a different one, until they are re-captured —
  not a wrong-looking answer.

### AIProvider (`src/core/ai/providers/AIProvider.ts`)

```ts
interface AIProvider {
  name: string;
  mode: 'local' | 'remote';
  generate(
    systemPrompt: string,
    userQuestion: string,
    untrustedContext: { chunkId: string; text: string }[],
    history?: ConversationTurn[],
  ): Promise<{ answer: string; usedChunkIds: string[] }>;
}
```

- `extractiveLocalProvider` — DEFAULT, no network, returns top retrieved
  chunks labeled "Basic local mode — no AI model configured".
- `OllamaProvider` (`ollamaProvider.ts`) — real local generation for Mode A
  (Phase 6): calls a user-installed Ollama daemon's native, non-streaming
  `POST {baseUrl}/api/generate` endpoint (default
  `http://localhost:11434`), fully routed through the existing
  `core/security/promptTemplate.ts#buildPrompt` (no duplicated prompt
  assembly — Ollama's native endpoint takes one prompt string, so prior
  conversation history is folded ahead of the assembled
  SYSTEM/USER-QUESTION/`<untrusted_context>` template, and the template
  itself is untouched). "Local" here means no cloud provider is ever
  contacted — the model does NOT run inside the extension itself; Ollama is
  the "desktop companion" process the research doc's Feasibility section
  describes, just one the user installs themselves rather than one this
  codebase ships. If Ollama isn't reachable, `generate()` throws a specific,
  actionable error (e.g. `Ollama not reachable at http://localhost:11434 —
  install Ollama and pull a model...`) that surfaces directly in the UI via
  the existing `useAssistant.ask()` → `error` state path — never a silent
  fallback to a different provider. See `tests/unit/ollamaProvider.test.ts`
  (mocked `fetch`, no real Ollama install available in this environment —
  see LIMITATIONS.md) for the request/response contract.
- `GeminiProvider` — Google Generative Language API, user-supplied key.
- `OpenAICompatibleProvider` — OpenAI / OpenRouter / Groq / local Ollama
  (its OpenAI-compatible surface), configurable `baseUrl` + key.

The RAG orchestrator (`src/core/rag/orchestrator.ts`) and retrieval
(`src/core/rag/retrieve.ts`) only ever import these two interfaces, never a
concrete implementation — providers are swapped via extension settings
(`chrome.storage.local`), read in `entrypoints/background.ts`.

### Provider selection (`src/core/ai/providerSelection.ts`) — Phase 6

`selectEmbeddingProvider(config)` and `selectAIProvider(config)` are the
single place a stored `{ privacyMode, embeddingProviderKind, providerKind,
apiKey, baseUrl, ollamaBaseUrl, model }` object (exactly what
`chrome.storage.local` holds) is turned into concrete provider instances.
`entrypoints/background.ts`'s `getActiveProvider()` /
`getActiveEmbeddingProvider()` call these fresh on every `ASK_QUESTION` and
every document-ingestion request (`EXTRACT_RESULT`/`IMPORT_LOCAL_FILE`) — no
provider is imported/constructed once and reused, and nothing is
hardcoded. Critically, `selectAIProvider` enforces Mode A's guarantee
*independently* of the settings UI: if `privacyMode === 'A'`, it can only
ever return `extractiveLocalProvider` or `OllamaProvider`, even if stale
`providerKind: 'gemini'` + `apiKey` values are still sitting in storage from
a previous Mode B/C session — a settings-page bug alone could never leak
retrieved context to a remote provider. Covered by
`tests/unit/providerSelection.test.ts`.

## Storage

IndexedDB via the `idb` package (`src/core/storage/db.ts`), per the
research doc's explicit decision against SQLite/DuckDB/a WASM vector DB for
this MVP's scale. Stores: `sources`, `documents`, `chunks`, `embeddings`,
`sessions`, `conversations`, `messages`. Vector search
(`src/core/storage/vectorStore.ts`) is brute-force cosine similarity over
all embeddings — documented as sufficient up to tens of thousands of chunks,
with `hnswlib-wasm` or similar as a noted future upgrade path if a user's
local knowledge base grows far beyond MVP scale.

## Multi-tab / research sessions

`db.ts` now exposes `createSession(name)`, `getAllSessions()`,
`getSession(id)`, `addSourceToSession(sessionId, sourceId)` (idempotent),
and `removeSourceFromSession(sessionId, sourceId)`, extending the `Session`
store that was already scaffolded (`{ id, name, sourceIds, createdAt }`).
`src/core/rag/retrieve.ts`'s `sessionRetrieve(query, embeddingProvider,
sessionId, topK)` retrieves top-k chunks across every source in
`session.sourceIds` (empty array, not a thrown error, for an unknown or
empty session) by scoping the same `retrieveTopK`/cosine-similarity path
every other retrieval call uses — no new ranking logic. `askQuestion()`
(`orchestrator.ts`) now accepts an optional `sessionId`, which takes
precedence over `sourceIds` when both would otherwise apply. The side panel
wires this through `SessionPanel.tsx` + `useAssistant.ts`'s
`activeSessionId` state (`null` = current source only).

## Settings UI

Implemented as a WXT **options page** (`entrypoints/options/`), not a tab
inside the side panel — chosen because WXT already auto-wires an
`entrypoints/options/index.html` into `manifest.json`'s `options_ui.page`
with zero config (exactly the same convention `entrypoints/popup/` and
`entrypoints/sidepanel/` already use in this codebase), and because a
persistent options page a user visits occasionally is a more natural fit
than adding a settings mode to the side panel, which the existing
`ContextPanel`/`ChatBox`/`SessionPanel` already keep fairly dense. The form
itself (`src/ui/components/SettingsForm.tsx`) reads/writes the exact
`chrome.storage.local` keys `entrypoints/background.ts`'s
`getActiveProvider()` already expected (`providerKind`, `apiKey`, `baseUrl`,
`model`), plus a new `privacyMode` key the side panel's `PrivacyIndicator`
now reads on mount.

### Mode A wiring (Phase 6)

`SettingsForm.tsx` now has a separate "Local embeddings" selector
(`embeddingProviderKind`: hashing/transformers, stored independently of
generation provider — embeddings stay local in every mode, this only
changes retrieval quality vs. setup cost) and filters the "AI provider
(generation)" dropdown to `PROVIDER_OPTIONS` marked `localOnly: true`
(`extractive-local`, `ollama`) whenever `privacyMode === 'A'` is selected —
an effect also force-resets `providerKind` back to `extractive-local` the
instant Mode A is chosen while a remote provider was previously selected,
so the UI never displays a remote provider as "active" under Mode A even
transiently. This is a defense-in-depth UI behavior on top of
`providerSelection.ts`'s independent, request-time enforcement of the same
rule (see above) — either layer alone would already prevent a leak, but
neither relies on the other.

`PrivacyIndicator.tsx` now also accepts an optional `embeddingProviderName`
and, when `mode === 'A'`, renders one extra disclosure line distinguishing
four honestly-different Mode A states: no-install fallback (hashing +
extractive), real local embeddings only, real local generation only, or
both (Transformers.js + Ollama) — because "Mode A is active" alone
conflates a zero-setup fallback with a real on-device neural pipeline, and
those are meaningfully different guarantees to disclose, not just an
implementation detail.

### Known build-size effect of Phase 6

*(Historical. DEP-01 replaced `@xenova/transformers` with
`@huggingface/transformers`, and `background.js` is now ~2.33 MB. See the
audit notes at the end of this file.)* `@xenova/transformers` moved from
`devDependencies` to `dependencies` (it is
now reachable from a real, user-selectable runtime code path, not just
tests) and `entrypoints/background.ts` transitively imports
`transformersEmbeddingProvider.ts` via `providerSelection.ts`. WXT's MV3
service-worker bundling inlines this dependency's WASM-runtime JS glue
(`onnxruntime-web`) directly into `background.js` rather than code-splitting
it into a separate lazily-fetched chunk (service workers don't reliably
support dynamic `import()` the way page contexts do), which is why
`background.js` grew from ~427KB to ~1.26MB in this pass's `npm run build`
output. The actual ~90MB `Xenova/all-MiniLM-L6-v2` model weights are **not**
bundled — those are fetched from Hugging Face's CDN lazily, once, only if a
user opts into `embeddingProviderKind: 'transformers'` — only the always-
present JS runtime glue that *could* run that model is now part of the
static bundle.

## Desktop companion (sibling directory, optional)

A Tauri desktop companion now exists at `../desktop-companion/` (sibling to
this extension's own project root, not inside it), covering the research
doc's Phase 7. Full detail — build status, exact `cargo check`/`cargo test`
output, and a per-sub-feature Implemented/Experimental/Planned table — lives
in `desktop-companion/README.md`; this section only places it in this
codebase's architecture.

It is a strictly optional, additional layer:

- `ollamaProvider.ts` (above) is **unmodified** by the companion's
  existence and still talks directly to a user-installed Ollama daemon at
  `http://localhost:11434` — nothing in this extension currently calls the
  companion's API. The companion's own Ollama health-check independently
  targets the same default base URL for consistency, but it is a parallel,
  not-yet-wired capability, not a replacement path.
- Mode A's zero-install fallback (hashing embeddings + `extractiveLocalProvider`)
  and Mode B/C (remote providers) are entirely unaffected by whether the
  companion is installed or running.

What the companion provides, split across two Rust crates (a GUI-free
`core` crate — compiles and unit-tests in a plain sandbox — and a
`src-tauri` GUI shell that additionally needs a native webview toolkit):
an Ollama reachability check, a small local HTTP API on `127.0.0.1:47291`
(`GET /health`, `POST /ocr`), a native file-picker command (Tauri-only,
not verified buildable in every environment), and an explicit OCR stub that
always returns "not implemented" — consistent with, and not contradicting,
this doc's existing PDF/OCR notes above and `LIMITATIONS.md`'s OCR row.

## 2026-09-24 audit changes (structure only)

- `src/core/messaging/` — `validate.ts` (sender trust + runtime message
  validation), `binary.ts` (base64 transport for file bytes), `scope.ts`
  (explicit retrieval scope), `contentScript.ts` (on-demand injection).
- `src/core/rag/ingest.ts` — clean → chunk → store → embed, with rollback of
  the stored source if embedding fails (moved out of `background.ts`).
- `src/core/processing/embedBatches.ts` — batched embedding with a real
  macrotask yield (moved out of `background.ts`).
- `src/core/storage/validateExport.ts` — structural validation for "Import
  data" files, used by `db.ts#importData`.
- `src/core/net/loopback.ts`, `src/core/settingsValidation.ts` — shared
  loopback/URL rules used by both the Settings UI and `providerSelection.ts`.
- `background.js` was 1.28 MB after the 2026-09-24 audit (previously 1.27 MB),
  and the package contained `ort/ort-wasm-simd.wasm` + `ort/ort-wasm.wasm`
  (19.2 MB).
- DEP-01 (2026-10-05): `pdfjs-dist` went from 3.11.174 to 6.4.299 and
  `@xenova/transformers` 2.17.2 was replaced by `@huggingface/transformers`
  4.3.0. `background.js` is now ~2.33 MB, because pdf.js's worker module is
  bundled for in-thread parsing. The package holds a single
  `ort/ort-wasm-simd-threaded.wasm` (14.26 MB; total 16.84 MB).
  `wxt.config.ts` aliases `onnxruntime-web/webgpu` to `onnxruntime-web/wasm`,
  strips the library's CDN `wasmPaths` default at build time, and fails the
  build if `cdn.jsdelivr.net` appears in any emitted file.
