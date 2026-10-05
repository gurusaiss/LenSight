# Lensight — Engineering Log: Learnings and Fixes, Start to End

_Last updated: 2026-10-05. Covers the browser extension (`ai-context-assistant/`, package name `lensight`) and the optional desktop companion (`desktop-companion/`, crates `lensight-companion-core` and `lensight-companion`)._

This is the project's engineering postmortem and changelog. Sections are numbered by development pass; the research doc's own roadmap phase numbers (which code comments such as "Phase 6" refer to) are given in each heading. It records, in order, what was built in each development pass, which real defects and security issues were found and how they were fixed, which architecture decisions were made and why, and what is still unresolved. Every claim below traces to a project artifact:

- `universal-ai-context-assistant-research.md`, the original research and architecture spec (2026-09-16)
- `REMEDIATION_REPORT_ai-context-assistant_2026-09-24.md`, the audit and remediation report
- `docs/ARCHITECTURE.md`, `docs/LIMITATIONS.md`, `docs/SECURITY.md`, `docs/PRIVACY.md`, `docs/PRIVACY_POLICY.md`, `docs/PERFORMANCE.md`, `docs/SETUP.md`, `docs/STORE_SUBMISSION.md`
- `desktop-companion/README.md`
- Raw command output saved in `scratchpad/audit-logs/` and `scratchpad/dep01-logs/`

Nothing here is a projection. Where something was not verified, this log says so.

---

## Current verified state (re-run 2026-10-05)

| Check | Result | Command |
|---|---|---|
| Extension unit tests | **224 passed / 224, 26 test files**, 0 failed, 0 skipped | `npm run test` (Vitest 5.0.3) |
| Companion core tests | **18 passed / 18**, 0 failed | `cargo test -p lensight-companion-core` |
| Production dependency advisories | **0** | `npm audit --omit=dev` (`dep01-logs/audit-prod-final.txt`) |
| All-dependency advisories | 5 high, all `braces` via Tailwind CSS 3 (dev/build only) | `npm audit` (`dep01-logs/audit-final.txt`) |
| axe-core WCAG 2.0/2.1 A+AA | **0 violating nodes** across 7 page/color-scheme audits | `dep01-logs/axe-dep01.log` |
| Playwright e2e smoke | 1 passed (pre-installed Chromium 1194, audit-only config) | `dep01-logs/e2e-after.txt` |
| Real-browser DEP-01 checks | 5/5 passed | `dep01-logs/verify-dep01.log` |
| Built manifest | `permissions: storage, activeTab, sidePanel, scripting`; host `http://localhost/*`; no `content_scripts` entry; CSP `script-src 'self' 'wasm-unsafe-eval'` | `.output/chrome-mv3/manifest.json` |
| Build output | `background.js` 2,332,562 bytes (~2.33 MB); package ~16.84 MB, of which 14.26 MB is `ort/ort-wasm-simd-threaded.wasm` | `npm run build` |
| Tauri GUI shell | does **not** compile in this sandbox (missing `gdk-3.0`/webkit2gtk) | `cargo check -p lensight-companion` |

Test count history: 130 tests in 18 files before the audit, 221 in 26 files after it, 224 in 26 files after the Chrome Web Store blocker pass. The companion went from 14 to 18 tests during the audit. `docs/SETUP.md` still says "94 tests" in its Tests section. That number is left over from an earlier pass and is stale.

---

## Pass 0 — Research and architecture (2026-09-16; research-doc Phases 0–3)

**Output:** `universal-ai-context-assistant-research.md`, which then served as the build spec.

**The core product rule.** Content capture and indexing happen entirely on-device. Only the minimum retrieved context is ever sent to an AI model, and the user chooses whether that model is local or remote. The rest of the architecture exists to protect that guarantee.

**Decisions made, and why:**

