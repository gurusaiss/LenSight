import type { AIProvider, AIProviderResult } from './AIProvider';

/**
 * DEFAULT no-network fallback provider.
 *
 * "Basic Local Mode — no AI model configured." This provider does NOT call
 * any language model, local or remote. It performs no generation at all —
 * it simply returns the most relevant retrieved chunks (already ranked by
 * the retrieval step) as an extractive "answer", clearly labeled as such,
 * so the full pipeline (adapters -> processing -> storage -> RAG -> prompt
 * template -> provider -> citations) works completely offline with zero
 * setup, before a user has configured any real AI provider.
 *
 * This must never be presented in the UI as if it were a full LLM answer —
 * see PrivacyIndicator.tsx / ChatBox.tsx, which surface this provider's name
 * and a "Basic local mode" label whenever it is active.
 */
export class ExtractiveLocalProvider implements AIProvider {
  name = 'extractive-local';
  mode: 'local' = 'local';

  async generate(
    _systemPrompt: string,
    userQuestion: string,
    untrustedContext: { chunkId: string; text: string }[],
    _history?: { role: 'user' | 'assistant'; text: string }[],
  ): Promise<AIProviderResult> {
    if (untrustedContext.length === 0) {
      return {
        answer:
          'Basic local mode — no AI model configured. No relevant content was found for this question in the ' +
          'currently indexed source(s).',
        usedChunkIds: [],
      };
    }

    const top = untrustedContext.slice(0, 3);
    const body = top
      .map((c, i) => `${i + 1}. ${c.text.trim()} [${c.chunkId}]`)
      .join('\n\n');

    const answer =
      `Basic local mode — no AI model configured. Showing the most relevant excerpts for ` +
      `"${userQuestion.trim()}" (no summarization/generation has been applied):\n\n${body}`;

    return { answer, usedChunkIds: top.map((c) => c.chunkId) };
  }
}

export const extractiveLocalProvider = new ExtractiveLocalProvider();
