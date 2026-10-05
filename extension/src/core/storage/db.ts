import { openDB, type IDBPDatabase } from 'idb';
import type {
  Chunk,
  Conversation,
  DataExport,
  Embedding,
  Message,
  Session,
  Source,
  StorageUsage,
  StructuredDocument,
} from '../types';
import { validateDataExport } from './validateExport';

/**
 * IndexedDB wrapper (via the `idb` package), per the spec's storage-engine
 * decision: IndexedDB, not SQLite/DuckDB/a WASM vector DB, for MVP scale.
 *
 * Stores: sources, documents, chunks, embeddings, sessions, conversations, messages.
 */

export const DB_NAME = 'ai-context-assistant';
const DB_VERSION = 1;

export interface AppDBSchema {
  sources: Source;
  documents: StructuredDocument;
  chunks: Chunk;
  embeddings: { chunkId: string; vector: number[]; embeddingModel: string };
  sessions: Session;
  conversations: Conversation;
  messages: Message;
}

type StoreName = keyof AppDBSchema;

const STORE_CONFIG: Record<StoreName, { keyPath: string; indexes?: [string, string][] }> = {
  sources: { keyPath: 'id' },
  documents: { keyPath: 'id', indexes: [['sourceId', 'sourceId']] },
  chunks: { keyPath: 'id', indexes: [['documentId', 'documentId'], ['sourceId', 'sourceId']] },
  embeddings: { keyPath: 'chunkId' },
  sessions: { keyPath: 'id' },
  conversations: { keyPath: 'id' },
  messages: { keyPath: 'id', indexes: [['conversationId', 'conversationId']] },
};

let dbPromise: Promise<IDBPDatabase<any>> | null = null;

/**
 * Opens (and lazily creates) the IndexedDB database. Accepts an injectable
 * `idbFactory` param so tests can pass `fake-indexeddb` explicitly if needed,
 * though in practice `openDB` picks up whatever `indexedDB` global is present
 * (real browser, or fake-indexeddb registered globally in test setup).
 */
export function getDB(): Promise<IDBPDatabase<any>> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        (Object.keys(STORE_CONFIG) as StoreName[]).forEach((name) => {
          if (db.objectStoreNames.contains(name)) return;
          const config = STORE_CONFIG[name];
          const store = db.createObjectStore(name, { keyPath: config.keyPath });
          config.indexes?.forEach(([indexName, keyPath]) => {
            store.createIndex(indexName, keyPath);
          });
        });
      },
    });
  }
  return dbPromise;
}

/** For tests: close and drop the cached DB handle so a subsequent
 * `indexedDB.deleteDatabase` call isn't blocked by an open connection. */
export async function resetDBHandleForTests() {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
}

function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export async function addSource(
  source: Omit<Source, 'id'> & { id?: string },
  document: Omit<StructuredDocument, 'id' | 'sourceId'>,
  chunks: Omit<Chunk, 'id' | 'documentId' | 'sourceId'>[],
): Promise<{ source: Source; document: StructuredDocument; chunks: Chunk[] }> {
  const db = await getDB();
  const sourceId = source.id ?? newId('src');
  const documentId = newId('doc');

  const finalSource: Source = { ...source, id: sourceId };
  const finalDocument: StructuredDocument = { ...document, id: documentId, sourceId };
  const finalChunks: Chunk[] = chunks.map((c) => ({
    ...c,
    id: newId('chk'),
    documentId,
    sourceId,
  }));

  const tx = db.transaction(['sources', 'documents', 'chunks'], 'readwrite');
  await Promise.all([
    tx.objectStore('sources').put(finalSource),
    tx.objectStore('documents').put(finalDocument),
    ...finalChunks.map((c) => tx.objectStore('chunks').put(c)),
  ]);
  await tx.done;

  return { source: finalSource, document: finalDocument, chunks: finalChunks };
}

