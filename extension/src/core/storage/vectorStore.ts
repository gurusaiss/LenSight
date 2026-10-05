import { getAllChunks, getAllEmbeddings } from './db';
import type { Chunk } from '../types';

/**
 * Brute-force cosine-similarity vector search over embeddings stored in
 * IndexedDB, per the spec's storage decision (no HNSW/FAISS/WASM ANN library
 * needed at MVP scale — thousands, not millions, of chunks).
 */

export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface RetrievedChunk {
  chunk: Chunk;
  score: number;
}

/** Pure function version for unit testing without touching IndexedDB. */
export function searchVectors(
  queryVector: Float32Array | number[],
  candidates: { chunkId: string; vector: number[] }[],
  chunkById: Map<string, Chunk>,
  topK: number,
): RetrievedChunk[] {
  const scored = candidates
    .map((c) => ({ chunk: chunkById.get(c.chunkId), score: cosineSimilarity(queryVector, c.vector) }))
    .filter((r): r is RetrievedChunk => !!r.chunk);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/** Reads all chunks/embeddings from IndexedDB and returns the top-k matches.
 *
 * `opts.embeddingModel`, when given, restricts candidates to embeddings
 * computed by that exact model id. This matters once embedding provider
 * selection is a runtime choice (see core/ai/providerSelection.ts): if a
 * source was indexed with `hashing-bow-v1` and the user later switches to
 * `transformers-all-MiniLM-L6-v2` (or vice versa), the two vector spaces are
 * not comparable — a raw cosine similarity between them is meaningless, not
 * just "different in quality". Filtering by model avoids silently returning
 * wrong-looking-but-plausible results across incompatible embedding spaces;
 * the honest behavior is "no match for this source under the current
 * embedding model" until it is re-captured. */
export async function retrieveTopK(
  queryVector: Float32Array | number[],
  topK: number,
  opts?: { sourceIds?: string[]; embeddingModel?: string },
): Promise<RetrievedChunk[]> {
  const [chunks, embeddings] = await Promise.all([getAllChunks(), getAllEmbeddings()]);
  const allowedSourceIds = opts?.sourceIds ? new Set(opts.sourceIds) : null;
  const chunkById = new Map<string, Chunk>();
  for (const chunk of chunks) {
    if (allowedSourceIds && !allowedSourceIds.has(chunk.sourceId)) continue;
    chunkById.set(chunk.id, chunk);
  }
  const candidates = embeddings.filter(
    (e) => chunkById.has(e.chunkId) && (!opts?.embeddingModel || e.embeddingModel === opts.embeddingModel),
  );
  return searchVectors(queryVector, candidates, chunkById, topK);
}
