# Performance

Measured, not assumed — every number below comes from a real test run in
this environment (`tests/unit/performance.test.ts`, `npm run test`), not an
estimate. Re-run `npx vitest run tests/unit/performance.test.ts` to
reproduce; timings will vary by machine but the shape (chunking dominates
cleaning; embedding is fast for the hashing provider) should not.

## What was measured

A synthetic "50-page-equivalent" document: ~500 words/page x 50 pages =
~25,000 words, built as 50 headed sections x 4 paragraphs each (not one
giant string), so cleaning/chunking exercise their real heading/paragraph-
aware code paths.

| Step | Real measured latency (this environment) | What it means |
|---|---|---|
| `cleanText()` (whitespace/entity normalization) | **3.8 ms** | Negligible — a single synchronous pass over the text. |
| `chunkDocument()` (paragraph/heading-aware chunking into 100 chunks) | **15.3 ms** | Well under any perceptible delay; scales roughly linearly with paragraph count, not raw character count. |
| Embedding all 100 chunks, `hashingEmbeddingProvider`, batched (24/batch) with an event-loop yield between batches | **13.6 ms** | The hashing/bag-of-words provider is pure CPU, no network, no model — this is the fast path. A real neural embedding model (Transformers.js) would be meaningfully slower per chunk (model inference, not measured here — see docs/LIMITATIONS.md for why a real Transformers.js call couldn't be exercised in this sandbox), which is exactly why batching + yielding matters more there than for hashing. |

Total for the whole synthetic-document pipeline in this pass: **under 35ms**
end-to-end (clean + chunk + embed), for a document sized to approximate 50
pages of real content. This is comfortably within "no perceptible UI stall"
territory for the current architecture and scale (MVP: a handful of active
sources, thousands of chunks — see docs/ARCHITECTURE.md's storage-engine
decision log for the scale this is designed against).

## Where the real risk is, and what was done about it

The research doc's own performance risks, addressed specifically:

1. **"Debounced/lazy extraction, not re-extracting on every DOM mutation."**
   Already true by construction, not by a debounce timer: `entrypoints/content.ts`
   only extracts when it receives an explicit `REQUEST_EXTRACT` message
   (user clicks "Capture this page"/"Capture selection", or a keyboard
   shortcut opens the panel — see docs/SETUP.md). There is no
   `MutationObserver`-driven continuous re-extraction anywhere in this
   codebase to begin with, so there is nothing to debounce — this is
   documented here rather than silently assumed, since a future adapter
   that DID add continuous DOM watching (e.g. a smarter WhatsApp adapter
   that reacts to new messages) would need to add its own debounce and
   should treat this note as the bar to preserve.

2. **"Chunking/embedding done incrementally rather than blocking the UI
   thread for large pages."** Two concrete changes landed this pass, both in
   `entrypoints/background.ts`:
   - `embedInBatches()` (now `src/core/processing/embedBatches.ts`) splits a
     document's chunk texts into batches of 24 and calls
     `embeddingProvider.embed()` per batch, yielding a **macrotask** between
     batches (`scheduler.yield()` → MessageChannel → `setTimeout(0)`).
     **Correction (audit PERF-01, 2026-09-24):** this previously awaited
     `Promise.resolve()`, which only queues a microtask; the microtask queue
     drains before the event loop runs the next task, so no other pending
     message handler could actually run between batches, contrary to what
     this section claimed. `tests/unit/ingestAndStorage.test.ts` now proves a
     queued task runs before the last batch. Measured cost of the real yield
     in the performance test: hashing-embed of 100 chunks went from 13.0 ms
     (baseline run) to 18.6 ms (post-fix run) — single runs, noisy.
   - `recordDiagnosticEvent()` calls in the ingestion/ask paths (see
     `src/core/diagnostics.ts`) now record real latency numbers
     (`latencyMs`) surfaced in the Diagnostics panel, so a real slow case in
     production is observable (average ingest/ask latency), not just
     inferred from a synthetic benchmark.
   - Note: the background service worker's own execution doesn't block the
     side panel's UI thread even without batching (they're separate
     JS contexts/processes in MV3) — the batching change specifically
     protects *other pending background-worker work* (e.g. a second
     ingestion or an ask-question call arriving while a big document is
     still embedding), which is the scenario where the research doc's
     concern actually applies in this architecture.

3. **Chunk sizing itself** (`src/core/processing/chunk.ts`) already targets
   ~300-500 tokens per chunk with ~60 tokens of overlap — this bounds the
   per-chunk embedding cost regardless of source document size; a 50-page
   document produces ~100 bounded-size chunks (see table above), not one
   enormous chunk.

## Known unmeasured cost: Transformers.js real model inference

`transformersEmbeddingProvider`'s real embedding latency (as opposed to its
wiring/contract, which IS unit tested) could not be measured in this
environment because the model download itself is blocked by this sandbox's
network policy (see docs/LIMITATIONS.md's Embeddings section for the exact
error). Real-world latency for `Xenova/all-MiniLM-L6-v2` via the packaged single-threaded WASM backend (the only ORT backend shipped since DEP-01) is
architecturally expected to be higher per chunk than the hashing provider
(it runs actual neural network inference), which is precisely why the
batching change above targets the embedding step specifically rather than
assuming the hashing provider's near-zero cost generalizes to every
embedding provider. Treat this as an explicitly deferred measurement, not a
claim that Transformers.js is equally fast.
