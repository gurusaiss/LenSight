import { genericWebAdapter } from '../../src/core/adapters/genericWebAdapter';
import { cleanText } from '../../src/core/processing/clean';
import { chunkDocument } from '../../src/core/processing/chunk';

(window as any).__extractAndChunk = () => {
  const extracted = genericWebAdapter.extractCurrentPage(document);
  if (!extracted) return null;
  const cleaned = { ...extracted, text: cleanText(extracted.text) };
  const chunks = chunkDocument({ ...cleaned, id: 'doc_test', sourceId: 'src_test' });
  return {
    title: cleaned.title,
    blockCount: cleaned.blocks?.length ?? 0,
    chunkCount: chunks.length,
    firstChunkText: chunks[0]?.text ?? null,
  };
};
