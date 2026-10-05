import { describe, expect, it } from 'vitest';
import { chunkDocument } from '../../src/core/processing/chunk';
import { cleanText } from '../../src/core/processing/clean';
import { hashingEmbeddingProvider } from '../../src/core/ai/embeddings/hashingEmbeddingProvider';
import { EMBED_BATCH_SIZE, embedInBatches } from '../../src/core/processing/embedBatches';
import type { DocumentBlock, StructuredDocument } from '../../src/core/types';

/**
 * Performance pass (Phase 8): measures actual latency for the two
 * potentially-blocking steps the research doc calls out — chunking and
 * embedding — against a synthetic "50-page-equivalent" document, and logs
 * the real numbers (also written to docs/PERFORMANCE.md, not invented).
 *
 * "50-page-equivalent" is approximated as ~500 words/page (a common rough
 * estimate for a standard document page) * 50 pages = ~25,000 words, built
 * as many distinct paragraphs (not one giant string) so chunking exercises
 * its normal heading/paragraph-aware path realistically.
 */

const WORDS_PER_PAGE = 500;
const PAGES = 50;
const PARAGRAPHS_PER_PAGE = 4;

function buildSyntheticDocument(): StructuredDocument {
  const blocks: DocumentBlock[] = [];
  const wordsPerParagraph = Math.floor(WORDS_PER_PAGE / PARAGRAPHS_PER_PAGE);
  const lexicon = [
    'system', 'architecture', 'privacy', 'local', 'retrieval', 'embedding', 'chunk', 'provider',
    'extension', 'document', 'source', 'index', 'vector', 'model', 'context', 'session', 'citation',
    'adapter', 'security', 'storage', 'browser', 'content', 'question', 'answer', 'user', 'data',
  ];
  let wordSeed = 0;
  const nextWord = () => lexicon[(wordSeed++) % lexicon.length];

  for (let page = 1; page <= PAGES; page += 1) {
    blocks.push({ type: 'heading', level: 1, text: `Section ${page}` });
    for (let p = 0; p < PARAGRAPHS_PER_PAGE; p += 1) {
      const words: string[] = [];
      for (let w = 0; w < wordsPerParagraph; w += 1) words.push(nextWord());
      blocks.push({ type: 'paragraph', text: `${words.join(' ')}.` });
    }
  }

  return {
    id: 'doc_perf',
    sourceId: 'src_perf',
    title: 'Synthetic 50-page document',
    text: blocks.map((b) => b.text).join('\n\n'),
    blocks,
    metadata: { url: 'https://example.com/synthetic', title: 'Synthetic 50-page document' },
  };
}

describe('performance: large synthetic document (~50 pages, ~25,000 words)', () => {
  it('cleans + chunks the whole document well under a blocking-UI threshold', () => {
    const doc = buildSyntheticDocument();
    const wordCount = doc.text.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeGreaterThan(20000);

    const cleanStart = performance.now();
    const cleaned = { ...doc, text: cleanText(doc.text) };
    const cleanMs = performance.now() - cleanStart;

    const chunkStart = performance.now();
    const chunks = chunkDocument(cleaned);
    const chunkMs = performance.now() - chunkStart;

    // eslint-disable-next-line no-console
    console.log(
      `[performance] 50-page synthetic doc (${wordCount} words): clean=${cleanMs.toFixed(1)}ms, ` +
        `chunk=${chunkMs.toFixed(1)}ms, chunks=${chunks.length}`,
    );

    expect(chunks.length).toBeGreaterThan(10);
    // Generous ceilings (this is a correctness/regression guard, not a strict
    // benchmark assertion — real hardware varies) — chunking ~25k words
    // synchronously should complete in well under a second on any modern
    // machine; if this regresses to multiple seconds, that IS the kind of
    // blocking-the-UI-thread risk the research doc calls out.
    expect(cleanMs).toBeLessThan(1000);
    expect(chunkMs).toBeLessThan(2000);
  });

  it('embeds all resulting chunks (hashing provider) in batches, measuring total latency', async () => {
    const doc = buildSyntheticDocument();
    const cleaned = { ...doc, text: cleanText(doc.text) };
    const chunks = chunkDocument(cleaned);

    const embedStart = performance.now();
    // The real production function (src/core/processing/embedBatches.ts),
    // not an inline re-implementation of it (audit CODE-04), including its
    // real macrotask yield between batches (audit PERF-01).
    const vectors = await embedInBatches(hashingEmbeddingProvider, chunks.map((c) => c.text));
    const embedded = vectors.length;
    const embedMs = performance.now() - embedStart;

    // eslint-disable-next-line no-console
    console.log(
      `[performance] embedded ${embedded} chunks (hashing provider, batches of ${EMBED_BATCH_SIZE}) in ${embedMs.toFixed(1)}ms`,
    );

    expect(embedded).toBe(chunks.length);
    expect(embedMs).toBeLessThan(3000);
  });
});
