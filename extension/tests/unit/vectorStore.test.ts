import { describe, expect, it } from 'vitest';
import { cosineSimilarity, searchVectors } from '../../src/core/storage/vectorStore';
import type { Chunk } from '../../src/core/types';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('returns 0 (not NaN) when one vector is all zeros', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('searchVectors (top-k retrieval)', () => {
  function makeChunk(id: string, text: string): Chunk {
    return { id, documentId: 'doc_1', sourceId: 'src_1', text, position: 0 };
  }

  it('returns the top-k highest scoring chunks in descending order', () => {
    const chunkById = new Map<string, Chunk>([
      ['a', makeChunk('a', 'exact match')],
      ['b', makeChunk('b', 'somewhat related')],
      ['c', makeChunk('c', 'totally unrelated')],
    ]);
    const candidates = [
      { chunkId: 'a', vector: [1, 0, 0] },
      { chunkId: 'b', vector: [0.7, 0.7, 0] },
      { chunkId: 'c', vector: [0, 0, 1] },
    ];
    const results = searchVectors([1, 0, 0], candidates, chunkById, 2);
    expect(results).toHaveLength(2);
    expect(results[0].chunk.id).toBe('a');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('skips candidates whose chunk is missing from chunkById (e.g. deleted chunk)', () => {
    const chunkById = new Map<string, Chunk>([['a', makeChunk('a', 'present')]]);
    const candidates = [
      { chunkId: 'a', vector: [1, 0] },
      { chunkId: 'ghost', vector: [1, 0] },
    ];
    const results = searchVectors([1, 0], candidates, chunkById, 5);
    expect(results).toHaveLength(1);
    expect(results[0].chunk.id).toBe('a');
  });

  it('respects topK even when there are more candidates than requested', () => {
    const chunkById = new Map<string, Chunk>();
    const candidates = [];
    for (let i = 0; i < 10; i += 1) {
      chunkById.set(`c${i}`, makeChunk(`c${i}`, `chunk ${i}`));
      candidates.push({ chunkId: `c${i}`, vector: [Math.random(), Math.random()] });
    }
    const results = searchVectors([1, 0], candidates, chunkById, 3);
    expect(results).toHaveLength(3);
  });
});
