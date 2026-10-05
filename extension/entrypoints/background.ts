import {
  addSourceToSession,
  createSession,
  deleteAllData,
  deleteChunk,
  deleteSession,
  deleteSource,
  exportAllData,
  getAllSessions,
  getAllSources,
  getChunksBySource,
  getStorageUsage,
  importData,
  removeSourceFromSession,
} from '../src/core/storage/db';
import { selectAIProvider, selectEmbeddingProvider, type StoredAIConfig } from '../src/core/ai/providerSelection';
import { askQuestion } from '../src/core/rag/orchestrator';
import { ingestDocument } from '../src/core/rag/ingest';
import { extractLocalFile } from '../src/core/adapters/localFileAdapter';
import type { AIProvider } from '../src/core/ai/providers/AIProvider';
import type { EmbeddingProvider } from '../src/core/ai/embeddings/EmbeddingProvider';
import type { CapabilityLevel, ConfidenceLevel, SourceType, StructuredDocument } from '../src/core/types';
import { userMessageFor } from '../src/core/errors';
import { recordDiagnosticEvent } from '../src/core/diagnostics';
import { setPendingSidePanelAction } from '../src/core/pendingAction';
import { base64ToBytes } from '../src/core/messaging/binary';
import {
  isTrustedExtensionSender,
  validateExtensionMessage,
  type ExtensionMessage,
} from '../src/core/messaging/validate';

export type { ExtensionMessage };

/**
 * MV3 service worker: the message router for the extension's own pages
 * (side panel, popup, options) and the place provider calls happen
 * (background has `chrome.storage` + network access without page CSP
 * constraints).
 *
 * Every incoming message is (1) rejected unless it comes from one of this
 * extension's own pages — content scripts never call this router, they only
 * answer `chrome.tabs.sendMessage` requests — and (2) runtime-validated by
 * `src/core/messaging/validate.ts` before any handler runs (audit SEC-01).
 */

const STORED_CONFIG_KEYS = [
  'privacyMode',
  'embeddingProviderKind',
  'providerKind',
  'apiKey',
  'baseUrl',
  'ollamaBaseUrl',
  'model',
] as const;

/**
 * Reads the user's active privacy mode + provider settings from
 * `chrome.storage.local` (never hardcoded) so the correct EmbeddingProvider
 * and AIProvider pair is constructed fresh for every request — see
 * `src/core/ai/providerSelection.ts`. A storage read failure propagates (and
 * is reported to the UI) instead of silently falling back to defaults, which
 * could otherwise quietly switch a Mode A user onto default settings.
 */
async function getStoredAIConfig(): Promise<StoredAIConfig> {
  if (!chrome.storage?.local) return {};
  return ((await chrome.storage.local.get([...STORED_CONFIG_KEYS])) ?? {}) as StoredAIConfig;
}

async function getActiveProvider(): Promise<AIProvider> {
  return selectAIProvider(await getStoredAIConfig());
}

async function getActiveEmbeddingProvider(): Promise<EmbeddingProvider> {
  return selectEmbeddingProvider(await getStoredAIConfig());
}

async function ingestExtractedDocument(
  doc: StructuredDocument,
  capabilityLevel: CapabilityLevel,
  confidence: ConfidenceLevel,
  adapterUsed: string,
  sourceType?: SourceType,
) {
  const embeddingProvider = await getActiveEmbeddingProvider();
  const { source, chunkCount, embedLatencyMs } = await ingestDocument(
    doc,
    { capabilityLevel, confidence, adapterUsed, sourceType },
    embeddingProvider,
  );
  recordDiagnosticEvent({
    area: 'ingest',
    outcome: 'success',
    adapter: adapterUsed,
    provider: embeddingProvider.name,
    capabilityLevel,
    latencyMs: embedLatencyMs,
  });
  return { source, chunkCount };
}

