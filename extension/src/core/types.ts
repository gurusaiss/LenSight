/**
 * Core data model for Lensight.
 *
 * This mirrors the "Data Model" section of the research/architecture spec:
 * Source -> Document -> Chunk -> Embedding, plus Session/Conversation/Message/Citation
 * and provider/privacy configuration types.
 *
 * Kept dependency-free (no DOM, no browser APIs) so it can be imported from
 * content scripts, the background service worker, the side panel UI, and tests
 * without pulling in anything environment-specific.
 */

/** Capability levels from the research doc's Platform Capability Matrix. */
export type CapabilityLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Source types the MVP (and documented future work) can produce. Only 'generic-web'
 * and 'selection' are actually implemented in this MVP; the rest are reserved for
 * later phases and must never be silently treated as implemented. */
export type SourceType =
  | 'generic-web'
  | 'selection'
  | 'whatsapp'
  | 'gmail'
  | 'pdf'
  | 'local-file';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** Privacy modes A/B/C, as defined in the Privacy Architecture section. */
export type PrivacyMode = 'A' | 'B' | 'C';

/** One captured origin: a page, a selection, (later) a chat/pdf/file. */
export interface Source {
  id: string;
  sourceType: SourceType;
  url: string;
  title: string;
  capabilityLevel: CapabilityLevel;
  adapterUsed: string;
  capturedAt: number; // epoch ms
  confidence: ConfidenceLevel;
}

export interface SourceMetadata {
  url: string;
  title: string;
  author?: string;
  timestamps?: { capturedAt: number; publishedAt?: number };
  participants?: string[];
}

/** The structured, normalized content extracted from a Source, before chunking. */
export interface StructuredDocument {
  id: string;
  sourceId: string;
  title: string;
  /** Cleaned, normalized full text (headings/paragraphs preserved as plain text with
   * blank-line separation so downstream chunking can be heading/paragraph aware). */
  text: string;
  /** Optional structural blocks retained for smarter chunking (headings vs paragraphs). */
  blocks?: DocumentBlock[];
  metadata: SourceMetadata;
  links?: string[];
}

export interface DocumentBlock {
  type: 'heading' | 'paragraph' | 'list-item' | 'code';
  level?: number; // for headings: 1-6
  text: string;
}

/** A segment of a Document, sized for embedding + retrieval. */
export interface Chunk {
  id: string;
  documentId: string;
  sourceId: string;
  text: string;
  position: number; // ordinal position within the document
  /** Where in the source this chunk came from, for citation navigation. */
  sourceAnchor?: {
    url: string;
    headingPath?: string[];
    charStart?: number;
    charEnd?: number;
  };
}

export interface Embedding {
  chunkId: string;
  vector: Float32Array;
  embeddingModel: string;
}

export interface Session {
  id: string;
  name: string;
  sourceIds: string[];
  createdAt: number;
}

export type MessageRole = 'user' | 'assistant';

export interface Citation {
  chunkId: string;
  sourceId: string;
  snippet: string;
  /** Copied from the chunk's `sourceAnchor.headingPath` (e.g. `["Page 3"]`
   * for a PDF chunk, or a heading breadcrumb for a web page) — lets the UI
   * resolve a real click-through target (open a PDF page, or search the DOM
   * for the citation's original location) without a second storage lookup.
   * See src/core/citation/anchorResolver.ts. */
  headingPath?: string[];
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  text: string;
  citationIds?: string[];
  citations?: Citation[];
  timestamp: number;
}

export interface Conversation {
  id: string;
  sessionId?: string;
  sourceId?: string;
  createdAt: number;
}

/** Configuration for a swappable AIProvider instance. Never store a raw API key
 * inline anywhere except chrome.storage.local (extension) or process.env (tests/node).
 */
export interface ProviderConfig {
  id: string;
  name: string;
  mode: 'local' | 'remote';
  kind: 'extractive-local' | 'ollama' | 'gemini' | 'openai-compatible';
  /** For openai-compatible: base URL of the endpoint (OpenAI, OpenRouter, Groq, Ollama). */
  baseUrl?: string;
  model?: string;
  /** Reference only — never the raw key value serialized into app state/exports. */
  apiKeyRef?: string;
}

export interface StorageUsage {
  bytesUsed: number;
  quotaBytes: number | null;
  counts: {
    sources: number;
    documents: number;
    chunks: number;
    embeddings: number;
    sessions: number;
    conversations: number;
    messages: number;
  };
}

/** Top-level export/import envelope for "export all data" / "import data". */
export interface DataExport {
  exportedAt: number;
  version: 1;
  sources: Source[];
  documents: StructuredDocument[];
  chunks: Chunk[];
  embeddings: { chunkId: string; vector: number[]; embeddingModel: string }[];
  sessions: Session[];
  conversations: Conversation[];
  messages: Message[];
}
