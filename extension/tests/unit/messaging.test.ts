import { describe, expect, it, vi } from 'vitest';
import { MAX_IMPORT_BASE64_LENGTH, base64ToBytes, bytesToBase64, isBase64 } from '../../src/core/messaging/binary';
import {
  MAX_QUESTION_LENGTH,
  isTrustedExtensionSender,
  validateExtensionMessage,
} from '../../src/core/messaging/validate';
import { resolveAskScope } from '../../src/core/messaging/scope';
import {
  CONTENT_SCRIPT_FILE,
  isNoReceiverError,
  sendToContentScript,
} from '../../src/core/messaging/contentScript';
import { TabAccessDeniedError } from '../../src/core/errors';

/**
 * Audit remediation tests: FUN-01 (binary transport), SEC-01 (sender +
 * shape validation), FUN-02 (retrieval scope), CMP-01/FUN-03 (on-demand
 * content-script injection).
 */

describe('FUN-01: binary payloads survive JSON-serialized extension messaging', () => {
  it('reproduces the root cause: a raw ArrayBuffer JSON-serializes to {} (what Chrome delivers)', () => {
    const bytes = new TextEncoder().encode('hello, world');
    const roundTripped = JSON.parse(JSON.stringify({ bytes: bytes.buffer }));
    expect(roundTripped.bytes).toEqual({});
  });

  it('base64 round-trips arbitrary bytes exactly through JSON', () => {
    const bytes = new Uint8Array(70_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31 + 7) % 256;
    const msg = JSON.parse(JSON.stringify({ bytesBase64: bytesToBase64(bytes.buffer) }));
    expect(Array.from(base64ToBytes(msg.bytesBase64))).toEqual(Array.from(bytes));
  });

  it('round-trips UTF-8 text files byte-for-byte', () => {
    const text = 'Zürich — naïve café 日本語 😀';
    const b64 = bytesToBase64(new TextEncoder().encode(text));
    expect(new TextDecoder().decode(base64ToBytes(b64))).toBe(text);
  });

  it('rejects non-base64 payloads instead of decoding garbage', () => {
    expect(isBase64('not base64!!')).toBe(false);
    expect(() => base64ToBytes('%%%%')).toThrow(/Invalid base64/);
  });
});

describe('SEC-01: background only trusts its own extension pages', () => {
  const id = 'abcdefghijklmnopabcdefghijklmnop';

  it('accepts the side panel / options page', () => {
    expect(isTrustedExtensionSender({ id, url: `chrome-extension://${id}/sidepanel.html` }, id)).toBe(true);
    expect(
      isTrustedExtensionSender({ id, url: `chrome-extension://${id}/options.html`, origin: `chrome-extension://${id}` }, id),
    ).toBe(true);
  });

  it('rejects a content script (same extension id, but a web page url/origin)', () => {
    expect(isTrustedExtensionSender({ id, url: 'https://evil.example/page', origin: 'https://evil.example' }, id)).toBe(false);
  });

  it('rejects other extensions and look-alike urls', () => {
    expect(isTrustedExtensionSender({ id: 'other', url: `chrome-extension://other/x.html` }, id)).toBe(false);
    expect(isTrustedExtensionSender({ id, url: `chrome-extension://${id}.evil.example/x` }, id)).toBe(false);
    expect(isTrustedExtensionSender({ id, url: `chrome-extension://${id}/x`, origin: 'https://evil.example' }, id)).toBe(false);
    expect(isTrustedExtensionSender(undefined, id)).toBe(false);
  });
});