export async function addEmbeddings(embeddings: Embedding[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('embeddings', 'readwrite');
  await Promise.all(
    embeddings.map((e) =>
      tx.objectStore('embeddings').put({
        chunkId: e.chunkId,
        vector: Array.from(e.vector),
        embeddingModel: e.embeddingModel,
      }),
    ),
  );
  await tx.done;
}

export async function getChunksBySource(sourceId: string): Promise<Chunk[]> {
  const db = await getDB();
  return db.getAllFromIndex('chunks', 'sourceId', sourceId);
}

/**
 * Removes exactly one chunk (and its embedding) without touching the rest of
 * its source/document — the storage-layer half of the "Context in use" panel's
 * per-chunk removal (see src/ui/components/ContextInUsePanel.tsx): a genuine
 * privacy-UX differentiator (per-chunk inspection/removal, not just
 * per-source) rather than a cosmetic list.
 */
export async function deleteChunk(chunkId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['chunks', 'embeddings'], 'readwrite');
  await tx.objectStore('chunks').delete(chunkId);
  await tx.objectStore('embeddings').delete(chunkId);
  await tx.done;
}

export async function getAllChunks(): Promise<Chunk[]> {
  const db = await getDB();
  return db.getAll('chunks');
}

export async function getAllEmbeddings(): Promise<AppDBSchema['embeddings'][]> {
  const db = await getDB();
  return db.getAll('embeddings');
}

export async function getAllSources(): Promise<Source[]> {
  const db = await getDB();
  return db.getAll('sources');
}

export async function deleteSource(sourceId: string): Promise<void> {
  const db = await getDB();
  const chunks = await db.getAllFromIndex('chunks', 'sourceId', sourceId);
  const documents = await db.getAllFromIndex('documents', 'sourceId', sourceId);

  const tx = db.transaction(['sources', 'documents', 'chunks', 'embeddings', 'sessions'], 'readwrite');
  await tx.objectStore('sources').delete(sourceId);
  await Promise.all(documents.map((d) => tx.objectStore('documents').delete(d.id)));
  await Promise.all(
    chunks.map(async (c) => {
      await tx.objectStore('chunks').delete(c.id);
      await tx.objectStore('embeddings').delete(c.id);
    }),
  );
  // DATA-02: also drop the deleted source from every research session in
  // the same transaction, so no session keeps a dangling source id (which
  // inflated its "N source(s)" count in SessionPanel forever).
  const sessionStore = tx.objectStore('sessions');
  const sessions: Session[] = await sessionStore.getAll();
  await Promise.all(
    sessions
      .filter((s) => s.sourceIds.includes(sourceId))
      .map((s) => sessionStore.put({ ...s, sourceIds: s.sourceIds.filter((id) => id !== sourceId) })),
  );
  await tx.done;
}

export async function createSession(name: string): Promise<Session> {
  const db = await getDB();
  const session: Session = { id: newId('ses'), name, sourceIds: [], createdAt: Date.now() };
  await db.put('sessions', session);
  return session;
}

export async function getAllSessions(): Promise<Session[]> {
  const db = await getDB();
  return db.getAll('sessions');
}

export async function getSession(sessionId: string): Promise<Session | undefined> {
  const db = await getDB();
  return db.get('sessions', sessionId);
}

