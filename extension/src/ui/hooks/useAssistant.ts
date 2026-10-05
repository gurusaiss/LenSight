import { useCallback, useState } from 'react';
import type { CapabilityLevel, Chunk, Citation, ConfidenceLevel, Session } from '../../core/types';
import { buildPdfPageUrl, resolveCitationTarget } from '../../core/citation/anchorResolver';
import { sendToContentScript } from '../../core/messaging/contentScript';
import { MAX_IMPORT_BYTES, bytesToBase64 } from '../../core/messaging/binary';
import { resolveAskScope } from '../../core/messaging/scope';

/**
 * Wires the side panel UI to the background service worker via
 * chrome.runtime messaging (see entrypoints/background.ts for the handler
 * side of this contract).
 */

export interface CurrentSourceInfo {
  title: string;
  url: string;
  capabilityLevel: CapabilityLevel;
  confidence: ConfidenceLevel;
  adapterUsed: string;
  chunkCount: number;
}

export interface AskResultUI {
  answer: string;
  citations: Citation[];
  providerName: string;
  providerMode: 'local' | 'remote';
}

function hasChrome(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.sendMessage;
}

function errorMessage(err: unknown): string {
  return String((err as { userMessage?: string; message?: string })?.userMessage ?? (err as Error)?.message ?? err);
}

