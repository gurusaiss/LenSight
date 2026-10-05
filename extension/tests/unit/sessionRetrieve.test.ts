import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DB_NAME,
  addEmbeddings,
  addSource,
  addSourceToSession,
  createSession,
  getSession,
  removeSourceFromSession,
  resetDBHandleForTests,
} from '../../src/core/storage/db';
import { sessionRetrieve } from '../../src/core/rag/retrieve';
import type { EmbeddingProvider } from '../../src/core/ai/embeddings/EmbeddingProvider';

beforeEach(async () => {
  await resetDBHandleForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

/** Deterministic 1-D "embedding" for testing: encodes each text's leading
 * number as its vector, so cosine similarity ranking is fully predictable
 * without depending on the real hashing embedding provider's behavior. */
const numericEmbeddingProvider: EmbeddingProvider = {
  name: 'test-numeric',
  modelId: 'test-numeric-v1',
  dimensions: 1,
  async embed(texts: string[]) {
    return texts.map((t) => {
      const n = parseFloat(t) || 0;
      return new Float32Array([n]);
    });
  },
};

async function seedSource(id: string, chunkTexts: string[]) {
  const { chunks } = await addSource(
    {
      id,
      sourceType: 'generic-web',
      url: `https://example.com/${id}`,
      title: id,
      capabilityLevel: 1,
      adapterUsed: 'genericWebAdapter',
      capturedAt: Date.now(),
      confidence: 'high',
    },
    { title: id, text: chunkTexts.join(' '), metadata: { url: `https://example.com/${id}`, title: id } },
    chunkTexts.map((text, i) => ({ text, position: i })),
  );
  await addEmbeddings(
    chunks.map((c) => ({ chunkId: c.id, vector: new Float32Array([parseFloat(c.text)]), embeddingModel: 'test-numeric-v1' })),
  );
  return chunks;
}

describe('sessionRetrieve — cross-source retrieval scoped to a research session', () => {
  it('retrieves top-k chunks across every source added to the session, not just one', async () => {
    await seedSource('srcA', ['1', '2']);
    await seedSource('srcB', ['3', '4']);
    // A third, unrelated source that is NOT added to the session — its
    // chunks must never appear in session-scoped retrieval results.
    await seedSource('srcC', ['100']);

    const session = await createSession('Research trip');
    await addSourceToSession(session.id, 'srcA');
    await addSourceToSession(session.id, 'srcB');

    const results = await sessionRetrieve('3', numericEmbeddingProvider, session.id, 10);
    const sourceIds = new Set(results.map((r) => r.chunk.sourceId));

    expect(sourceIds.has('srcA')).toBe(true);
    expect(sourceIds.has('srcB')).toBe(true);
    expect(sourceIds.has('srcC')).toBe(false);
    expect(results.length).toBe(4); // exactly the 4 chunks from srcA+srcB, none from srcC
  });

  it('adding a source to a session is idempotent', async () => {
    await seedSource('srcA', ['1']);
    const session = await createSession('S');
    await addSourceToSession(session.id, 'srcA');
    await addSourceToSession(session.id, 'srcA');
    const reloaded = await getSession(session.id);
    expect(reloaded!.sourceIds).toEqual(['srcA']);
  });

  it('removeSourceFromSession excludes that source from later retrieval', async () => {
    await seedSource('srcA', ['1']);
    await seedSource('srcB', ['2']);
    const session = await createSession('S');
    await addSourceToSession(session.id, 'srcA');
    await addSourceToSession(session.id, 'srcB');
    await removeSourceFromSession(session.id, 'srcB');

    const results = await sessionRetrieve('1', numericEmbeddingProvider, session.id, 10);
    const sourceIds = new Set(results.map((r) => r.chunk.sourceId));
    expect(sourceIds.has('srcA')).toBe(true);
    expect(sourceIds.has('srcB')).toBe(false);
  });

  it('returns an empty array for an unknown session id rather than throwing', async () => {
    const results = await sessionRetrieve('anything', numericEmbeddingProvider, 'ses_does_not_exist', 5);
    expect(results).toEqual([]);
  });

  it('returns an empty array for a session with no sources yet', async () => {
    const session = await createSession('Empty session');
    const results = await sessionRetrieve('anything', numericEmbeddingProvider, session.id, 5);
    expect(results).toEqual([]);
  });
});
