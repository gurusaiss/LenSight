import type { DataExport } from '../types';

/**
 * Structural validation for "Import data" files (audit issue DATA-01).
 *
 * `importData()` used to take `JSON.parse(fileText)` on faith: a file missing
 * one of the arrays crashed mid-import with `Cannot read properties of
 * undefined (reading 'map')`, a record without its key field failed with an
 * opaque IndexedDB `DataError`, and arbitrary extra fields/objects were
 * written straight into the stores. This checks every record's required
 * fields/types (and cross-references embeddings -> chunks) before a single
 * write happens, and returns an actionable message naming what's wrong.
 *
 * Records are re-built from their known fields only, so unknown properties in
 * an imported file are dropped rather than persisted.
 */

export type ExportValidation = { ok: true; data: DataExport } | { ok: false; error: string };

const MAX_RECORDS_PER_STORE = 200_000;

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optStr = (v: unknown) => v === undefined || isStr(v);

export function validateDataExport(raw: unknown): ExportValidation {
  const fail = (error: string): ExportValidation => ({
    ok: false,
    error: `Import file rejected: ${error}. Export a file from this extension's Settings → Data first.`,
  });
  if (!isObj(raw)) return fail('not a JSON object');
  if (raw.version !== 1) return fail(`Unsupported export version ${JSON.stringify(raw.version)}`);

  const stores = ['sources', 'documents', 'chunks', 'embeddings', 'sessions', 'conversations', 'messages'] as const;
  for (const s of stores) {
    if (!Array.isArray(raw[s])) return fail(`missing "${s}" array`);
    if (raw[s].length > MAX_RECORDS_PER_STORE) return fail(`"${s}" has too many records`);
  }

  const sources = [];
  for (const [i, s] of (raw.sources as unknown[]).entries()) {
    if (!isObj(s) || !isNonEmptyStr(s.id) || !isStr(s.sourceType) || !isStr(s.url) || !isStr(s.title) ||
        !isNum(s.capabilityLevel) || !isStr(s.adapterUsed) || !isNum(s.capturedAt) || !isStr(s.confidence)) {
      return fail(`sources[${i}] is malformed`);
    }
    sources.push({ id: s.id, sourceType: s.sourceType, url: s.url, title: s.title, capabilityLevel: s.capabilityLevel,
      adapterUsed: s.adapterUsed, capturedAt: s.capturedAt, confidence: s.confidence } as DataExport['sources'][number]);
  }

  const documents = [];
  for (const [i, d] of (raw.documents as unknown[]).entries()) {
    if (!isObj(d) || !isNonEmptyStr(d.id) || !isStr(d.sourceId) || !isStr(d.title) || !isStr(d.text) || !isObj(d.metadata)) {
      return fail(`documents[${i}] is malformed`);
    }
    documents.push({ id: d.id, sourceId: d.sourceId, title: d.title, text: d.text,
      blocks: Array.isArray(d.blocks) ? d.blocks : undefined, metadata: d.metadata,
      links: Array.isArray(d.links) ? d.links.filter(isStr) : undefined } as DataExport['documents'][number]);
  }

  const chunkIds = new Set<string>();
  const chunks = [];
  for (const [i, c] of (raw.chunks as unknown[]).entries()) {
    if (!isObj(c) || !isNonEmptyStr(c.id) || !isStr(c.documentId) || !isStr(c.sourceId) || !isStr(c.text) || !isNum(c.position)) {
      return fail(`chunks[${i}] is malformed`);
    }
    chunkIds.add(c.id);
    chunks.push({ id: c.id, documentId: c.documentId, sourceId: c.sourceId, text: c.text, position: c.position,
      sourceAnchor: isObj(c.sourceAnchor) ? c.sourceAnchor : undefined } as DataExport['chunks'][number]);
  }

  const embeddings = [];
  for (const [i, e] of (raw.embeddings as unknown[]).entries()) {
    if (!isObj(e) || !isNonEmptyStr(e.chunkId) || !isNonEmptyStr(e.embeddingModel) ||
        !Array.isArray(e.vector) || e.vector.length === 0 || e.vector.length > 4096 || !e.vector.every(isNum)) {
      return fail(`embeddings[${i}] is malformed`);
    }
    if (!chunkIds.has(e.chunkId)) return fail(`embeddings[${i}] references a chunk that is not in the file`);
    embeddings.push({ chunkId: e.chunkId, vector: e.vector as number[], embeddingModel: e.embeddingModel });
  }

  const sessions = [];
  for (const [i, s] of (raw.sessions as unknown[]).entries()) {
    if (!isObj(s) || !isNonEmptyStr(s.id) || !isStr(s.name) || !Array.isArray(s.sourceIds) || !s.sourceIds.every(isStr) || !isNum(s.createdAt)) {
      return fail(`sessions[${i}] is malformed`);
    }
    sessions.push({ id: s.id, name: s.name, sourceIds: s.sourceIds as string[], createdAt: s.createdAt });
  }

  const conversations = [];
  for (const [i, c] of (raw.conversations as unknown[]).entries()) {
    if (!isObj(c) || !isNonEmptyStr(c.id) || !isNum(c.createdAt) || !optStr(c.sessionId) || !optStr(c.sourceId)) {
      return fail(`conversations[${i}] is malformed`);
    }
    conversations.push({ id: c.id, createdAt: c.createdAt, sessionId: c.sessionId, sourceId: c.sourceId });
  }

  const messages = [];
  for (const [i, m] of (raw.messages as unknown[]).entries()) {
    if (!isObj(m) || !isNonEmptyStr(m.id) || !isStr(m.conversationId) || (m.role !== 'user' && m.role !== 'assistant') ||
        !isStr(m.text) || !isNum(m.timestamp)) {
      return fail(`messages[${i}] is malformed`);
    }
    messages.push({ id: m.id, conversationId: m.conversationId, role: m.role, text: m.text, timestamp: m.timestamp,
      citationIds: Array.isArray(m.citationIds) ? m.citationIds.filter(isStr) : undefined,
      citations: Array.isArray(m.citations) ? m.citations : undefined } as DataExport['messages'][number]);
  }

  return {
    ok: true,
    data: {
      exportedAt: isNum(raw.exportedAt) ? raw.exportedAt : Date.now(),
      version: 1,
      sources,
      documents,
      chunks,
      embeddings,
      sessions,
      conversations,
      messages,
    },
  };
}
