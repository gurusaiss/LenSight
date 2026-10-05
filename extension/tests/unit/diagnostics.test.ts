import { beforeEach, describe, expect, it } from 'vitest';
import { ModelUnavailableError } from '../../src/core/errors';
import { getRecentDiagnosticEvents, recordDiagnosticEvent, resetDiagnosticsForTests } from '../../src/core/diagnostics';

const ALLOWED_KEYS = new Set(['timestamp', 'area', 'outcome', 'code', 'adapter', 'provider', 'capabilityLevel', 'latencyMs']);

describe('diagnostics (structurally content-free)', () => {
  beforeEach(() => {
    resetDiagnosticsForTests();
  });

  it('records only allow-listed fields for a normal success event', () => {
    const event = recordDiagnosticEvent({
      area: 'ingest',
      outcome: 'success',
      adapter: 'genericWebAdapter',
      provider: 'hashing-bow-v1',
      capabilityLevel: 1,
      latencyMs: 42,
    });
    expect(Object.keys(event).every((k) => ALLOWED_KEYS.has(k))).toBe(true);
    expect(event.adapter).toBe('genericWebAdapter');
    expect(event.latencyMs).toBe(42);
  });

  it('extracts only the stable error code from a thrown AppError, never its message', () => {
    const err = new ModelUnavailableError('Ollama', 'llama3.1');
    const event = recordDiagnosticEvent({ area: 'ai', outcome: 'failure', errorSource: err });
    expect(event.code).toBe('model_unavailable');
    expect(JSON.stringify(event)).not.toMatch(/llama3\.1/);
    expect(JSON.stringify(event)).not.toMatch(/ollama pull/i);
  });

  it('cannot be made to carry arbitrary page content, even if a whole chunk/document object is passed in', () => {
    // Simulates a caller accidentally passing a full Chunk/StructuredDocument
    // object (containing real, sensitive page text) instead of a plain
    // string for `adapter`/`provider`/`errorSource` — the mandatory test the
    // task specifies. Only a coerced primitive (or nothing, for a non-string)
    // may ever end up in the stored event.
    const secretPageContent = 'CONFIDENTIAL: the user\'s bank balance is $1,234,567 and their SSN is 000-00-0000';
    const maliciousChunk = {
      id: 'chk_1',
      documentId: 'doc_1',
      sourceId: 'src_1',
      text: secretPageContent,
      position: 0,
      toString() {
        return secretPageContent;
      },
    };

    const event = recordDiagnosticEvent({
      area: 'extraction',
      outcome: 'failure',
      // @ts-expect-error intentionally passing the wrong shape to prove the
      // allow-list holds even when misused.
      adapter: maliciousChunk,
      // @ts-expect-error same as above.
      provider: maliciousChunk,
      errorSource: maliciousChunk,
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toMatch(/CONFIDENTIAL/);
    expect(serialized).not.toMatch(/bank balance/);
    expect(serialized).not.toMatch(/SSN/);
    expect(Object.keys(event).every((k) => ALLOWED_KEYS.has(k))).toBe(true);
    // A non-string, non-AppError input is simply dropped, not stringified.
    expect(event.adapter).toBeUndefined();
    expect(event.provider).toBeUndefined();
    expect(event.code).toBeUndefined();
  });

  it('caps stored events at the ring-buffer limit', () => {
    for (let i = 0; i < 60; i += 1) {
      recordDiagnosticEvent({ area: 'ai', outcome: 'success', latencyMs: i });
    }
    expect(getRecentDiagnosticEvents().length).toBeLessThanOrEqual(50);
  });
});
