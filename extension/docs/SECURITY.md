# Security

## Threat table

| Threat | Mitigation in this codebase | Residual risk |
|---|---|---|
| Prompt injection via malicious page content ("ignore previous instructions...") | `src/core/security/promptTemplate.ts` structurally separates SYSTEM / USER QUESTION / `<untrusted_context>` channels. Untrusted text is NFKC-normalized, stripped of invisible format characters, and every fence-like tag spelling (any case, whitespace, `_`/`-`, attributes, full-width forms, common Cyrillic/Greek homoglyphs) is escaped; fake `[chunk_id: …]` labels and SYSTEM / USER QUESTION headers are defanged; each chunk is capped at 4,000 chars (audit SEC-03/SEC-04). Hidden DOM text (`display:none`, `visibility:hidden`, `hidden`, `opacity:0`) is no longer captured (audit SEC-07). See `tests/unit/promptTemplate.test.ts` (mandatory) and `tests/unit/promptTemplateAdversarial.test.ts`. | A sufficiently novel injection could still degrade answer *quality* (e.g. a wrong summary) — not eliminable for any LLM-based system, only mitigated. |
| Untrusted content triggering an unauthorized action | No tool-calling/agent action is wired to any provider's output in this MVP. `AIProvider.generate()` returns only a string answer + chunk IDs — nothing executes based on model output. | Low — no autonomous action path exists in this codebase at all. |
| Leaked API key | Keys are stored in `chrome.storage.local` and only *used* by the background worker (or `process.env` in Node/tests) — never a literal string in any provider file. Never `chrome.storage.sync`, never logged. Gemini's key is sent in the `x-goog-api-key` header, not a `?key=` URL query (audit SEC-06). Settings refuses a plain-`http://` remote base URL, so a key is never sent unencrypted (audit SEC-08). **Correction (audit SEC-09):** earlier text said "background only" — `chrome.storage.local` is readable by any of this extension's contexts, including its content script; since the audit the content script is only present in tabs the user explicitly invoked the extension on. | Local device compromise (malware), or a renderer exploit in a tab where the content script is injected, could read local storage — out of scope for an extension to fully prevent. |
| XSS via rendered content/answers | UI components render text via JSX text children (React escapes by default) — no `dangerouslySetInnerHTML` anywhere in `src/ui`. | Low. |
| Remotely hosted code | All code, including the ONNX Runtime WASM binary, ships in the package. The Transformers.js CDN fallback is stripped from the bundle at build time, and the build fails if `cdn.jsdelivr.net` appears in any emitted file (`wxt.config.ts`, DEP-01). The only remote fetch the optional embedding feature makes is the model weights (data) from huggingface.co. | — |
| Vulnerable dependencies | DEP-01 (2026-10-05): `npm audit --omit=dev` reports 0 advisories. Five high-severity advisories remain in dev/build tooling only: `braces` via Tailwind CSS 3 (build-time glob matching; never shipped). | Tailwind 4 migration still pending. See STORE_SUBMISSION.md. |
| Excessive permissions | Manifest requests only `storage`, `activeTab`, `sidePanel`, `scripting` (`wxt.config.ts`, each justified there and in PRIVACY.md) — no `tabs`/`history`/`webRequest`. **Correction (audit CMP-01/CMP-02):** before the audit the content script was a static manifest entry matching `<all_urls>` (injected into every site) and `scripting` was declared but unused. It is now registered at runtime and injected on demand with `chrome.scripting.executeScript` under the `activeTab` grant; the built manifest has `"content_scripts": []`. One narrow host permission, `http://localhost/*`, exists solely so the background worker can reach a user's own local Ollama daemon. | Capture needs the user to invoke the extension on the tab first (toolbar icon or shortcut) — a deliberate least-privilege trade-off. |
| Messages from untrusted contexts | The background router accepts messages only from this extension's own pages (`sender.url` must be `chrome-extension://<id>/…`) and validates every field at runtime (`src/core/messaging/validate.ts`, audit SEC-01) — a content script living in a web page's renderer can no longer trigger `EXPORT_DATA`/`DELETE_ALL_DATA`/etc. | — |
| Malicious PDF | **Updated (DEP-01, 2026-10-05):** upgraded from `pdfjs-dist@3.11.174` (affected by GHSA-wgrm-67xf-hhpq / CVE-2024-4367) to `pdfjs-dist@6.4.299`. The vulnerable eval glyph path, and with it the `isEvalSupported` option the 3.x mitigation relied on, no longer exists upstream. `tests/unit/pdfAdapterSafety.test.ts` asserts that the installed version is ≥ 4.2.67 and that the shipped build has no `isEvalSupported`/eval glyph compiler. `enableXfa: false`, `disableFontFace: true` and `useSystemFonts: false` are still passed, only http(s) link annotations are recorded, pages are capped at 2,000 (audit SEC-05), and the extension CSP blocks JS eval. `npm run build` no longer emits a pdf.js `eval` warning. | Parsing runs in the background service worker's own thread (no Web Worker is available there), so a pathological PDF can still slow that worker until the page cap is reached. |
| Mode A data leaving the device | `providerSelection.ts` uses only `ollamaBaseUrl` for Ollama (never the OpenAI-compatible `baseUrl`) and, in Mode A, refuses any non-loopback Ollama URL before a request is made (audit SEC-02 — previously a stale remote `baseUrl` could receive the prompt and retrieved chunks). | — |
| IndexedDB read by another script | Browser's own per-extension-origin isolation for `chrome.storage`/IndexedDB. | OS-level malware with browser-profile access — accepted residual risk, disclosed. |