describe('SEC-01: runtime message validation', () => {
  it('rejects non-objects and unknown types', () => {
    expect(validateExtensionMessage(null).ok).toBe(false);
    expect(validateExtensionMessage('DELETE_ALL_DATA').ok).toBe(false);
    expect(validateExtensionMessage({ type: 'RUN_EVAL' }).ok).toBe(false);
  });

  it('rejects an ASK_QUESTION whose question is not a bounded string', () => {
    expect(validateExtensionMessage({ type: 'ASK_QUESTION', question: { toString: 1 }, sourceIds: ['s'] }).ok).toBe(false);
    expect(validateExtensionMessage({ type: 'ASK_QUESTION', question: '   ', sourceIds: ['s'] }).ok).toBe(false);
    expect(
      validateExtensionMessage({ type: 'ASK_QUESTION', question: 'x'.repeat(MAX_QUESTION_LENGTH + 1), sourceIds: ['s'] }).ok,
    ).toBe(false);
  });

  it('FUN-02: rejects an unscoped ASK_QUESTION (would have searched every source ever captured)', () => {
    const r = validateExtensionMessage({ type: 'ASK_QUESTION', question: 'What is this?' });
    expect(r.ok).toBe(false);
    expect(validateExtensionMessage({ type: 'ASK_QUESTION', question: 'q', sourceIds: [] }).ok).toBe(false);
    expect(validateExtensionMessage({ type: 'ASK_QUESTION', question: 'q', sourceIds: ['src_1'] }).ok).toBe(true);
    expect(validateExtensionMessage({ type: 'ASK_QUESTION', question: 'q', sessionId: 'ses_1' }).ok).toBe(true);
  });

  it('rejects a malformed EXTRACT_RESULT document and unknown adapters', () => {
    const doc = { id: '', sourceId: '', title: 't', text: 'body', metadata: { url: 'https://a.example', title: 't' } };
    const base = { type: 'EXTRACT_RESULT', document: doc, capabilityLevel: 1, confidence: 'high', adapterUsed: 'genericWebAdapter' };
    expect(validateExtensionMessage(base).ok).toBe(true);
    expect(validateExtensionMessage({ ...base, document: { ...doc, text: 42 } }).ok).toBe(false);
    expect(validateExtensionMessage({ ...base, document: { ...doc, blocks: [{ type: 'script', text: 'x' }] } }).ok).toBe(false);
    expect(validateExtensionMessage({ ...base, capabilityLevel: 9 }).ok).toBe(false);
    expect(validateExtensionMessage({ ...base, adapterUsed: 'pdfAdapter' }).ok).toBe(false);
  });

  it('rejects IMPORT_LOCAL_FILE with a raw ArrayBuffer-shaped payload or oversize file', () => {
    expect(validateExtensionMessage({ type: 'IMPORT_LOCAL_FILE', fileName: 'a.txt', fileType: 'text/plain', bytes: {} }).ok).toBe(false);
    expect(
      validateExtensionMessage({ type: 'IMPORT_LOCAL_FILE', fileName: 'a.txt', fileType: 'text/plain', bytesBase64: bytesToBase64(new Uint8Array([1, 2, 3])) }).ok,
    ).toBe(true);
    expect(
      validateExtensionMessage({ type: 'IMPORT_LOCAL_FILE', fileName: 'a.txt', fileType: '', bytesBase64: 'A'.repeat(MAX_IMPORT_BASE64_LENGTH + 4) }).ok,
    ).toBe(false);
  });

  it('rejects IMPORT_DATA payloads that are not a valid export', () => {
    expect(validateExtensionMessage({ type: 'IMPORT_DATA', data: 42 }).ok).toBe(false);
    expect(validateExtensionMessage({ type: 'IMPORT_DATA', data: { version: 1 } }).ok).toBe(false);
  });

  it('strips unexpected fields from parameterless messages', () => {
    const r = validateExtensionMessage({ type: 'EXPORT_DATA', extra: 'x' });
    expect(r.ok && r.message).toEqual({ type: 'EXPORT_DATA' });
  });
});

describe('FUN-02: side panel retrieval scope', () => {
  it('uses the current source when no session is active', () => {
    expect(resolveAskScope(null, 'src_1')).toEqual({ ok: true, sourceIds: ['src_1'] });
  });
  it('uses the active session when one is selected', () => {
    expect(resolveAskScope('ses_1', 'src_1')).toEqual({ ok: true, sessionId: 'ses_1' });
  });
  it('refuses to ask with nothing in scope', () => {
    expect(resolveAskScope(null, null).ok).toBe(false);
  });
});

describe('CMP-01 / FUN-03: on-demand content-script injection', () => {
  it('sends directly when the content script is already present (no injection)', async () => {
    const deps = { sendMessage: vi.fn().mockResolvedValue({ ok: true }), executeScript: vi.fn() };
    await expect(sendToContentScript(7, { type: 'REQUEST_EXTRACT' }, deps)).resolves.toEqual({ ok: true });
    expect(deps.executeScript).not.toHaveBeenCalled();
  });

  it('injects the content script and retries when the tab has no receiver yet', async () => {
    const deps = {
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
        .mockResolvedValueOnce({ ok: true, found: true }),
      executeScript: vi.fn().mockResolvedValue([]),
    };
    await expect(sendToContentScript(7, { type: 'HIGHLIGHT_CITATION' }, deps)).resolves.toEqual({ ok: true, found: true });
    expect(deps.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: [CONTENT_SCRIPT_FILE] });
    expect(deps.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('maps "cannot access" injection failures to an actionable TabAccessDeniedError', async () => {
    const deps = {
      sendMessage: vi.fn().mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.')),
      executeScript: vi.fn().mockRejectedValue(new Error('Cannot access a chrome:// URL')),
    };
    const err: any = await sendToContentScript(7, {}, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TabAccessDeniedError);
    expect(err.userMessage).toMatch(/toolbar icon/);
  });

  it('does not mask unrelated messaging errors', async () => {
    const deps = { sendMessage: vi.fn().mockRejectedValue(new Error('boom')), executeScript: vi.fn() };
    await expect(sendToContentScript(7, {}, deps)).rejects.toThrow('boom');
    expect(isNoReceiverError(new Error('boom'))).toBe(false);
  });
});