export function useAssistant() {
  const [currentSource, setCurrentSource] = useState<CurrentSourceInfo | null>(null);
  const [currentSourceId, setCurrentSourceId] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAnswer, setLastAnswer] = useState<AskResultUI | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sourceChunks, setSourceChunks] = useState<Chunk[]>([]);

  const extractCurrentPage = useCallback(async (mode: 'page' | 'selection' = 'page') => {
    setError(null);
    setIsExtracting(true);
    try {
      if (!hasChrome()) {
        throw new Error('Not running inside the extension (chrome.runtime unavailable).');
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found.');

      // Injects the content script on demand (activeTab + scripting) if the
      // tab doesn't have it yet — see src/core/messaging/contentScript.ts.
      const extractResponse: any = await sendToContentScript(tab.id, { type: 'REQUEST_EXTRACT', mode });
      if (!extractResponse?.ok) {
        throw new Error(extractResponse?.error ?? 'Extraction failed.');
      }

      // Forward the extracted document to the background worker, which runs
      // it through cleaning -> chunking -> embedding -> IndexedDB storage
      // and reports back how many chunks were indexed.
      const ingestResponse: any = await chrome.runtime.sendMessage({
        type: 'EXTRACT_RESULT',
        document: extractResponse.document,
        capabilityLevel: extractResponse.capabilityLevel,
        confidence: extractResponse.confidence,
        adapterUsed: extractResponse.adapterUsed,
      });
      if (!ingestResponse?.ok) {
        throw new Error(ingestResponse?.error ?? 'Failed to index the captured content.');
      }

      setCurrentSource({
        title: ingestResponse.source.title,
        url: ingestResponse.source.url,
        capabilityLevel: ingestResponse.source.capabilityLevel,
        confidence: ingestResponse.source.confidence,
        adapterUsed: ingestResponse.source.adapterUsed,
        chunkCount: ingestResponse.chunkCount,
      });
      setCurrentSourceId(ingestResponse.source.id);
      setSourceChunks([]); // FUN-10: never show the previous source's chunk list/count
    } catch (err: any) {
      setError(errorMessage(err));
    } finally {
      setIsExtracting(false);
    }
  }, []);

  /** Local file import (Phase 5): sends the File's bytes to the background
   * worker, which delegates to localFileAdapter (and pdfAdapter for .pdf)
   * and runs the same clean -> chunk -> embed -> store ingestion path as
   * page/selection capture. */
  const importLocalFile = useCallback(async (file: File) => {
    setError(null);
    setIsExtracting(true);
    try {
      if (!hasChrome()) {
        throw new Error('Not running inside the extension (chrome.runtime unavailable).');
      }
      if (file.size > MAX_IMPORT_BYTES) {
        throw new Error(
          `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the import limit is ` +
            `${MAX_IMPORT_BYTES / (1024 * 1024)} MB. Split the file or import a smaller excerpt.`,
        );
      }
      if (file.size === 0) {
        throw new Error(`"${file.name}" is empty — nothing to import.`);
      }
      // Base64, not a raw ArrayBuffer: Chrome JSON-serializes runtime
      // messages and an ArrayBuffer would arrive as {} (FUN-01).
      const bytesBase64 = bytesToBase64(await file.arrayBuffer());
      const response: any = await chrome.runtime.sendMessage({
        type: 'IMPORT_LOCAL_FILE',
        fileName: file.name,
        fileType: file.type,
        bytesBase64,
      });
      if (!response?.ok) {
        throw new Error(response?.error ?? 'Failed to import file.');
      }
      setCurrentSource({
        title: response.source.title,
        url: response.source.url,
        capabilityLevel: response.source.capabilityLevel,
        confidence: response.source.confidence,
        adapterUsed: response.source.adapterUsed,
        chunkCount: response.chunkCount,
      });
      setCurrentSourceId(response.source.id);
      setSourceChunks([]);
      return response.source.id as string;
    } catch (err: any) {
      setError(errorMessage(err));
      return null;
    } finally {
      setIsExtracting(false);
    }
  }, []);

  const ask = useCallback(
    async (question: string) => {
      setError(null);
      // FUN-02: always send an explicit scope — the current source, or the
      // active research session — never an unscoped "search everything".
      const scope = resolveAskScope(activeSessionId, currentSourceId);
      if (!scope.ok) {
        setError(scope.error);
        return null;
      }
      setIsAsking(true);
      try {
        if (!hasChrome()) {
          throw new Error('Not running inside the extension (chrome.runtime unavailable).');
        }
        const response: any = await chrome.runtime.sendMessage({
          type: 'ASK_QUESTION',
          question,
          sourceIds: scope.sourceIds,
          sessionId: scope.sessionId,
        });
        if (!response?.ok) {
          throw new Error(response?.error ?? 'Failed to get an answer.');
        }
        setLastAnswer(response.result);
        return response.result as AskResultUI;
      } catch (err: any) {
        setError(errorMessage(err));
        return null;
      } finally {
        setIsAsking(false);
      }
    },
    [activeSessionId, currentSourceId],
  );

  /**
   * Real citation click-through: resolves where a citation should navigate
   * (see src/core/citation/anchorResolver.ts) and either opens the source
   * PDF at the right page, or asks the active tab's content script to
   * scroll/highlight the matching DOM text. Reports back (via `error`)
   * honestly when no source location could be found or matched, rather than
   * pretending the click always works.
   */
  const openCitation = useCallback(async (citation: Citation) => {
    const target = resolveCitationTarget(citation, citation.headingPath);
    if (target.kind === 'none') {
      setError('This citation has no recoverable source location to jump to.');
      return;
    }
    if (target.kind === 'pdf-page') {
      if (!currentSource?.url) {
        setError('No source URL available to open this PDF page.');
        return;
      }
      if (typeof window !== 'undefined') {
        window.open(buildPdfPageUrl(currentSource.url, target.page), '_blank', 'noopener');
      }
      return;
    }
    // dom-text: ask the active tab's content script to find + highlight it.
    if (!hasChrome()) {
      setError('Not running inside the extension (chrome.runtime unavailable).');
      return;
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setError('No active tab to highlight the citation in.');
        return;
      }
      const response: any = await sendToContentScript(tab.id, {
        type: 'HIGHLIGHT_CITATION',
        snippet: target.snippet,
      });
      if (!response?.found) {
        setError(
          'Could not find this citation’s original text on the current page — it may have been ' +
            'edited, scrolled past, or the page has changed since capture.',
        );
      }
    } catch (err: any) {
      setError(errorMessage(err));
    }
  }, [currentSource]);

  // --- "Context in use" per-chunk transparency (differentiator) ---

  const loadSourceChunks = useCallback(async (sourceId: string) => {
    if (!hasChrome()) return;
    try {
      const response: any = await chrome.runtime.sendMessage({ type: 'GET_CHUNKS_FOR_SOURCE', sourceId });
      if (!response?.ok) throw new Error(response?.error ?? 'Failed to load chunks.');
      setSourceChunks(response.chunks);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const deleteChunkFromContext = useCallback(
    async (chunkId: string) => {
      if (!hasChrome() || !currentSourceId) return;
      try {
        const response: any = await chrome.runtime.sendMessage({
          type: 'DELETE_CHUNK',
          chunkId,
          sourceId: currentSourceId,
        });
        if (!response?.ok) throw new Error(response?.error ?? 'Failed to remove that chunk.');
        setSourceChunks(response.chunks);
        setCurrentSource((prev) => (prev ? { ...prev, chunkCount: response.chunks.length } : prev));
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    [currentSourceId],
  );

  // --- Multi-tab / research sessions (Phase 5) ---

  const refreshSessions = useCallback(async () => {
    if (!hasChrome()) return;
    try {
      const response: any = await chrome.runtime.sendMessage({ type: 'GET_SESSIONS' });
      if (!response?.ok) throw new Error(response?.error ?? 'Failed to load research sessions.');
      setSessions(response.sessions);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  /** Sends a background request and returns the response, throwing its
   * user-safe error when `ok` is false (so callers never drop a failure). */
  const request = async (message: Record<string, unknown>, fallbackError: string): Promise<any> => {
    const response: any = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error ?? fallbackError);
    return response;
  };

  const createSession = useCallback(
    async (name: string) => {
      if (!hasChrome()) return null;
      try {
        const response = await request({ type: 'CREATE_SESSION', name }, 'Failed to create session.');
        await refreshSessions();
        return response.session.id as string;
      } catch (err) {
        setError(errorMessage(err));
        return null;
      }
    },
    [refreshSessions],
  );

  const addCurrentSourceToSession = useCallback(
    async (sessionId: string) => {
      if (!hasChrome() || !currentSourceId) return;
      try {
        await request(
          { type: 'ADD_SOURCE_TO_SESSION', sessionId, sourceId: currentSourceId },
          'Failed to add source to session.',
        );
        await refreshSessions();
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    [currentSourceId, refreshSessions],
  );

  const removeSourceFromSession = useCallback(
    async (sessionId: string, sourceId: string) => {
      if (!hasChrome()) return;
      try {
        await request({ type: 'REMOVE_SOURCE_FROM_SESSION', sessionId, sourceId }, 'Failed to remove source from session.');
        await refreshSessions();
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    [refreshSessions],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!hasChrome()) return;
      try {
        const response = await request({ type: 'DELETE_SESSION', sessionId }, 'Failed to delete session.');
        setSessions(response.sessions);
        if (activeSessionId === sessionId) setActiveSessionId(null);
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    [activeSessionId],
  );

  return {
    currentSource,
    currentSourceId,
    isExtracting,
    isAsking,
    error,
    lastAnswer,
    extractCurrentPage,
    importLocalFile,
    ask,
    openCitation,
    // Sessions
    sessions,
    activeSessionId,
    setActiveSessionId,
    refreshSessions,
    createSession,
    addCurrentSourceToSession,
    removeSourceFromSession,
    deleteSession,
    // Context-in-use per-chunk transparency
    sourceChunks,
    loadSourceChunks,
    deleteChunkFromContext,
  };
}