| Decision | Alternatives rejected | Reasoning recorded in the research doc |
|---|---|---|
| Manifest V3 | MV2 | MV2 is deprecated across Chromium. MV3 is the only forward-compatible target. |
| WXT as the extension framework | Plasmo, hand-rolled MV3 config | Simpler configuration and better MV3-native developer experience for this project. Younger ecosystem, but actively maintained. |
| IndexedDB with brute-force cosine search | SQLite (`sql.js`/OPFS), DuckDB-WASM, a WASM vector DB, Chroma, LanceDB | Browser-native, no WASM binary to ship, no bundle-size or CSP friction. Brute force is fast enough at MVP scale (thousands of chunks). SQLite and DuckDB add bundle size and startup cost for relational features the simple source → chunk → embedding model does not need. Chroma and LanceDB need a server or native process, so they only fit a future desktop companion. `hnswlib-wasm` is the documented upgrade path past roughly 50k chunks. |
| Adapter pattern (`SourceAdapter`) | One monolithic extractor | Each site's DOM changes independently. Isolating breakage to one adapter keeps a WhatsApp DOM change from breaking generic page Q&A. |
| Universal schema: Source → StructuredDocument → Chunks | Per-source pipelines | Lets WhatsApp messages, article paragraphs and PDF pages flow through one RAG pipeline. |
| Provider abstraction (`AIProvider`, later also `EmbeddingProvider`) | Hard-coding one model vendor | The orchestrator never imports a concrete provider. That makes local and remote models swappable and keeps "free tier changed" from being an architecture problem. |
| Three privacy modes (A fully local, B local data + remote AI, C user-configurable) | A single cloud mode | Mode B ships first because usable in-browser local generation was judged not good enough yet. Mode A had to remain available for anyone unwilling to accept any provider's terms. |
| Side panel as primary UI, popup as entry point | Popup only | `chrome.sidePanel` stays open across navigation. A popup cannot. |
| `activeTab` plus on-demand host permissions | `<all_urls>` at install | Least privilege. Becomes important again in the audit (CMP-01). |
| Tauri for the eventual desktop companion | Electron | Smaller binary, lower RAM, strong OS API access. Bound to `localhost` only. |
| No backend | Hosted service | Not needed for the MVP. Any future backend must be separately justified. |

**Honest constraints recorded up front** (and kept in later docs):

- "Works on any platform" is not achievable. The L1–L7 capability matrix and honest fallback UX were declared to be the product, not a workaround.
- WhatsApp Web is virtualized, class-obfuscated, changes without notice, and has ToS language against automated access. It was deliberately kept as one adapter among several, not the flagship.
- Cross-origin iframes, closed Shadow DOM, canvas-rendered text and DRM content are browser security boundaries (L7). They are never attempted.
- Prompt injection can be mitigated but not solved for any LLM system. The design rule is structural channel separation (SYSTEM / USER QUESTION / `<untrusted_context>`) and no model-triggered tools.

---

## Pass 1 — MVP build: adapters, RAG pipeline, providers (research-doc Phase 4)

**Built** (per `docs/ARCHITECTURE.md` and `docs/LIMITATIONS.md`):

