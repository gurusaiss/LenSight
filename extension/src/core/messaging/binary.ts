/**
 * Binary <-> string transport for `chrome.runtime.sendMessage`.
 *
 * Chrome's extension messaging contract requires JSON-serializable messages
 * (runtime.sendMessage docs: "The message to send. This message should be a
 * JSON-ifiable object."). An `ArrayBuffer`/`Uint8Array` does NOT survive that:
 * `JSON.stringify(new ArrayBuffer(8))` is `"{}"`, so a file's bytes sent as a
 * raw ArrayBuffer arrive in the background worker as an empty object and
 * `new File([{}], ...)` silently produces a file whose contents are the
 * string "[object Object]". That was the root cause of audit issue FUN-01
 * (local file import broken on Chrome). Base64 is JSON-safe and round-trips
 * exactly, at a ~33% size cost, which is why imports are also size-capped.
 */

/** Hard cap on an imported file's size. Keeps the base64 message (~1.33x)
 * comfortably under Chrome's 64 MiB extension-message limit and bounds the
 * memory the background worker spends parsing one file. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/** Base64 length that corresponds to MAX_IMPORT_BYTES (4 chars per 3 bytes, padded). */
export const MAX_IMPORT_BASE64_LENGTH = Math.ceil(MAX_IMPORT_BYTES / 3) * 4;

const CHUNK = 0x8000; // stay well under engines' argument-count limits for fromCharCode.apply

export function bytesToBase64(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function isBase64(value: unknown): value is string {
  return typeof value === 'string' && value.length % 4 === 0 && BASE64_RE.test(value);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (!isBase64(b64)) {
    throw new TypeError('Invalid base64 payload.');
  }
  const binary = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