/** Adds a source to a session (idempotent — adding twice is a no-op). */
export async function addSourceToSession(sessionId: string, sourceId: string): Promise<Session> {
  const db = await getDB();
  const session = await db.get('sessions', sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (!session.sourceIds.includes(sourceId)) {
    session.sourceIds = [...session.sourceIds, sourceId];
    await db.put('sessions', session);
  }
  return session;
}

export async function removeSourceFromSession(sessionId: string, sourceId: string): Promise<Session> {
  const db = await getDB();
  const session = await db.get('sessions', sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.sourceIds = session.sourceIds.filter((id: string) => id !== sourceId);
  await db.put('sessions', session);
  return session;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = await getDB();
  const conversations = await db.getAll('conversations');
  const toDelete = conversations.filter((c) => c.sessionId === sessionId);
  const tx = db.transaction(['sessions', 'conversations', 'messages'], 'readwrite');
  await tx.objectStore('sessions').delete(sessionId);
  for (const convo of toDelete) {
    await tx.objectStore('conversations').delete(convo.id);
    const messages = await tx.objectStore('messages').index('conversationId').getAll(convo.id);
    await Promise.all(messages.map((m) => tx.objectStore('messages').delete(m.id)));
  }
  await tx.done;
}

export async function deleteAllData(): Promise<void> {
  const db = await getDB();
  const storeNames = Object.keys(STORE_CONFIG) as StoreName[];
  const tx = db.transaction(storeNames, 'readwrite');
  await Promise.all(storeNames.map((name) => tx.objectStore(name).clear()));
  await tx.done;
}

export async function exportAllData(): Promise<DataExport> {
  const db = await getDB();
  const [sources, documents, chunks, embeddings, sessions, conversations, messages] = await Promise.all([
    db.getAll('sources'),
    db.getAll('documents'),
    db.getAll('chunks'),
    db.getAll('embeddings'),
    db.getAll('sessions'),
    db.getAll('conversations'),
    db.getAll('messages'),
  ]);
  return {
    exportedAt: Date.now(),
    version: 1,
    sources,
    documents,
    chunks,
    embeddings,
    sessions,
    conversations,
    messages,
  };
}

export async function importData(raw: DataExport): Promise<void> {
  // Validate the whole file before writing anything (DATA-01) — see
  // validateExport.ts. Throws an actionable message on the first bad record.
  const validation = validateDataExport(raw);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const data = validation.data;
  const db = await getDB();
  const storeNames: StoreName[] = ['sources', 'documents', 'chunks', 'embeddings', 'sessions', 'conversations', 'messages'];
  const tx = db.transaction(storeNames, 'readwrite');
  await Promise.all([
    ...data.sources.map((s) => tx.objectStore('sources').put(s)),
    ...data.documents.map((d) => tx.objectStore('documents').put(d)),
    ...data.chunks.map((c) => tx.objectStore('chunks').put(c)),
    ...data.embeddings.map((e) => tx.objectStore('embeddings').put(e)),
    ...data.sessions.map((s) => tx.objectStore('sessions').put(s)),
    ...data.conversations.map((c) => tx.objectStore('conversations').put(c)),
    ...data.messages.map((m) => tx.objectStore('messages').put(m)),
  ]);
  await tx.done;
}

export async function getStorageUsage(): Promise<StorageUsage> {
  const db = await getDB();
  const [sources, documents, chunks, embeddings, sessions, conversations, messages] = await Promise.all([
    db.getAll('sources'),
    db.getAll('documents'),
    db.getAll('chunks'),
    db.getAll('embeddings'),
    db.getAll('sessions'),
    db.getAll('conversations'),
    db.getAll('messages'),
  ]);

  // Rough byte-size estimate via JSON serialization (no navigator.storage
  // dependency, so this works identically in Node tests and the browser).
  const bytesUsed =
    JSON.stringify(sources).length +
    JSON.stringify(documents).length +
    JSON.stringify(chunks).length +
    JSON.stringify(embeddings).length +
    JSON.stringify(sessions).length +
    JSON.stringify(conversations).length +
    JSON.stringify(messages).length;

  let quotaBytes: number | null = null;
  if (typeof navigator !== 'undefined' && (navigator as any).storage?.estimate) {
    try {
      const estimate = await (navigator as any).storage.estimate();
      quotaBytes = estimate.quota ?? null;
    } catch {
      quotaBytes = null;
    }
  }

  return {
    bytesUsed,
    quotaBytes,
    counts: {
      sources: sources.length,
      documents: documents.length,
      chunks: chunks.length,
      embeddings: embeddings.length,
      sessions: sessions.length,
      conversations: conversations.length,
      messages: messages.length,
    },
  };
}
