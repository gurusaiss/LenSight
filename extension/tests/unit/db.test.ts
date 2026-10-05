import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DB_NAME,
  addEmbeddings,
  addSource,
  deleteAllData,
  deleteSource,
  exportAllData,
  getAllSources,
  getChunksBySource,
  getStorageUsage,
  importData,
  resetDBHandleForTests,
} from '../../src/core/storage/db';

beforeEach(async () => {
  // fake-indexeddb persists data across tests within the same process
  // (unlike a real per-test-run browser profile), so each test must start
  // from a clean database, not just a reset in-memory handle.
  await resetDBHandleForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

async function seedOneSource() {
  return addSource(
    {
      sourceType: 'generic-web',
      url: 'https://example.com/article',
      title: 'Example Article',
      capabilityLevel: 1,
      adapterUsed: 'genericWebAdapter',
      capturedAt: Date.now(),
      confidence: 'high',
    },
    {
      title: 'Example Article',
      text: 'Full cleaned text of the article.',
      metadata: { url: 'https://example.com/article', title: 'Example Article' },
    },
    [
      { text: 'First chunk of the article.', position: 0 },
      { text: 'Second chunk of the article.', position: 1 },
    ],
  );
}

describe('IndexedDB storage (db.ts) — uses fake-indexeddb for node test env', () => {
  it('addSource stores a source, document, and its chunks together', async () => {
    const { source, chunks } = await seedOneSource();
    expect(source.id).toBeTruthy();
    expect(chunks).toHaveLength(2);

    const stored = await getChunksBySource(source.id);
    expect(stored).toHaveLength(2);
  });

  it('getAllSources returns previously added sources', async () => {
    await seedOneSource();
    const sources = await getAllSources();
    expect(sources.length).toBe(1);
  });

  it('addEmbeddings + getStorageUsage reflects counts correctly', async () => {
    const { chunks } = await seedOneSource();
    await addEmbeddings(
      chunks.map((c) => ({ chunkId: c.id, vector: new Float32Array([0.1, 0.2, 0.3]), embeddingModel: 'test' })),
    );
    const usage = await getStorageUsage();
    expect(usage.counts.sources).toBe(1);
    expect(usage.counts.chunks).toBe(2);
    expect(usage.counts.embeddings).toBe(2);
    expect(usage.bytesUsed).toBeGreaterThan(0);
  });

  it('deleteSource removes the source, its document, chunks, and embeddings', async () => {
    const { source, chunks } = await seedOneSource();
    await addEmbeddings(
      chunks.map((c) => ({ chunkId: c.id, vector: new Float32Array([0.1, 0.2]), embeddingModel: 'test' })),
    );

    await deleteSource(source.id);

    const sources = await getAllSources();
    expect(sources).toHaveLength(0);
    const remainingChunks = await getChunksBySource(source.id);
    expect(remainingChunks).toHaveLength(0);
  });

  it('deleteAllData wipes every store', async () => {
    await seedOneSource();
    await deleteAllData();
    const usage = await getStorageUsage();
    expect(usage.counts.sources).toBe(0);
    expect(usage.counts.chunks).toBe(0);
  });

  it('exportAllData / importData round-trips data faithfully', async () => {
    const { source } = await seedOneSource();
    const exported = await exportAllData();
    expect(exported.sources).toHaveLength(1);

    await deleteAllData();
    let usage = await getStorageUsage();
    expect(usage.counts.sources).toBe(0);

    await importData(exported);
    usage = await getStorageUsage();
    expect(usage.counts.sources).toBe(1);
    const sources = await getAllSources();
    expect(sources[0].id).toBe(source.id);
  });

  it('importData rejects an unsupported export version', async () => {
    const bad = { ...(await exportAllData()), version: 99 as any };
    await expect(importData(bad)).rejects.toThrow(/Unsupported export version/);
  });
});
