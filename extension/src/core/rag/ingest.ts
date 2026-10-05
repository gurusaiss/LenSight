import type { EmbeddingProvider } from '../ai/embeddings/EmbeddingProvider';
import { ExtractionFailedError } from '../errors';
import { chunkDocument } from '../processing/chunk';
import { cleanText } from '../processing/clean';
import { embedInBatches } from '../processing/embedBatches';
import { addEmbeddings, addSource, deleteSource } from '../storage/db';
import type { CapabilityLevel, ConfidenceLevel, Source, SourceType, StructuredDocument } from '../types';

/**
 * clean -> chunk -> store -> embed ingestion for one extracted document.
 * Moved out of entrypoints/background.ts so it is unit-testable (audit
 * issue FUN-04).
 *
 * FUN-04 root cause: the source/document/chunks were written to IndexedDB
 * first and embedded afterwards, with no rollback. Any embedding failure —
 * e.g. the Transformers.js model download being blocked/offline — left a
 * source whose chunks have no embeddings: it showed up as "captured", but
 * retrieval (which scores embeddings) could never match it, silently. Now an
 * embedding/storage failure after `addSource` removes that source again
 * before the error propagates, so ingestion is all-or-nothing from the
 * user's point of view.
 */

export interface IngestMeta {
  capabilityLevel: CapabilityLevel;
  confidence: ConfidenceLevel;
  adapterUsed: string;
  sourceType?: SourceType;
}

export interface IngestResult {
  source: Source;
  chunkCount: number;
  embedLatencyMs: number;
}

export function inferSourceType(adapterUsed: string): SourceType {
  if (adapterUsed === 'selectionAdapter') return 'selection';
  if (adapterUsed === 'whatsappAdapter') return 'whatsapp';
  if (adapterUsed === 'pdfAdapter') return 'pdf';
  if (adapterUsed === 'localFileAdapter') return 'local-file';
  return 'generic-web';
}

export async function ingestDocument(
  doc: StructuredDocument,
  meta: IngestMeta,
  embeddingProvider: EmbeddingProvider,
): Promise<IngestResult> {
  const cleaned = { ...doc, text: cleanText(doc.text) };
  const rawChunks = chunkDocument({ ...cleaned, id: 'pending', sourceId: 'pending' });
  if (rawChunks.length === 0) {
    throw new ExtractionFailedError('nothing indexable was left after cleaning the captured content');
  }

  const { source, chunks } = await addSource(
    {
      sourceType: meta.sourceType ?? inferSourceType(meta.adapterUsed),
      url: cleaned.metadata.url,
      title: cleaned.title,
      capabilityLevel: meta.capabilityLevel,
      adapterUsed: meta.adapterUsed,
      capturedAt: Date.now(),
      confidence: meta.confidence,
    },
    cleaned,
    rawChunks.map((c) => ({ text: c.text, position: c.position, sourceAnchor: c.sourceAnchor })),
  );

  const embedStart = Date.now();
  try {
    const vectors = await embedInBatches(embeddingProvider, chunks.map((c) => c.text));
    await addEmbeddings(
      chunks.map((c, i) => ({ chunkId: c.id, vector: vectors[i], embeddingModel: embeddingProvider.modelId })),
    );
  } catch (err) {
    try {
      await deleteSource(source.id);
    } catch (rollbackErr) {
      // Not swallowed: surfaced to the developer console, and the ORIGINAL
      // failure (the one the user needs to act on) still propagates below.
      console.error('[ingest] rollback of partially-ingested source failed', source.id, rollbackErr);
    }
    throw err;
  }

  return { source, chunkCount: chunks.length, embedLatencyMs: Date.now() - embedStart };
}
