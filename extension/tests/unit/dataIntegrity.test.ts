import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeEntities } from '../../src/core/processing/clean';
import {
  flushDiagnosticsPersistence,
  recordDiagnosticEvent,
  resetDiagnosticsForTests,
} from '../../src/core/diagnostics';

/** Audit remediation tests: DATA-03 (entity decoding), DATA-04 (diagnostics persistence race). */

describe('DATA-03: numeric HTML entities decode correctly', () => {
  it('decodes astral-plane decimal entities (was: truncated to a BMP char)', () => {
    expect(decodeEntities('smile &#128512;')).toBe('smile 😀');
  });
  it('decodes hex entities (were left undecoded)', () => {
    expect(decodeEntities('it&#x2019;s &#X41;')).toBe('it’s A');
  });
  it('leaves invalid code points untouched instead of throwing', () => {
    expect(decodeEntities('&#0; &#xD800; &#1114112;')).toBe('&#0; &#xD800; &#1114112;');
  });
  it('still decodes the named entities it supported before', () => {
    expect(decodeEntities('a &amp; b &mdash; c')).toBe('a & b — c');
  });
});

describe('DATA-04: concurrent diagnostic events are all persisted', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetDiagnosticsForTests();
  });

  it('does not lose events to a read-modify-write race', async () => {
    let store: Record<string, unknown> = {};
    const delay = () => new Promise((r) => setTimeout(r, 1));
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (keys: string[]) => {
            await delay();
            return Object.fromEntries(keys.map((k) => [k, store[k]]));
          },
          set: async (items: Record<string, unknown>) => {
            await delay();
            store = { ...store, ...items };
          },
        },
      },
    });
    for (let i = 0; i < 5; i += 1) recordDiagnosticEvent({ area: 'ai', outcome: 'success', latencyMs: i });
    await flushDiagnosticsPersistence();
    expect((store.diagnosticsLog as unknown[]).length).toBe(5);
  });
});