## Prompt injection defense — the core design rule

`buildPrompt(userQuestion, untrustedChunks, systemPromptOverride?)` in
`src/core/security/promptTemplate.ts` is the **only** place a prompt is
assembled. It:

1. Always emits the fixed `BASE_SYSTEM_PROMPT` (or an explicit override) as
   the system channel — never derived from page/chunk content.
2. Places the user's literal question in a `USER QUESTION:` line, sourced
   only from the input box (callers must never pass page-derived text as
   `userQuestion`).
3. Wraps every retrieved chunk in a single `<untrusted_context>...
   </untrusted_context>` fence, explicitly instructing the model to treat
   that block as data, never as instructions — even if it contains phrases
   like "ignore previous instructions" or fake "SYSTEM:" lines.
4. Neutralizes fence markers found *inside* untrusted chunk text — any
   spelling a model would read as the same tag (case, whitespace, `_`/`-`,
   attributes, NFKC-folded full-width forms, invisible characters inside the
   marker, common homoglyphs) — so a malicious chunk cannot forge a fake
   fence boundary and "close" the untrusted block early. (Before audit
   SEC-03 only the two exact lowercase strings were escaped.)
5. Caps each untrusted chunk at `MAX_UNTRUSTED_CHUNK_CHARS` (4,000) with an
   explicit `[truncated]` marker, and defangs lines imitating the template's
   own `[chunk_id: …]` labels or SYSTEM / USER QUESTION headers.

`tests/unit/promptTemplate.test.ts` is the mandatory test suite proving:
- the real system instructions remain byte-for-byte unmodified in the
  assembled prompt regardless of injected chunk content;
- injected text always stays positioned between the real fence markers;
- a chunk containing the literal fence-marker strings cannot create extra,
  fake fence boundaries (asserted by counting fence-marker occurrences);
- the user-question channel contains exactly what was passed in, positioned
  before the untrusted content.

No individual provider (`geminiProvider.ts`, `openAICompatibleProvider.ts`,
`extractiveLocalProvider.ts`) concatenates retrieved chunk text into a
prompt itself outside of `buildPrompt` — `geminiProvider` and
`openAICompatibleProvider` both call it explicitly before making any network
request.
