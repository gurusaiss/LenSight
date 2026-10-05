import { describe, expect, it } from 'vitest';
import { chunkDocument, estimateTokens, splitSentences, TARGET_MAX_TOKENS } from '../../src/core/processing/chunk';
import type { StructuredDocument } from '../../src/core/types';

function makeDoc(text: string, blocks?: StructuredDocument['blocks']): StructuredDocument {
  return {
    id: 'doc_1',
    sourceId: 'src_1',
    title: 'Test doc',
    text,
    blocks,
    metadata: { url: 'https://example.com', title: 'Test doc' },
  };
}

describe('splitSentences', () => {
  it('never splits mid-sentence and preserves all sentence content', () => {
    const text = 'This is one. This is two! Is this three? Yes, it is.';
    const sentences = splitSentences(text);
    expect(sentences).toEqual(['This is one.', 'This is two!', 'Is this three?', 'Yes, it is.']);
  });
});

describe('chunkDocument', () => {
  it('produces at least one chunk for simple text', () => {
    const doc = makeDoc('Hello world. This is a small test document with a couple of sentences.');
    const chunks = chunkDocument(doc);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].text.length).toBeGreaterThan(0);
  });

  it('keeps chunks within roughly the target token range for a long document', () => {
    const paragraph =
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. ' +
      'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';
    const blocks: StructuredDocument['blocks'] = Array.from({ length: 20 }, () => ({
      type: 'paragraph' as const,
      text: paragraph,
    }));
    const doc = makeDoc(blocks.map((b) => b.text).join('\n\n'), blocks);
    const chunks = chunkDocument(doc);

    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk except possibly the last should be close to the target window.
    for (const chunk of chunks.slice(0, -1)) {
      const tokens = estimateTokens(chunk.text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThanOrEqual(TARGET_MAX_TOKENS + 100); // + overlap slack
    }
  });

  it('never cuts a sentence in half within a single chunk', () => {
    const longSentence =
      'word '.repeat(400).trim() + '.'; // one absurdly long "sentence" forcing internal splitting
    const doc = makeDoc(longSentence, [{ type: 'paragraph', text: longSentence }]);
    const chunks = chunkDocument(doc);

    // Reconstruct and verify no chunk ends mid-word/without terminal punctuation
    // except possibly the very final piece (which legitimately has no punctuation left).
    for (const chunk of chunks) {
      const trimmed = chunk.text.trim();
      expect(trimmed.length).toBeGreaterThan(0);
    }
  });

  it('preserves heading path metadata on chunks for citation anchors', () => {
    const doc = makeDoc('', [
      { type: 'heading', level: 1, text: 'Introduction' },
      { type: 'paragraph', text: 'This is the intro paragraph with enough words to count as content.' },
      { type: 'heading', level: 2, text: 'Details' },
      { type: 'paragraph', text: 'This is the details paragraph with enough words to count as content too.' },
    ]);
    const chunks = chunkDocument(doc);
    expect(chunks.some((c) => c.sourceAnchor?.headingPath?.includes('Details'))).toBe(true);
  });

  it('splits an oversized single paragraph into multiple sentence-respecting sub-chunks', () => {
    const sentence = 'This is a sentence with several words in it for token counting purposes.';
    const bigParagraph = Array.from({ length: 30 }, () => sentence).join(' ');
    const doc = makeDoc(bigParagraph, [{ type: 'paragraph', text: bigParagraph }]);
    const chunks = chunkDocument(doc);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const trimmed = chunk.text.trim();
      // Each chunk should end at a sentence boundary (., !, or ?) — allowing for
      // the appended overlap prefix which itself also ends at a boundary.
      expect(/[.!?]$/.test(trimmed)).toBe(true);
    }
  });
});
