import { describe, expect, it } from 'vitest';
import { HashingEmbeddingProvider, embedTextSync } from '../../src/core/ai/embeddings/hashingEmbeddingProvider';
import { cosineSimilarity } from '../../src/core/storage/vectorStore';

describe('HashingEmbeddingProvider', () => {
  it('produces a unit-length (L2-normalized) vector for non-empty text', () => {
    const v = embedTextSync('The quick brown fox jumps over the lazy dog');
    let norm = 0;
    for (let i = 0; i < v.length; i += 1) norm += v[i] * v[i];
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it('returns a zero vector for empty text without throwing', () => {
    const v = embedTextSync('');
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it('is deterministic: same text always yields the same vector', () => {
    const a = embedTextSync('local first privacy preserving assistant');
    const b = embedTextSync('local first privacy preserving assistant');
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('ranks a semantically/lexically similar short text above a dissimilar one', () => {
    const query = 'What is the best way to brew coffee at home?';
    const similar = 'Brewing great coffee at home requires fresh beans and the right water temperature.';
    const dissimilar = 'The stock market fell sharply today amid concerns about interest rates.';

    const qv = embedTextSync(query);
    const sv = embedTextSync(similar);
    const dv = embedTextSync(dissimilar);

    const simScore = cosineSimilarity(qv, sv);
    const disScore = cosineSimilarity(qv, dv);

    expect(simScore).toBeGreaterThan(disScore);
  });

  it('ranks multiple candidates correctly for a topical query (retrieval-style check)', () => {
    const query = 'javascript array methods for filtering and mapping data';
    const candidates = [
      { id: 'js', text: 'JavaScript arrays support methods like map, filter, and reduce for transforming data.' },
      { id: 'cooking', text: 'To bake a good sourdough loaf you need a well-fed starter and a hot oven.' },
      { id: 'weather', text: 'Tomorrow will be partly cloudy with a high chance of rain in the afternoon.' },
    ];

    const qv = embedTextSync(query);
    const scored = candidates
      .map((c) => ({ id: c.id, score: cosineSimilarity(qv, embedTextSync(c.text)) }))
      .sort((a, b) => b.score - a.score);

    expect(scored[0].id).toBe('js');
  });

  it('EmbeddingProvider.embed returns one vector per input text, matching dimensions', async () => {
    const provider = new HashingEmbeddingProvider(128);
    const vectors = await provider.embed(['hello world', 'goodbye world']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0].length).toBe(128);
    expect(vectors[1].length).toBe(128);
  });
});
