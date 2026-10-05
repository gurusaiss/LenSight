# Privacy

Internal architecture notes. The user-facing, submission-ready policy is
[`PRIVACY_POLICY.md`](PRIVACY_POLICY.md), which must stay consistent with this
file. Update both together.

## Data flow

Page/Selection → Content Script (extraction) → Local cleaning/chunking →
Local embeddings (`hashingEmbeddingProvider` by default) → Local IndexedDB
vector store → Local top-k retrieval → **[boundary]** → AI provider (local
extractive fallback, or a remote API you configure with only the retrieved
chunks + your question) → Answer → citations resolved locally back to chunk
IDs.

Everything left of **[boundary]** never leaves the device, in every mode.

## Modes

| Mode | Extraction | Embeddings | Vector index | Generation | What leaves the device |
|---|---|---|---|---|---|
| A — Fully local | Local | Local (`hashingEmbeddingProvider`, or `transformersEmbeddingProvider` if you opt into the model download — pick in Settings) | Local (IndexedDB) | Local (`extractiveLocalProvider` — zero-install, extractive, not a generative LLM — or `ollamaProvider`, a real generative model, if you install and run Ollama yourself) | Nothing, ever |
| B — Local data + remote AI (default once you configure a key) | Local | Local | Local | Remote API (Gemini or an OpenAI-compatible endpoint you configure) | Only the retrieved chunks (typically a few hundred to a few thousand tokens) + your question, sent directly from the extension to that provider over HTTPS |
| C — User configurable | Same as above, provider chosen in settings | — | — | — | Varies by your choice |

**Mode A is now a real, selectable mode (Phase 6), not just a documented
interface.** Selecting it in Settings restricts the "AI provider"
dropdown to local-only options — enforced both in the Settings UI and,
independently, in `src/core/ai/providerSelection.ts` at the moment a
question is actually answered, so a settings-page bug alone could never
send retrieved content to a remote provider while Mode A is selected. Three
honestly-different local combinations exist, in increasing order of setup
cost and (expected) answer quality:

1. **Zero-install fallback** — `hashingEmbeddingProvider` (deterministic
   hashing/bag-of-words, not a learned semantic embedding) +
   `extractiveLocalProvider` (returns ranked excerpts, not a generated
   answer). Always available, no download, no install.
2. **Real local embeddings, extractive generation** — opt into
   `transformersEmbeddingProvider` (`Xenova/all-MiniLM-L6-v2` via
   `@huggingface/transformers` v4, a real neural sentence embedding, one-time
   model download from Hugging Face) while generation stays extractive. The
   download is model *data* only; the ONNX Runtime WASM *code* ships inside
   the package (`ort/ort-wasm-simd-threaded.wasm`) and no JS CDN is ever
   contacted. Since DEP-01 (2026-10-05) the library's built-in CDN default is
   removed from the bundle at build time, and the build fails if
   `cdn.jsdelivr.net` appears in any emitted file (`wxt.config.ts`).
3. **Real local generation, hashing embeddings** — select `ollamaProvider`,
   which calls a locally-installed [Ollama](https://ollama.com) daemon's
   native `/api/generate` endpoint (default `http://localhost:11434`). This
   is "local" in that no cloud provider is ever contacted, but **the model
   does not run inside this browser extension** — Ollama is a separate
   process you install and run yourself; a browser extension cannot bundle
   or execute a multi-GB LLM. If Ollama isn't running, you get a clear error
   ("Ollama not reachable at http://localhost:11434 — install Ollama and
   pull a model...") rather than a silent fallback pretending to be smarter
   than it is.
4. **Both real** — Transformers.js embeddings + Ollama generation together.

**What was actually verified in this environment vs. not (see
LIMITATIONS.md for the full detail and real error text):** the real
Transformers.js model download was attempted and blocked by this sandbox's
network policy (Hugging Face's CDN was unreachable) — so real embedding
*quality* is unverified here, though the provider's wiring is proven
correct against a mocked model call. No real Ollama daemon exists in this
sandbox either — so `ollamaProvider`'s actual generation quality against a
real model is unverified here, though its HTTP request/response contract is
proven correct against a mocked daemon. Both are real, complete,
runtime-selectable code paths, not stubs — what's unverified is model
behavior in a network-restricted build environment, not the integration
code itself.

## Per-provider data handling — verify before relying on this

These are general, publicly stated positions as of the research date and
**must be re-verified against each provider's current terms before you rely
on them** — free tiers and data-use terms change without notice.

- **Google Gemini API** (used by `geminiProvider.ts`): paid/API tier
  generally stated as not used for training by default, distinct from
  Google's free consumer chat products — **verify current terms at
  https://ai.google.dev/gemini-api/terms before relying on this**.
- **OpenAI / OpenRouter / Groq / self-hosted Ollama (via its OpenAI-compatible
  endpoint)** (used by `openAICompatibleProvider.ts`): API-tier terms vary by
  provider and change — **verify each provider's current API terms before
  relying on any specific retention/training claim**. A local Ollama
  endpoint sends nothing off your machine at all.
- **Ollama (native endpoint, used by `ollamaProvider.ts`)**: this is a
  request from the extension to a process running on your own machine
  (`http://localhost:11434` by default) — no data is ever sent to any
  third-party service by this provider. The residual consideration is
  entirely local: whatever model you've pulled into Ollama runs with
  whatever resource/network access your own Ollama installation has, which
  is outside this extension's control.

We never claim "100% private" once a remote provider is active. The honest
claim: your content never leaves your device unless you explicitly
configure a remote AI provider, and even then only the minimal retrieved
context is sent — never the full page, never other tabs, never browsing
history.

## Permissions

- `storage`, `activeTab`, `sidePanel`, `scripting` only (see
  `wxt.config.ts`). No `tabs`, `history`, `bookmarks`, or `webRequest`, and
  (since the 2026-09-24 audit, CMP-01) no content script declared for
  `<all_urls>` — before the audit a static content script matched every
  site; it is now injected only into the tab you invoke the extension on.

  | Permission | Why it is needed | Code path |
  |---|---|---|
  | `storage` | Settings, onboarding/quick-action prefs, diagnostics ring buffer, keyboard-shortcut handoff | `SettingsForm.tsx`, `quickActions.ts`, `diagnostics.ts`, `pendingAction.ts` |
  | `activeTab` | One-time access to the tab you click the toolbar icon / press a shortcut on | granted by Chrome on invocation |
  | `scripting` | Inject the content script into that tab on demand | `src/core/messaging/contentScript.ts` |
  | `sidePanel` | The primary UI | `background.ts`, `popup/main.tsx` |
  | host `http://localhost/*` | Reach your own local Ollama daemon from the background worker | `ollamaProvider.ts` |
- One narrow host permission, `http://localhost/*` (added in Phase 6),
  exists solely so the background service worker can reach a user's own
  local Ollama daemon without depending on that daemon sending permissive
  CORS headers for the extension's origin. It grants nothing beyond
  `localhost` — no other host is ever requested with elevated privilege;
  remote AI providers (Gemini, OpenAI-compatible) are still called as a
  normal, un-elevated fetch using the user's own configured API key.
- No telemetry of any kind is implemented.

## User controls implemented in this MVP

- `deleteSource(sourceId)` — remove one captured source, its document,
  chunks, and embeddings.
- `deleteSession(sessionId)` — remove a session and its conversations/messages.
- `deleteAllData()` — wipes every IndexedDB store.
- `exportAllData()` / `importData()` — JSON export/import.
- `getStorageUsage()` — byte usage estimate + per-store counts.

All in `src/core/storage/db.ts`, covered by `tests/unit/db.test.ts`.