async function handleMessage(message: ExtensionMessage): Promise<Record<string, unknown>> {
  switch (message.type) {
    case 'EXTRACT_RESULT': {
      const result = await ingestExtractedDocument(
        message.document,
        message.capabilityLevel,
        message.confidence,
        message.adapterUsed,
        message.sourceType,
      );
      return { ok: true, ...result };
    }
    case 'ASK_QUESTION': {
      const [provider, embeddingProvider] = await Promise.all([getActiveProvider(), getActiveEmbeddingProvider()]);
      const askStart = Date.now();
      const result = await askQuestion(message.question, embeddingProvider, provider, {
        sourceIds: message.sourceIds,
        sessionId: message.sessionId,
      });
      recordDiagnosticEvent({ area: 'ai', outcome: 'success', provider: provider.name, latencyMs: Date.now() - askStart });
      return { ok: true, result };
    }
    case 'IMPORT_LOCAL_FILE': {
      // Bytes arrive base64-encoded: Chrome JSON-serializes runtime
      // messages, and a raw ArrayBuffer would arrive as `{}` (FUN-01).
      const bytes = base64ToBytes(message.bytesBase64);
      const file = new File([bytes], message.fileName, { type: message.fileType });
      const { document, kind, confidence } = await extractLocalFile(file);
      const result = await ingestExtractedDocument(document, 5, confidence, 'localFileAdapter', 'local-file');
      return { ok: true, ...result, kind };
    }
    case 'CREATE_SESSION':
      return { ok: true, session: await createSession(message.name.trim()) };
    case 'GET_SESSIONS':
      return { ok: true, sessions: await getAllSessions() };
    case 'ADD_SOURCE_TO_SESSION':
      return { ok: true, session: await addSourceToSession(message.sessionId, message.sourceId) };
    case 'REMOVE_SOURCE_FROM_SESSION':
      return { ok: true, session: await removeSourceFromSession(message.sessionId, message.sourceId) };
    case 'GET_CHUNKS_FOR_SOURCE':
      // "Context in use" transparency panel: the exact chunks currently
      // eligible for retrieval for this source.
      return { ok: true, chunks: await getChunksBySource(message.sourceId) };
    case 'DELETE_CHUNK':
      await deleteChunk(message.chunkId);
      return { ok: true, chunks: await getChunksBySource(message.sourceId) };
    case 'GET_ALL_SOURCES':
      return { ok: true, sources: await getAllSources() };
    case 'DELETE_SOURCE':
      await deleteSource(message.sourceId);
      return { ok: true };
    case 'DELETE_SESSION':
      await deleteSession(message.sessionId);
      return { ok: true, sessions: await getAllSessions() };
    case 'DELETE_ALL_DATA':
      await deleteAllData();
      return { ok: true };
    case 'EXPORT_DATA':
      return { ok: true, data: await exportAllData() };
    case 'IMPORT_DATA':
      await importData(message.data);
      return { ok: true };
    case 'GET_STORAGE_USAGE':
      return { ok: true, usage: await getStorageUsage() };
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    if (!isTrustedExtensionSender(sender, chrome.runtime.id)) {
      // Not an extension page (e.g. a content script inside a web page's
      // renderer). Do not answer at all, so nothing leaks back.
      console.warn('[background] rejected message from untrusted sender', sender?.url);
      return false;
    }
    const validation = validateExtensionMessage(raw);
    if (!validation.ok) {
      sendResponse({ ok: false, error: validation.error });
      return false;
    }
    const message = validation.message;
    handleMessage(message)
      .then(sendResponse)
      .catch((err) => {
        const isAsk = message.type === 'ASK_QUESTION';
        recordDiagnosticEvent({ area: isAsk ? 'ai' : 'ingest', outcome: 'failure', errorSource: err });
        sendResponse({ ok: false, error: userMessageFor(err, 'Request') });
      });
    return true; // keep the message channel open for the async response
  });
}

function openSidePanel(tabId: number) {
  // Must be called synchronously inside the command/gesture handler:
  // chrome.sidePanel.open() requires a user gesture, which is lost after any
  // `await` (FUN-05 root cause for the ask-about-selection shortcut).
  chrome.sidePanel?.open?.({ tabId })?.catch((err: unknown) => {
    console.warn('[background] chrome.sidePanel.open failed', err);
  });
}

export default defineBackground(() => {
  // Keyboard shortcuts (see wxt.config.ts's `commands` block for the actual
  // key bindings and the documented note on possible browser/OS conflicts).
  // Note: the toolbar action opens popup.html (manifest `default_popup`),
  // so there is no `chrome.action.onClicked` handler — it could never fire.
  chrome.commands?.onCommand?.addListener((command, tab) => {
    if (tab?.id == null) return;
    if (command === 'open-assistant') {
      openSidePanel(tab.id);
      return;
    }
    if (command === 'ask-about-selection') {
      // Open first (keeps the user gesture), then queue the "extract the
      // current selection" request. The side panel consumes it on mount AND
      // via chrome.storage.onChanged, so it works whether the panel was
      // closed (fresh mount) or already open — see src/core/pendingAction.ts.
      openSidePanel(tab.id);
      setPendingSidePanelAction('extract-selection').catch((err) => {
        console.warn('[background] could not queue ask-about-selection request', err);
      });
    }
  });
});
