import type { EmbeddingProvider } from '../ai/embeddings/EmbeddingProvider';
import { getSession } from '../storage/db';
import { retrieveTopK, type RetrievedChunk } from '../storage/vectorStore';

export const DEFAULT_TOP_K = 5;

/**
 * Embeds the user's query with the active EmbeddingProvider and retrieves the
 * top-k most similar chunks from the local vector store.
 */
export async function retrieveRelevantChunks(
  query: string,
  embeddingProvider: EmbeddingProvider,
  topK: number = DEFAULT_TOP_K,
  opts?: { sourceIds?: string[] },
): Promise<RetrievedChunk[]> {
  const [queryVector] = await embeddingProvider.embed([query]);
  // Always scope candidates to the active embedding provider's model id —
  // see vectorStore.ts's retrieveTopK doc comment for why comparing vectors
  // across different embedding models would silently produce meaningless
  // scores rather than an honest "no match yet under this model".
  return retrieveTopK(queryVector, topK, { ...opts, embeddingModel: embeddingProvider.modelId });
}

/**
 * Multi-tab / research-session retrieval (Phase 5): retrieves the top-k
 * chunks across every source that has been added to the given session,
 * rather than a single current source. This is the only difference from
 * `retrieveRelevantChunks` — same embedding + cosine-similarity path,
 * just scoped to `session.sourceIds` instead of a single source's chunks.
 *
 * Returns an empty array (rather than throwing) for an unknown session id,
 * since "no session" and "empty session" should both just mean "no context".
 */
export async function sessionRetrieve(
  query: string,
  embeddingProvider: EmbeddingProvider,
  sessionId: string,
  topK: number = DEFAULT_TOP_K,
): Promise<RetrievedChunk[]> {
  const session = await getSession(sessionId);
  if (!session || session.sourceIds.length === 0) return [];
  return retrieveRelevantChunks(query, embeddingProvider, topK, { sourceIds: session.sourceIds });
}
