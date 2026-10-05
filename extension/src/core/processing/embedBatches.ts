import type { EmbeddingProvider } from '../ai/embeddings/EmbeddingProvider';

/**
 * Batched embedding with a real event-loop yield between batches (audit
 * issue PERF-01).
 *
 * The previous implementation (inlined in entrypoints/background.ts) yielded
 * with `await Promise.resolve()`. That only queues a *microtask*, and the
 * microtask queue is fully drained before the event loop picks up the next
 * *task* — so a queued `chrome.runtime.onMessage` event (another ASK_QUESTION,
 * a DELETE, …) could never run between batches, contrary to what the code
 * comment and docs/PERFORMANCE.md claimed. For the synchronous, CPU-bound
 * hashing provider that meant one long uninterrupted block per document.
 *
 * `yieldToEventLoop()` yields a macrotask instead: `scheduler.yield()` where
 * the platform has it, otherwise a MessageChannel round-trip (not subject to
 * nested-setTimeout 4ms clamping), otherwise `setTimeout(0)`.
 */
export const EMBED_BATCH_SIZE = 24;

export function yieldToEventLoop(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof sched?.yield === 'function') return sched.yield();
  if (typeof MessageChannel === 'function') {
    return new Promise<void>((resolve) => {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => {
        port1.close();
        resolve();
      };
      port2.postMessage(null);
    });
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function embedInBatches(
  embeddingProvider: EmbeddingProvider,
  texts: string[],
  batchSize: number = EMBED_BATCH_SIZE,
  yieldFn: () => Promise<void> = yieldToEventLoop,
): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vectors = await embeddingProvider.embed(batch);
    if (vectors.length !== batch.length) {
      throw new Error(
        `Embedding provider "${embeddingProvider.name}" returned ${vectors.length} vectors for ${batch.length} inputs.`,
      );
    }
    out.push(...vectors);
    if (i + batchSize < texts.length) {
      await yieldFn();
    }
  }
  return out;
}