- WXT + React + TypeScript + Tailwind MV3 extension with background service worker, content script, side panel and popup.
- `genericWebAdapter.ts` (L1): DOM extraction that strips nav, header, footer and ads, and keeps headings, paragraphs and lists in document order.
- `selectionAdapter.ts` (L3): universal fallback via `window.getSelection()`.
- Processing: `clean.ts` (whitespace and entity normalization, boilerplate lines) and `chunk.ts` (paragraph- and heading-aware, about 300–500 tokens with overlap, no mid-sentence splits).
- Storage: `db.ts` on the `idb` package with stores `sources`, `documents`, `chunks`, `embeddings`, `sessions`, `conversations`, `messages`. `vectorStore.ts` does brute-force cosine top-k.
- Embeddings: `hashingEmbeddingProvider` (deterministic feature hashing, 256 dimensions, no network) as the zero-setup default.
- Generation: `extractiveLocalProvider` as the zero-setup default. It returns top excerpts, labelled in the UI as "Basic local mode — no AI model configured", not as a generated answer. `GeminiProvider` and `OpenAICompatibleProvider` (OpenAI, OpenRouter, Groq, or Ollama's OpenAI-compatible endpoint) take a user-supplied key.
- `promptTemplate.ts#buildPrompt` as the single place a prompt is assembled, with a mandatory test suite (`promptTemplate.test.ts`) proving system instructions stay byte-for-byte intact and injected text stays inside the fence.
- `orchestrator.ts` and `retrieve.ts`, which import only the provider interfaces.
- Citations: every chunk carries a source anchor. `CitationLink.tsx` and the anchor resolver (`anchorResolver.test.ts`) map answers back to the source.

**Learned:**

- The hashing provider makes the whole pipeline run with no network and no API key. That turned out to be valuable for testing and for an honest zero-install mode. It is lexical, not semantic, and misses synonyms and paraphrases. The docs say so.
- Gemini and OpenAI-compatible providers were code-complete but never exercised against the real APIs in this environment (no API key available). `LIMITATIONS.md` still labels them "Implemented, not network-verified here".

---

## Pass 2 — Advanced sources: WhatsApp, PDF, local files, sessions, settings (research-doc Phase 5)

**Built:**

- `whatsappAdapter.ts` (L2, **Experimental**): row-based extraction against documented WhatsApp Web conventions (`[data-id]` rows, `.copyable-text[data-pre-plain-text]`, `.message-in`/`.message-out`), media-placeholder detection, and a virtualization-aware `collectRecentMessages()` that re-parses and de-duplicates by `data-id` between caller-supplied scroll and wait steps, which makes it unit-testable in jsdom. Also `extractLinksFromMessages()`, `extractDateMentions()` and `toConversationTimelineDocument()`. Chunking reuses the unmodified `chunkDocument()` rather than duplicating it.
- `pdfAdapter.ts` (L5): real pdf.js parsing of file bytes. Each page becomes a "Page N" heading block plus paragraph block, so the page number lands in each chunk's `sourceAnchor.headingPath` with no change to the `Chunk` schema. Title/Author metadata and Link annotations are extracted. Tested against a real PDF generated at test time with `pdf-lib`. Nothing is mocked.
- `localFileAdapter.ts` (L5): `.txt`, `.md`, `.csv` (a small hand-written RFC-4180-style parser), `.json` (flattened to `path: value` lines, which retrieve better than raw JSON syntax), and `.pdf` via the PDF adapter. `.docx` throws an explicit "Planned, not implemented" error rather than faking extraction.
- Research sessions: `createSession`, `addSourceToSession` (idempotent), `removeSourceFromSession`, and `sessionRetrieve()` scoped through the same `retrieveTopK` path. `askQuestion({ sessionId })`. UI in `SessionPanel.tsx`.
- Settings as a WXT options page (`entrypoints/options/`, `SettingsForm.tsx`). The options page was chosen over a side-panel tab because WXT wires it with zero configuration and the side panel was already dense. API keys are masked and stored only in `chrome.storage.local`, never `sync`.

**Decisions:**

- The PDF and local-file adapters are deliberately async and therefore do not literally implement `SourceAdapter`'s synchronous `extractCurrentPage` signature. They emit the same `StructuredDocument` schema, which is what the pipeline depends on. This is documented as intentional.
- WhatsApp is labelled Experimental, not Implemented, because it was proven only against a hand-built fixture (`tests/fixtures/whatsapp-fixture.html`), never a live `web.whatsapp.com` session.

---

## Pass 3 — Mode A: local inference wiring (research-doc Phase 6)

**Built:**

- `transformersEmbeddingProvider.ts`: real neural embeddings (`Xenova/all-MiniLM-L6-v2`, 384 dimensions), opt-in and runtime-selectable.
- `ollamaProvider.ts`: real local generation through a user-installed Ollama daemon's native `POST {baseUrl}/api/generate` (default `http://localhost:11434`). It goes through `buildPrompt`, with prior history folded ahead of the template. If the daemon is unreachable it throws an actionable error ("Ollama not reachable at http://localhost:11434 — install Ollama and pull a model...") instead of silently falling back.
- `providerSelection.ts`: `selectEmbeddingProvider()` and `selectAIProvider()`, called fresh on every ask and every ingestion. Under `privacyMode === 'A'` it can only return `extractiveLocalProvider` or `OllamaProvider`, even if stale `providerKind: 'gemini'` and `apiKey` values remain in storage.
- Settings UI defense in depth: under Mode A the generation dropdown is filtered to local-only options, and a previously selected remote provider is force-reset.
- `PrivacyIndicator.tsx` distinguishes four Mode A states (zero-install fallback, local embeddings only, local generation only, both), because "Mode A is active" alone would conflate a hashing+extractive fallback with a real neural pipeline.
- Host permission `http://localhost/*`, added solely so the background worker can reach the user's own Ollama daemon.

**Bug class prevented by design:** retrieval is scoped to the active embedding model's `modelId`. Hashing vectors (256-dim) and MiniLM vectors (384-dim) are not comparable, so mixing them would produce meaningless scores. Sources indexed under another model simply do not match until re-captured.

**Learned / limits:**

- "Local" for Ollama means no cloud provider is contacted. The model does not run inside the extension, and cannot. Ollama is a separate process the user installs. Ollama may also need `OLLAMA_ORIGINS=chrome-extension://*` for CORS. That requirement is documented in `SETUP.md` but was not separately verified.
- The real Hugging Face model download was attempted and **blocked** by the sandbox network policy (`Forbidden access to file: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json"`; `curl: (56) CONNECT tunnel failed, response 403`). No real neural embedding vector has been produced in this environment. Wiring is proven only against a mocked `pipeline()`.
- No Ollama daemon exists in this environment. The HTTP contract is proven against a mocked daemon (`ollamaProvider.test.ts`), but real generation has not been exercised.
- Build effect: bundling the transformers runtime glue into the MV3 service worker grew `background.js` from about 427 KB to about 1.26 MB, because service workers cannot reliably code-split with dynamic `import()`.

---

## Pass 4 — Production hardening and the desktop companion (research-doc Phases 8 and 7)

**Extension hardening** (the research doc's Phase 8 list): error handling and messaging (`errors.ts`, including `IndexCorruptedError`), onboarding (`Onboarding.tsx`, persisted completion, replayable from Settings), diagnostics (`diagnostics.ts` ring buffer of the last 50 events with latency, shown in `Diagnostics.tsx`, format structurally unable to hold page text), command palette (Ctrl/Cmd+K), keyboard shortcuts (`open-assistant` Ctrl/Cmd+Shift+E, `ask-about-selection` Ctrl/Cmd+Shift+Y), the "Context in use" transparency panel, citation click-through, and batched embedding with yields between batches.

**Performance measured** (`tests/unit/performance.test.ts`, synthetic 50-page-equivalent document of about 25,000 words): clean 3.8 ms, chunk into 100 chunks 15.3 ms, hashing-embed 100 chunks 13.6 ms. Under 35 ms end to end. Transformers.js inference latency is unmeasured because the model download is blocked.

**Desktop companion** (`desktop-companion/`, research Phase 7), built for the first time:

- Two crates on purpose. `core` (`lensight-companion-core`) has no GUI dependency and compiles and tests anywhere. `src-tauri` (`lensight-companion`) needs a native webview toolkit. The split is what allowed the GUI-free logic to be compiled and tested in a sandbox that cannot build the GUI. The workspace sets `default-members = ["core"]`.
- Ollama health check: real HTTP GET of `{base_url}/api/tags`, 2 s timeout, three explicit outcomes (`Reachable`/`Unreachable`/`NotRunning`), tested against real ephemeral local servers including connection-refused and HTTP 500 cases.
- Local HTTP API (`axum`) bound to `127.0.0.1:47291` only, never `0.0.0.0`: `GET /health` and `POST /ocr`.
- OCR is an explicit stub that always returns `501` with `"status": "not_implemented", "text": null`. It never fabricates text.
- Native file-picker contract types whose filter list matches `localFileAdapter.ts` exactly (no `.docx`). The real `tauri-plugin-dialog` implementation is Experimental and has never run.
- 14 core tests passed at the end of this phase.

**Learned:** the extension does not call the companion yet. `ollamaProvider.ts` still talks to Ollama directly. The companion is ready for future wiring but is not integrated, and the docs say so.

---

## Pass 5 — UI/UX QA pass

Every interactive element was re-traced end to end. Real gaps found and fixed (from `docs/LIMITATIONS.md` → UI):

- **Dead keyboard shortcut.** `ask-about-selection` (Ctrl/Cmd+Shift+Y) only opened the panel and never captured. Fixed with `src/core/pendingAction.ts`: the command handler queues a short-lived (15 s) "extract-selection" request in `chrome.storage.local`, and the side panel consumes it once. The time-window logic is unit-tested (`pendingAction.test.ts`).
- **Unreachable data controls.** `exportAllData`, `importData`, `deleteAllData` and `deleteSession` existed as tested `db.ts` functions with no UI path, even though `IndexCorruptedError` told users to "use 'Delete all data' in Settings". A Settings → Data section (Export, Import, Delete all data with confirmation) and a per-session Delete button were added.
- **Guaranteed-failure option.** The file picker offered `.docx`, which always throws "Planned". It was removed from the `accept` list.
- Save button now shows a disabled "Saving…" state during the write. The plaintext API key input is cleared right after save, so only a "key configured" indicator survives reload.
- Typography normalized to one `text-xs`/`text-sm` scale (two stray `text-[Npx]` values removed). Dark mode is consistent through Tailwind `dark:` variants with `darkMode: 'media'`.
- The command palette was confirmed to dispatch to the same real handlers as the quick-action bar, not a decorative copy.

**Learned:** a feature that exists in tested library code but has no UI path is not shipped. The QA pass found several such dead ends, which motivated the full audit.

---

## Pass 6 — Full audit and remediation (2026-09-24)

**Method:** baseline recorded with real output → evidence-based issue registry built before any fix → root-cause fixes with tests, red-checked against a snapshot of the original code where testable → real-browser verification in the sandbox's pre-installed Chromium 1194 → full re-test. Constraints: no tests disabled, no `@ts-ignore` or `eslint-disable` added, no new silent `catch`.

**Result:** **52 issues found** (0 P0, 9 P1, 21 P2, 22 P3). **44 fixed**, 6 deferred, 1 won't-fix, 1 not reproducible. All 9 P1s and 20 of 21 P2s fixed. Tests 130 → 221 (18 → 26 files). axe-core violating nodes 12 → 0. Companion tests 14 → 18. For the first time the extension was loaded and exercised in a real Chromium, including the e2e smoke test.

### P1 findings (all fixed)

| ID | What was wrong | Root cause | Fix | Proof |
|---|---|---|---|---|
| **FUN-01** | Every local file import on Chrome was indexed as the literal text `[object Object]`. | File bytes were sent as a raw `ArrayBuffer` through `chrome.runtime.sendMessage`, which JSON-serializes it to `{}`. | Base64 transport (`src/core/messaging/binary.ts`), 25 MB cap, and a validator that rejects the raw-buffer shape. | `messaging.test.ts`. In real Chromium the original build ingested `[object Object]` and the fixed build ingests the file text. |
| **SEC-02** | Mode A ("nothing ever leaves the device") could send the prompt and page chunks to a remote host. | Ollama URL was `ollamaBaseUrl ?? baseUrl`. With `ollamaBaseUrl` unset, a stale OpenAI-compatible `baseUrl` was used. With it blank, a relative `/api/generate` was called and Ollama never worked. | Only `ollamaBaseUrl` is used (default localhost). In Mode A, non-loopback URLs are refused with `ModeAViolationError` before any request (`providerSelection.ts`, `net/loopback.ts`). | `providerSecurity.test.ts`. The red test captured the request going to `https://openrouter.ai/api/v1/api/generate`. |
| **FUN-02** | "Current source only" restricted nothing. Every question searched every source ever captured, and in Mode B unrelated chunks went to the remote provider. | `ask()` never sent `sourceIds`. | `resolveAskScope()` (`messaging/scope.ts`). The background now rejects unscoped asks. | `messaging.test.ts`. In real Chromium the original accepted an unscoped ask and the fixed build returns the scope error. |
| **SEC-01** | The background router accepted any message from any context with no runtime validation. A content script in a web page's renderer could trigger `EXPORT_DATA` or `DELETE_ALL_DATA`. | The listener ignored `sender` and trusted TypeScript types at runtime. | Sender must be `chrome-extension://<id>/…`, plus per-field validation of every message (`messaging/validate.ts`). | `messaging.test.ts` (content-script sender rejected, malformed shapes rejected). |
| **SEC-03** | Prompt-fence escaping could be bypassed. | Only two exact lowercase strings were escaped. | NFKC normalization, invisible-character stripping, escaping of any case, whitespace, `_`/`-`, attribute, full-width and homoglyph spelling of the fence tags, defanging of fake `[chunk_id:]` and SYSTEM lines, and escaping of question fences (`promptTemplate.ts`). | `promptTemplateAdversarial.test.ts`, 19 tests. 15 behavioral failures on the original code. |
| **CMP-01** | The manifest contradicted SECURITY.md and PRIVACY.md ("no `<all_urls>`"): a static content script matched every site. | `entrypoints/content.ts` declared `matches: ['<all_urls>']`. | `registration: 'runtime'` with on-demand `scripting.executeScript` under `activeTab`, idempotent via WXT `ctx.onInvalidated`, and an actionable `TabAccessDeniedError`. The built manifest has no content-script entry. | `messaging.test.ts`. In real Chromium there is no receiver before injection, and double injection yields one working listener. |
| **CMP-02** | `scripting` permission declared but unused. | No caller existed. | Now used by CMP-01. Every permission is justified in `wxt.config.ts` comments and the PRIVACY.md table. | Code search and built manifest. |
| **CMP-03** | The Transformers.js option could not work in the packaged extension. | The custom CSP lacked `'wasm-unsafe-eval'`, and ONNX Runtime fetched its `.wasm` from `cdn.jsdelivr.net`, which counts as remote code. | CSP adds `'wasm-unsafe-eval'`. ORT `.wasm` is packaged under `ort/`. `configureTransformersEnv()` sets local paths and a single thread. | In real Chromium the original CSP produced `CompileError … neither 'wasm-eval' nor 'unsafe-eval'`, and the fixed build compiled the packaged WASM. |
| **A11Y-01** | "Import file…" could not be reached by keyboard. | It was a `<label>` around a `display:none` input. | A real `<button>` opens a ref'd input (`ContextPanel.tsx`). | `uiAccessibility.test.tsx`, red on the original. |

### Selected P2/P3 findings (all fixed unless noted)

- **SEC-04:** the word-based token estimate let whitespace-free text form unbounded chunks. A 200k-character blob used to become one chunk. Now capped by characters (`MAX_UNIT_CHARS` 3,000, overlap 600) and prompts are capped at 4,000 characters per chunk with a `[truncated]` marker.
- **SEC-05 (pdf.js CVE-2024-4367 / GHSA-wgrm-67xf-hhpq):** `pdfjs-dist` 3.11.174 was used with the default `isEvalSupported: true`. Mitigated by setting `isEvalSupported: false` and `enableXfa: false`, adding a 2,000-page cap, and recording only http(s) link annotations (`pdfAdapterSafety.test.ts`). Fully resolved later by upgrading (Pass 7).
- **SEC-06:** the Gemini API key travelled in a `?key=` URL query and was also stored in error details. It now goes in the `x-goog-api-key` header.
- **SEC-07:** hidden DOM text, a prompt-injection vector, was captured, because the visibility check ran on a detached clone (where it never fires) and ignored ancestors. It now uses live-DOM `checkVisibility()` and an ancestor walk. In real Chromium, `display:none` and stylesheet-hidden payloads were excluded.
- **SEC-08:** Settings saved any URL string, so a plain `http://` remote endpoint would have received the Bearer key in plaintext. Now validated by `validateEndpointSettings()`. Verified on the real options page.
- **SEC-09 (doc correction):** SECURITY.md said the key was "background only". `chrome.storage.local` is readable by every extension context, including the content script. The exposure was narrowed by CMP-01.
- **FUN-03:** tabs open before install or update had no content script ("Receiving end does not exist"). Fixed by on-demand injection.
- **FUN-04:** ingestion stored the source and chunks before embedding with no rollback, which left orphaned, unsearchable sources. `ingestDocument()` (`rag/ingest.ts`) now rolls back on failure and rejects empty documents.
- **FUN-05:** `sidePanel.open` was called after an `await`, which loses the user gesture, and pending actions were missed when the panel was already open. Now opened synchronously, with a subscription. Gesture behavior is not browser-verified.
- **FUN-06:** nested blocks (`pre>code`, inline `code`, `li>p`) were emitted twice. Descendants of captured blocks are now skipped.
- **FUN-07:** Enter bypassed the disabled Ask button and caused duplicate concurrent asks. Now guarded, and IME-safe.
- **FUN-08 / FUN-09:** a storage read failure left a permanently blank side panel, and Settings load, save and clear had no error handling. Both now show visible `role=alert` messages.
- **PERF-01:** the "yield between batches" was `await Promise.resolve()`, a microtask, so queued message events could never interleave, contrary to what PERFORMANCE.md claimed. Replaced with a real macrotask yield (`scheduler.yield` → MessageChannel → `setTimeout`) in `embedBatches.ts`. Measured cost: 13.0 → 18.6 ms for 100 hashing embeddings, from single noisy runs.
- **DATA-01:** `importData` trusted `JSON.parse` output. In real Chromium the original produced "Cannot read properties of undefined (reading 'map')". Now `validateDataExport()` runs before any write.
- **DATA-02 / DATA-03 / DATA-04:** `deleteSource` left dangling session ids; `fromCharCode` broke astral entities and hex entities were ignored; the diagnostics get→set race dropped events. All fixed.
- **A11Y-02 to A11Y-06:** command palette made a proper modal combobox/listbox with focus trap and restore; unnamed controls labelled; errors and answers announced via live regions; muted text contrast raised from 2.56:1 and 3.75:1 to 4.76:1 and 6.96:1 across 22 class strings; `aria-expanded` added.
- **CMP-04 (doc correction):** docs claimed a wired "PDF browser-viewed URL" path. `extractFromUrl()` exists but no UI calls it, and Chrome's PDF viewer cannot be scripted. Docs corrected.
- **C-FUN-01 (companion):** the webview's health fetch was blocked by CSP `connect-src` and missing CORS. CORS was added for Tauri origins only, with preflight, and the CSP was updated. The CSP half cannot be build-verified here.
- **C-SEC-01 (companion):** no Host validation, leaving the API open to DNS rebinding. Non-loopback `Host` headers now get 421.

### Not fixed in the audit

- DEP-01 (production CVEs) needed breaking upgrades and was deferred to Pass 7.
- CMP-05 (no hosted privacy policy) needed a publishing decision.
- PERF-03 (brute-force retrieval, full-table `getStorageUsage`) is documented MVP design with no measured problem.
- DATA-05 (vectors stored as `number[]`) needs an IndexedDB schema migration.
- UX-02 (one `model` field shared across providers) needs a schema/UX change.
- CODE-05 (no ESLint configured) is a tooling decision.
- Won't fix: CODE-06, helpers with no production caller (`collectRecentMessages`, `extractDateMentions`, `toConversationTimelineDocument`, `extractFromUrl`). They are tested library functions, and the docs now say they are not wired.
- Not reproducible: PERF-04. No MutationObservers exist.

**Audit release decision at the time:** personal unpacked use GO (conditional on one manual headed-browser check). Chrome Web Store NO-GO pending DEP-01, a hosted privacy policy, the CDN string in `background.js`, and headed-browser verification.

**Learned:**

- Writing a failing test against a snapshot of the original code before fixing gave evidence that each fix addressed the real defect. For example, 9/9 provider-security tests and 15 behavioral adversarial tests failed on the original.
- Three of the worst bugs (FUN-01, SEC-02, FUN-02) were invisible to the existing unit suite. They only showed up at boundaries between contexts (serialization), between settings fields (fallback chains), or between UI and background (missing parameters).
- Documentation had drifted from code in several places (SEC-09, CMP-01, CMP-04, PERF-01). Correcting the docs was treated as a fix in its own right.

---

## Pass 7 — Chrome Web Store blocker resolution (2026-10-05)

**DEP-01, resolved:**

- `pdfjs-dist` 3.11.174 → **6.4.299**. The vulnerable eval glyph path, and the `isEvalSupported` option the 3.x mitigation relied on, no longer exist upstream. `pdfAdapterSafety.test.ts` now asserts the installed version is ≥ 4.2.67 and that the shipped build has no eval glyph compiler. `enableXfa: false`, `disableFontFace: true` and `useSystemFonts: false` are still passed. pdf.js 6.x worker code is loaded lazily and installed as `globalThis.pdfjsWorker`, so parsing runs in-thread inside the MV3 service worker, which has no Web Worker and forbids runtime `import()`.
- `@xenova/transformers` 2.17.2 → **`@huggingface/transformers` 4.3.0** (`dtype: 'q8'`). `onnxruntime-web/webgpu` is aliased to the CPU-only `onnxruntime-web/wasm` bundle, which embeds its loader. A single binary ships: `ort/ort-wasm-simd-threaded.wasm` (14.26 MB), run single-threaded. Package total went from 20.77 MB to 16.84 MB.
- `npm audit --omit=dev`: **9 (2 critical, 7 high) → 0**.
- `npm run build` no longer emits any `eval` warning. `background.js` contains no `eval(` and no `new Function(`. The only `Function("return this")` left is core-js's `globalThis` fallback, which is never reached in a service worker.
- `background.js` grew to about 2.33 MB because pdf.js's worker module is now bundled for in-thread parsing.
- Tests: 221 → 224, all passing.

**CDN string in the bundle, root cause and fix:** the audit had left a literal `cdn.jsdelivr.net` URL in `background.js`. It was the library's default `wasmPaths` value. It was overridden at runtime and never fetched, but a store static scan could flag it as remote code. Instead of relying on the runtime override, `wxt.config.ts` now strips the default from the library source before bundling (`stripTransformersCdnDefault`) and **fails the build** if `cdn.jsdelivr.net` appears in any emitted file (`assertNoCdnInBundle`). A negative build proved the guard trips: `assert-no-cdn-in-bundle: "cdn.jsdelivr.net" found in emitted background.js` (`dep01-logs/negative-build.txt`).

**Real-browser verification** (Chromium 1194, `dep01-logs/verify-dep01.log`, 5/5): the extension loads; the packaged WASM compiles under the CSP; a two-page PDF parses in the real service worker with pdf.js 6.x; Transformers.js v4 with packaged ORT embeds a document in the service worker using a tiny synthetic BERT-shaped model; and the only external requests were the four model-file URLs on huggingface.co, with none to any JS CDN. axe-core re-run: 0 violating nodes across 7 audits. e2e smoke: 1 passed.

**Privacy policy:** `docs/PRIVACY_POLICY.md` was written as a submission-ready, user-facing policy. It covers per-mode data flows, exactly what a remote request contains, the third-party provider table, Limited Use, the permission table, user controls and children's privacy. Publisher name and contact email remain `[placeholders]`.

**Learned:** for a store review, "overridden at runtime" is weaker evidence than "absent from the bundle, and the build fails if it returns". The fix that worked removed the string at the source and made the build guard it.

---

## Pass 8 — Rename to Lensight (2026-10-05)

- The working title "Universal AI Context Assistant" became **Lensight**. Package name `lensight` v0.1.0; manifest name "Lensight"; commands described as "Open the Lensight side panel"; companion crates renamed to `lensight-companion-core` and `lensight-companion`.
- The research doc and remediation report keep the old name, with a dated note at the top, because they are historical artifacts.
- The project directory is still named `ai-context-assistant/`.
- The research doc required a trademark and store-name conflict check before any final name. No record of that check exists in the project artifacts, so it should be treated as outstanding.

---

## Still unresolved, deferred, or unverified

| Item | Status | Why | Next step |
|---|---|---|---|
| Manual headed-browser check of the `activeTab` grant, toolbar icon → side panel → Capture, Ctrl/Cmd+Shift+Y, Ctrl/Cmd+Shift+E, and the `chrome://` error | **Outstanding** | Headless automation cannot click the toolbar icon or fire browser commands. Everything after the grant was verified with a test-only host permission. | Run the checklist in `docs/STORE_SUBMISSION.md` once in headed Chrome and record the Chrome version. |
| Hosting the privacy policy and filling its placeholders; CWS dashboard disclosures | **Outstanding (needs a person)** | Requires a publishing decision. | See `docs/STORE_SUBMISSION.md`. |
| Real Transformers.js model download and inference quality | **Unverified** | The sandbox blocks huggingface.co (403 at the proxy). Only a synthetic model has run. | Run once with network access. |
| Real Ollama generation | **Unverified** | No Ollama daemon is available. The contract is tested against a mock. | Run against a local Ollama install. |
| Gemini and OpenAI-compatible providers against real APIs | **Unverified** | No API key in the environment. | Test with a real key. |
| WhatsApp Web adapter | **Experimental** | Fixture-only. Never run against live `web.whatsapp.com`. Selectors can break without notice. ToS risk disclosed. | Live verification and a self-test loop. |
| Tauri GUI shell | **Does not compile here** | Missing `gdk-3.0`/webkit2gtk system libraries. The file picker and the CSP change are therefore never exercised. No packaged binary was attempted. | Build on a machine with Tauri's system prerequisites. |
| Extension → companion integration | **Planned** | `ollamaProvider.ts` talks to Ollama directly. | Wire a companion-aware path. |
| OCR (scanned PDFs, canvas content) | **Planned** | Explicit stub in the companion. pdf.js yields little or no text for image-only PDFs. | — |
| `.docx` import | **Planned** | No lightweight, reliable pure-JS extractor was added. | — |
| Gmail, Google Docs, LinkedIn, YouTube adapters | **Planned** | Later phases in the research doc. | — |
| Mode C "mix per source" | **Not built** | Modes B and C behave identically in code today. | — |
| Tailwind CSS 4 migration | **Deferred** | 5 high `braces` advisories in dev/build tooling only. The only fix is a breaking CSS migration that changes class semantics and palette. | Treat as a separate UI change, re-checked with axe. |
| ESLint (CODE-05) | **Deferred** | Tooling decision. | Add `eslint` + `react-hooks`. |
| Component tests for `SettingsForm`, `PrivacyIndicator`, `Onboarding`, `Diagnostics` | **Deferred** | Covered by axe and real-browser checks only. | Extend `uiAccessibility.test.tsx`. |
| `cargo audit` | **Not run** | Not installed in the environment. | Install and run a RustSec scan. |
| DATA-05, UX-02, PERF-03 | **Deferred** | Schema migrations or not needed at MVP scale. | Bundle with the next IndexedDB migration. |
| Stale "94 tests" in `docs/SETUP.md` | **Doc drift** | Left over from an earlier pass. | Update to 224. |
