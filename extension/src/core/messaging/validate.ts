import type { CapabilityLevel, ConfidenceLevel, DataExport, DocumentBlock, SourceType, StructuredDocument } from '../types';
import { MAX_IMPORT_BASE64_LENGTH, isBase64 } from './binary';
import { validateDataExport } from '../storage/validateExport';

/**
 * Runtime validation for every message the background service worker
 * accepts (audit issue SEC-01).
 *
 * Before this module, `entrypoints/background.ts` typed its listener
 * parameter as `ExtensionMessage` and trusted it: TypeScript types do not
 * exist at runtime, so any sender could post `{ type: 'ASK_QUESTION',
 * question: {…} }` or `{ type: 'IMPORT_DATA', data: 42 }` and it would flow
 * straight into IndexedDB/provider code. And because the listener never
 * looked at `sender`, a message from a content script (i.e. a context living
 * inside an arbitrary web page's renderer process) was treated exactly like
 * one from the extension's own side panel — including `EXPORT_DATA` (returns
 * every captured source) and `DELETE_ALL_DATA`.
 *
 * Now: (1) only extension pages (side panel, popup, options) may call the
 * background router at all — the content script never needs to, it only
 * answers `chrome.tabs.sendMessage` requests; (2) every field is checked for
 * type and a sane size bound before the handler runs.
 */

export const MAX_QUESTION_LENGTH = 4_000;
export const MAX_NAME_LENGTH = 200;
export const MAX_ID_LENGTH = 200;
export const MAX_DOCUMENT_TEXT_LENGTH = 5_000_000; // ~5M chars: far beyond a real article, bounds abuse
export const MAX_DOCUMENT_BLOCKS = 50_000;

export type ExtensionMessage =
  | { type: 'EXTRACT_RESULT'; document: StructuredDocument; capabilityLevel: CapabilityLevel; confidence: ConfidenceLevel; adapterUsed: string; sourceType?: SourceType }
  | { type: 'ASK_QUESTION'; question: string; sourceIds?: string[]; sessionId?: string }
  | { type: 'IMPORT_LOCAL_FILE'; fileName: string; fileType: string; bytesBase64: string }
  | { type: 'CREATE_SESSION'; name: string }
  | { type: 'GET_SESSIONS' }
  | { type: 'ADD_SOURCE_TO_SESSION'; sessionId: string; sourceId: string }
  | { type: 'REMOVE_SOURCE_FROM_SESSION'; sessionId: string; sourceId: string }
  | { type: 'GET_CHUNKS_FOR_SOURCE'; sourceId: string }
  | { type: 'DELETE_CHUNK'; chunkId: string; sourceId: string }
  | { type: 'GET_ALL_SOURCES' }
  | { type: 'DELETE_SOURCE'; sourceId: string }
  | { type: 'DELETE_SESSION'; sessionId: string }
  | { type: 'DELETE_ALL_DATA' }
  | { type: 'EXPORT_DATA' }
  | { type: 'IMPORT_DATA'; data: DataExport }
  | { type: 'GET_STORAGE_USAGE' };

export type ValidationResult = { ok: true; message: ExtensionMessage } | { ok: false; error: string };

/** Minimal shape of `chrome.runtime.MessageSender` this check needs. */
export interface SenderLike {
  id?: string;
  url?: string;
  origin?: string;
}

/**
 * True only for messages sent by one of this extension's own pages. A
 * content script's `sender.url`/`sender.origin` is the host web page's, so
 * it is rejected here even though its `sender.id` matches.
 */
export function isTrustedExtensionSender(sender: SenderLike | undefined, runtimeId: string): boolean {
  if (!sender || !runtimeId || sender.id !== runtimeId) return false;
  const extensionOrigin = `chrome-extension://${runtimeId}`;
  if (typeof sender.url !== 'string' || !sender.url.startsWith(`${extensionOrigin}/`)) return false;
  if (sender.origin !== undefined && sender.origin !== extensionOrigin) return false;
  return true;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isBoundedString(v: unknown, max: number, allowEmpty = false): v is string {
  return typeof v === 'string' && v.length <= max && (allowEmpty || v.trim().length > 0);
}

function isId(v: unknown): v is string {
  return isBoundedString(v, MAX_ID_LENGTH);
}

const CAPABILITY_LEVELS = new Set([1, 2, 3, 4, 5, 6, 7]);
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);
const SOURCE_TYPES = new Set(['generic-web', 'selection', 'whatsapp', 'gmail', 'pdf', 'local-file']);
const BLOCK_TYPES = new Set(['heading', 'paragraph', 'list-item', 'code']);
const ADAPTER_NAMES = new Set(['genericWebAdapter', 'selectionAdapter', 'whatsappAdapter']);

function validateBlocks(v: unknown): v is DocumentBlock[] {
  if (!Array.isArray(v) || v.length > MAX_DOCUMENT_BLOCKS) return false;
  return v.every(
    (b) =>
      isObject(b) &&
      typeof b.type === 'string' &&
      BLOCK_TYPES.has(b.type) &&
      typeof b.text === 'string' &&
      (b.level === undefined || (typeof b.level === 'number' && b.level >= 1 && b.level <= 6)),
  );
}

