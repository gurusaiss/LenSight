/**
 * Pluggable embedding provider abstraction. The RAG pipeline (retrieve.ts)
 * only ever imports this interface, never a concrete implementation directly.
 */
export interface EmbeddingProvider {
  name: string;
  /** Stable identifier stored alongside vectors so an index can be rebuilt
   * cleanly if the embedding model ever changes. */
  modelId: string;
  dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
