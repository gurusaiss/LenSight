import { BASE_SYSTEM_PROMPT } from '../security/promptTemplate';
import type { EmbeddingProvider } from '../ai/embeddings/EmbeddingProvider';
import type { AIProvider, ConversationTurn } from '../ai/providers/AIProvider';
import type { Citation } from '../types';
import { DEFAULT_TOP_K, retrieveRelevantChunks, sessionRetrieve } from './retrieve';

/**
 * Ties retrieve.ts + promptTemplate.ts (via the AIProvider, which itself
 * calls buildPrompt) + the active AIProvider together, and returns an answer
 * with resolved citations. This is the single entry point the UI/background
 * worker should call to answer a question against currently indexed sources.
 */
export interface AskResult {
  answer: string;
  citations: Citation[];
  providerName: string;
  providerMode: 'local' | 'remote';
}

export async function askQuestion(
  question: string,
  embeddingProvider: EmbeddingProvider,
  aiProvider: AIProvider,
  opts?: { sourceIds?: string[]; sessionId?: string; topK?: number; history?: ConversationTurn[] },
): Promise<AskResult> {
  const topK = opts?.topK ?? DEFAULT_TOP_K;
  // A sessionId scopes retrieval across every source in that research
  // session (Phase 5 multi-tab sessions); otherwise fall back to the
  // single-source/explicit-sourceIds behavior the MVP already had.
  const retrieved = opts?.sessionId
    ? await sessionRetrieve(question, embeddingProvider, opts.sessionId, topK)
    : await retrieveRelevantChunks(question, embeddingProvider, topK, { sourceIds: opts?.sourceIds });

  const untrustedContext = retrieved.map((r) => ({ chunkId: r.chunk.id, text: r.chunk.text }));

  const { answer, usedChunkIds } = await aiProvider.generate(
    BASE_SYSTEM_PROMPT,
    question,
    untrustedContext,
    opts?.history,
  );

  const usedSet = new Set(usedChunkIds.length > 0 ? usedChunkIds : retrieved.map((r) => r.chunk.id));
  const citations: Citation[] = retrieved
    .filter((r) => usedSet.has(r.chunk.id))
    .map((r) => ({
      chunkId: r.chunk.id,
      sourceId: r.chunk.sourceId,
      snippet: r.chunk.text.slice(0, 240),
      headingPath: r.chunk.sourceAnchor?.headingPath,
    }));

  return { answer, citations, providerName: aiProvider.name, providerMode: aiProvider.mode };
}
