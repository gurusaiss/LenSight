export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AIProviderResult {
  answer: string;
  usedChunkIds: string[];
}

/**
 * Swappable AI generation backend. The RAG orchestrator (core/rag/orchestrator.ts)
 * only ever imports this interface, never a concrete provider — implementations
 * are registered/selected by the extension's settings.
 *
 * IMPORTANT: `generate` receives already-assembled prompt *parts*, not a
 * pre-concatenated string. Providers must pass these through
 * core/security/promptTemplate.ts (or an equivalent strict template) rather
 * than concatenating `untrustedContext` directly into the instruction
 * channel — see SECURITY.md.
 */
export interface AIProvider {
  name: string;
  mode: 'local' | 'remote';
  generate(
    systemPrompt: string,
    userQuestion: string,
    untrustedContext: { chunkId: string; text: string }[],
    history?: ConversationTurn[],
  ): Promise<AIProviderResult>;
}
