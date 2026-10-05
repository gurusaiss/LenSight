import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DB_NAME,
  addSource,
  addSourceToSession,
  createSession,
  deleteSource,
  exportAllData,
  getAllSources,
  getSession,
  getStorageUsage,
  importData,
  resetDBHandleForTests,
} from '../../src/core/storage/db';
import { validateDataExport } from '../../src/core/storage/validateExport';
import { ingestDocument } from '../../src/core/rag/ingest';
import { embedInBatches, yieldToEventLoop } from '../../src/core/processing/embedBatches';
import { hashingEmbeddingProvider } from '../../src/core/ai/embeddings/hashingEmbeddingProvider';
import type { EmbeddingProvider } from '../../src/core/ai/embeddings/EmbeddingProvider';
import type { StructuredDocument } from '../../src/core/types';
import { freshActionFromRecord } from '../../src/core/pendingAction';

beforeEach(async () => {
  await resetDBHandleForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

function makeDoc(paragraphs: number): StructuredDocument {
  const para = 'Local-first assistants keep extraction and indexing on the device before any network call happens. ';
  return {
    id: '',
    sourceId: '',
    title: 'Doc',
    text: '',
    blocks: Array.from({ length: paragraphs }, () => ({ type: 'paragraph' as const, text: para.repeat(12) })),
    metadata: { url: 'https://example.com/doc', title: 'Doc' },
  };
}

const failingProvider: EmbeddingProvider = {
  name: 'failing',
  modelId: 'failing-v1',
  dimensions: 3,
  async embed() {
    throw new Error('Forbidden access to file: "https://huggingface.co/.../tokenizer.json"');
  },
};

describe('FUN-04: ingestion is all-or-nothing', () => {
  it('stores source, chunks, and one embedding per chunk on success', async () => {
    const { source, chunkCount } = await ingestDocument(
      makeDoc(4),
      { capabilityLevel: 1, confidence: 'high', adapterUsed: 'genericWebAdapter' },
      hashingEmbeddingProvider,
    );
    expect(source.sourceType).toBe('generic-web');
    const usage = await getStorageUsage();
    expect(usage.counts.chunks).toBe(chunkCount);
    expect(usage.counts.embeddings).toBe(chunkCount);
  });

  it('rolls back the source and its chunks when embedding fails (no orphan, unsearchable source)', async () => {
    await expect(
      ingestDocument(makeDoc(4), { capabilityLevel: 1, confidence: 'high', adapterUsed: 'genericWebAdapter' }, failingProvider),
    ).rejects.toThrow(/Forbidden access/);
    const usage = await getStorageUsage();
    expect(usage.counts.sources).toBe(0);
    expect(usage.counts.documents).toBe(0);
    expect(usage.counts.chunks).toBe(0);
    expect(usage.counts.embeddings).toBe(0);
  });

  it('refuses to create an empty, unaskable source', async () => {
    const empty: StructuredDocument = { ...makeDoc(0), text: '   ', blocks: [] };
    await expect(
      ingestDocument(empty, { capabilityLevel: 1, confidence: 'high', adapterUsed: 'genericWebAdapter' }, hashingEmbeddingProvider),
    ).rejects.toThrow(/nothing indexable/);
    expect(await getAllSources()).toHaveLength(0);
  });
});

describe('PERF-01: embedInBatches yields a real macrotask between batches', () => {
  it('reproduces the old bug: `await Promise.resolve()` never lets a queued task run', async () => {
    let taskRan = false;
    setTimeout(() => {
      taskRan = true;
    }, 0);
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
    expect(taskRan).toBe(false);
  });

  it('lets a queued task (e.g. another onMessage event) run before the whole document finishes', async () => {
    let taskRan = false;
    let taskRanBeforeLastBatch = false;
    let batches = 0;
    const provider: EmbeddingProvider = {
      name: 'probe',
      modelId: 'probe',
      dimensions: 1,
      async embed(texts) {
        batches += 1;
        if (batches === 3 && taskRan) taskRanBeforeLastBatch = true;
        return texts.map(() => new Float32Array([1]));
      },
    };
    setTimeout(() => {
      taskRan = true;
    }, 0);
    const out = await embedInBatches(provider, Array.from({ length: 30 }, (_, i) => `t${i}`), 10, () =>
      new Promise<void>((r) => setTimeout(r, 0)),
    );
    expect(out).toHaveLength(30);
    expect(taskRanBeforeLastBatch).toBe(true);
  });

  it('the default yieldToEventLoop also yields a macrotask', async () => {
    let taskRan = false;
    setTimeout(() => {
      taskRan = true;
    }, 0);
    // A MessageChannel/scheduler yield can resolve before a 0ms timer fires,
    // so yield a few times — the point is that it is a task boundary at all.
    for (let i = 0; i < 20 && !taskRan; i += 1) await yieldToEventLoop();
    expect(taskRan).toBe(true);
  });

  it('fails loudly if a provider returns the wrong number of vectors', async () => {
    const bad: EmbeddingProvider = { name: 'bad', modelId: 'bad', dimensions: 1, embed: async () => [new Float32Array([1])] };
    await expect(embedInBatches(bad, ['a', 'b'])).rejects.toThrow(/returned 1 vectors for 2 inputs/);
  });
});

describe('DATA-01: import validation', () => {
  it('rejects files missing required arrays with an actionable message (was: TypeError on .map)', async () => {
    await expect(importData({ version: 1 } as any)).rejects.toThrow(/missing "sources" array/);
  });

  it('rejects records without their key field before any write happens', async () => {
    const exported = await exportAllData();
    const bad = { ...exported, sources: [{ title: 'no id' }] };
    await expect(importData(bad as any)).rejects.toThrow(/sources\[0\] is malformed/);
    expect(await getAllSources()).toHaveLength(0);
  });

  it('rejects embeddings that reference chunks not present in the file', () => {
    const r = validateDataExport({
      version: 1, exportedAt: 1, sources: [], documents: [], chunks: [], sessions: [], conversations: [], messages: [],
      embeddings: [{ chunkId: 'chk_missing', vector: [0.1], embeddingModel: 'm' }],
    });
    expect(r.ok).toBe(false);
  });

  it('drops unknown extra properties instead of persisting them', () => {
    const r = validateDataExport({
      version: 1, exportedAt: 1, documents: [], chunks: [], embeddings: [], sessions: [], conversations: [], messages: [],
      sources: [{ id: 's', sourceType: 'generic-web', url: 'u', title: 't', capabilityLevel: 1, adapterUsed: 'a', capturedAt: 1, confidence: 'high', evil: '<script>' }],
    });
    expect(r.ok).toBe(true);
    expect(r.ok && (r.data.sources[0] as any).evil).toBeUndefined();
  });
});

describe('DATA-02: deleting a source also removes it from research sessions', () => {
  it('leaves no dangling source id in any session', async () => {
    const { source } = await addSource(
      { sourceType: 'generic-web', url: 'u', title: 't', capabilityLevel: 1, adapterUsed: 'genericWebAdapter', capturedAt: 1, confidence: 'high' },
      { title: 't', text: 'x', metadata: { url: 'u', title: 't' } },
      [{ text: 'x', position: 0 }],
    );
    const session = await createSession('research');
    await addSourceToSession(session.id, source.id);
    await deleteSource(source.id);
    expect((await getSession(session.id))?.sourceIds).toEqual([]);
  });
});

describe('FUN-05: pending side-panel action record narrowing', () => {
  it('accepts only a fresh, known action', () => {
    const now = 1_000_000;
    expect(freshActionFromRecord({ action: 'extract-selection', requestedAt: now - 1000 }, now)).toBe('extract-selection');
    expect(freshActionFromRecord({ action: 'extract-selection', requestedAt: now - 60_000 }, now)).toBeNull();
    expect(freshActionFromRecord({ action: 'delete-everything', requestedAt: now }, now)).toBeNull();
    expect(freshActionFromRecord('extract-selection', now)).toBeNull();
  });
});
