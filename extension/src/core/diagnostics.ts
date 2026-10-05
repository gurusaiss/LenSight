import { AppError, type ErrorCode } from './errors';

/**
 * Privacy-safe diagnostics logging, per the research doc's Observability
 * section: "log failure types, never private content". This module is the
 * ONLY place diagnostic events are recorded, and it is deliberately
 * structured — not a freeform string logger — so that no call site can
 * accidentally smuggle page/message/chat content into a stored diagnostic
 * entry, even by passing an entire Chunk/Document/Error object in.
 *
 * The allow-list is enforced structurally: `recordDiagnosticEvent` only ever
 * reads a fixed set of primitive fields off whatever it's given (and, for a
 * thrown value, only the typed `AppError.code`, never `.message`/`.cause`/
 * `.stack`, all of which could echo page content back verbatim in the
 * `unknown` fallback case). Nothing else about the input is ever stored,
 * copied, or serialized, so a diagnostic entry structurally cannot contain
 * arbitrary text: see `tests/unit/diagnostics.test.ts` for a test that feeds
 * a full chunk/document-shaped object in and asserts on exactly that.
 */

export type DiagnosticArea = 'extraction' | 'ingest' | 'ai' | 'storage' | 'provider';

export interface DiagnosticEvent {
  timestamp: number;
  area: DiagnosticArea;
  outcome: 'success' | 'failure';
  /** Stable, content-free error code (see src/core/errors.ts) — never a raw
   * error message, which could contain retrieved chunk text. */
  code?: ErrorCode;
  /** Adapter/provider/session identifiers — names only, never content. */
  adapter?: string;
  provider?: string;
  capabilityLevel?: number;
  /** Measured duration, for the performance section of Diagnostics. */
  latencyMs?: number;
}

export interface RecordDiagnosticEventInput {
  area: DiagnosticArea;
  outcome: 'success' | 'failure';
  adapter?: string;
  provider?: string;
  capabilityLevel?: number;
  latencyMs?: number;
  /** Anything thrown/caught. Only `.code` is read off it (if it's an
   * AppError) — every other property, however page-content-shaped, is
   * ignored. Passing a whole object (e.g. by mistake) is safe by design. */
  errorSource?: unknown;
}

const MAX_EVENTS = 50;
const inMemoryLog: DiagnosticEvent[] = [];
let persistChain: Promise<void> = Promise.resolve();

/** For tests: resolves once every queued persistence write has settled. */
export function flushDiagnosticsPersistence(): Promise<void> {
  return persistChain;
}

/** Reads only an allow-listed set of primitive fields off arbitrary input.
 * This is the actual enforcement point: even if a caller passes a Chunk or
 * StructuredDocument object as `adapter`/`provider` by mistake, only a
 * short, coerced string survives — never the object's other fields. */
function safeString(value: unknown, maxLen = 64): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function codeFromErrorSource(errorSource: unknown): ErrorCode | undefined {
  if (errorSource instanceof AppError) return errorSource.code;
  return undefined;
}

export function recordDiagnosticEvent(input: RecordDiagnosticEventInput): DiagnosticEvent {
  const event: DiagnosticEvent = {
    timestamp: Date.now(),
    area: input.area,
    outcome: input.outcome,
    code: codeFromErrorSource(input.errorSource),
    adapter: safeString(input.adapter),
    provider: safeString(input.provider),
    capabilityLevel: safeNumber(input.capabilityLevel),
    latencyMs: safeNumber(input.latencyMs),
  };
  inMemoryLog.push(event);
  if (inMemoryLog.length > MAX_EVENTS) inMemoryLog.shift();

  // Best-effort persistence so the Diagnostics panel survives a service
  // worker restart. DATA-04: writes are serialized through one promise
  // chain — the previous unsynchronized get-then-set let two concurrent
  // events read the same old array and the second write drop the first.
  // A persistence failure is reported to the console (never re-logged
  // through this same path, which could loop) rather than silently dropped.
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    persistChain = persistChain
      .then(async () => {
        const stored = await chrome.storage.local.get(['diagnosticsLog']);
        const existing: DiagnosticEvent[] = Array.isArray(stored.diagnosticsLog) ? stored.diagnosticsLog : [];
        await chrome.storage.local.set({ diagnosticsLog: [...existing, event].slice(-MAX_EVENTS) });
      })
      .catch((err) => {
        console.warn('[diagnostics] could not persist diagnostic event', err);
      });
  }

  return event;
}

/** In-memory events recorded since this context (service worker/UI) loaded. */
export function getRecentDiagnosticEvents(): DiagnosticEvent[] {
  return [...inMemoryLog];
}

/** Reads the persisted log from chrome.storage.local (survives service
 * worker restarts); falls back to the in-memory log outside the extension
 * runtime (e.g. unit tests, a dev preview). */
export async function loadDiagnosticsLog(): Promise<DiagnosticEvent[]> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const stored = await chrome.storage.local.get(['diagnosticsLog']);
      if (Array.isArray(stored.diagnosticsLog)) return stored.diagnosticsLog;
    } catch {
      /* fall through to in-memory */
    }
  }
  return getRecentDiagnosticEvents();
}

/** For tests only: clears the in-memory ring buffer between test cases. */
export function resetDiagnosticsForTests(): void {
  inMemoryLog.length = 0;
}