export function validateStructuredDocument(v: unknown): v is StructuredDocument {
  if (!isObject(v)) return false;
  if (typeof v.title !== 'string' || v.title.length > 2_000) return false;
  if (typeof v.text !== 'string' || v.text.length > MAX_DOCUMENT_TEXT_LENGTH) return false;
  if (v.blocks !== undefined && !validateBlocks(v.blocks)) return false;
  if (!isObject(v.metadata) || typeof v.metadata.url !== 'string' || typeof v.metadata.title !== 'string') return false;
  if (v.links !== undefined && !(Array.isArray(v.links) && v.links.every((l) => typeof l === 'string'))) return false;
  return true;
}

function validateIdArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.length <= 1_000 && v.every(isId);
}

/**
 * Validates an untrusted message. Returns a narrowed `ExtensionMessage` or a
 * short, user-safe error string — never throws.
 */
export function validateExtensionMessage(raw: unknown): ValidationResult {
  const fail = (error: string): ValidationResult => ({ ok: false, error });
  if (!isObject(raw) || typeof raw.type !== 'string') return fail('Malformed message.');
  const m = raw;

  switch (m.type) {
    case 'EXTRACT_RESULT': {
      if (!validateStructuredDocument(m.document)) return fail('Malformed extracted document.');
      if (typeof m.capabilityLevel !== 'number' || !CAPABILITY_LEVELS.has(m.capabilityLevel)) return fail('Invalid capability level.');
      if (typeof m.confidence !== 'string' || !CONFIDENCE_LEVELS.has(m.confidence)) return fail('Invalid confidence level.');
      if (typeof m.adapterUsed !== 'string' || !ADAPTER_NAMES.has(m.adapterUsed)) return fail('Unknown adapter.');
      if (m.sourceType !== undefined && (typeof m.sourceType !== 'string' || !SOURCE_TYPES.has(m.sourceType))) {
        return fail('Invalid source type.');
      }
      return { ok: true, message: m as ExtensionMessage };
    }
    case 'ASK_QUESTION': {
      if (!isBoundedString(m.question, MAX_QUESTION_LENGTH)) {
        return fail(`Question must be non-empty and at most ${MAX_QUESTION_LENGTH} characters.`);
      }
      const hasSession = m.sessionId !== undefined;
      const hasSources = m.sourceIds !== undefined;
      if (hasSession && !isId(m.sessionId)) return fail('Invalid session id.');
      if (hasSources && !validateIdArray(m.sourceIds)) return fail('Invalid source ids.');
      // FUN-02: a question must always be scoped (current source(s) or a
      // research session). An unscoped question previously searched every
      // source ever captured — and, in Mode B, sent unrelated sources'
      // chunks to the remote provider.
      if (!hasSession && !hasSources) return fail('Capture a page, selection, or file first (no retrieval scope given).');
      return { ok: true, message: m as ExtensionMessage };
    }
    case 'IMPORT_LOCAL_FILE': {
      if (!isBoundedString(m.fileName, 500)) return fail('Invalid file name.');
      if (!isBoundedString(m.fileType, 200, true)) return fail('Invalid file type.');
      if (!isBase64(m.bytesBase64)) return fail('File payload is not valid base64.');
      if ((m.bytesBase64 as string).length > MAX_IMPORT_BASE64_LENGTH) return fail('File is too large to import.');
      return { ok: true, message: m as ExtensionMessage };
    }
    case 'CREATE_SESSION':
      return isBoundedString(m.name, MAX_NAME_LENGTH)
        ? { ok: true, message: m as ExtensionMessage }
        : fail(`Session name must be non-empty and at most ${MAX_NAME_LENGTH} characters.`);
    case 'ADD_SOURCE_TO_SESSION':
    case 'REMOVE_SOURCE_FROM_SESSION':
      return isId(m.sessionId) && isId(m.sourceId) ? { ok: true, message: m as ExtensionMessage } : fail('Invalid session/source id.');
    case 'GET_CHUNKS_FOR_SOURCE':
    case 'DELETE_SOURCE':
      return isId(m.sourceId) ? { ok: true, message: m as ExtensionMessage } : fail('Invalid source id.');
    case 'DELETE_CHUNK':
      return isId(m.chunkId) && isId(m.sourceId) ? { ok: true, message: m as ExtensionMessage } : fail('Invalid chunk/source id.');
    case 'DELETE_SESSION':
      return isId(m.sessionId) ? { ok: true, message: m as ExtensionMessage } : fail('Invalid session id.');
    case 'IMPORT_DATA': {
      const result = validateDataExport(m.data);
      return result.ok ? { ok: true, message: { type: 'IMPORT_DATA', data: result.data } } : fail(result.error);
    }
    case 'GET_SESSIONS':
    case 'GET_ALL_SOURCES':
    case 'DELETE_ALL_DATA':
    case 'EXPORT_DATA':
    case 'GET_STORAGE_USAGE':
      return { ok: true, message: { type: m.type } as ExtensionMessage };
    default:
      return fail('Unrecognized message type.');
  }
}
