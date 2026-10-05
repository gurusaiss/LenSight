import { isLoopbackUrl } from './net/loopback';
import type { PrivacyMode } from './types';

/**
 * Validation for the Settings form's free-text endpoint fields (audit issue
 * SEC-08). Previously any string was saved: a typo'd URL only surfaced later
 * as an opaque network error, a non-http(s) scheme was accepted, and a plain
 * `http://` remote endpoint would receive the user's API key (as a Bearer
 * header) unencrypted over the network.
 *
 * The same `isLoopbackUrl` rule that `providerSelection.ts` enforces at
 * request time is applied here, so the UI rejects a Mode A Ollama URL the
 * background would refuse anyway — two layers, one definition.
 */

export interface EndpointSettings {
  privacyMode: PrivacyMode;
  providerKind: 'extractive-local' | 'ollama' | 'gemini' | 'openai-compatible';
  baseUrl: string;
  ollamaBaseUrl: string;
}

export type SettingsErrors = Partial<Record<'baseUrl' | 'ollamaBaseUrl', string>>;

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function validateEndpointSettings(s: EndpointSettings): SettingsErrors {
  const errors: SettingsErrors = {};

  const base = s.baseUrl.trim();
  if (s.providerKind === 'openai-compatible' && base) {
    const url = parseHttpUrl(base);
    if (!url) {
      errors.baseUrl = 'Enter a full http(s) URL, e.g. https://api.openai.com/v1';
    } else if (url.protocol === 'http:' && !isLoopbackUrl(base)) {
      errors.baseUrl =
        'Remote endpoints must use https:// — over plain http:// your API key and the retrieved page content would be sent unencrypted. (http:// is fine for localhost.)';
    } else if (url.username || url.password) {
      errors.baseUrl = 'Do not put credentials in the URL — use the API key field.';
    }
  }

  const ollama = s.ollamaBaseUrl.trim();
  if (s.providerKind === 'ollama' && ollama) {
    if (!parseHttpUrl(ollama)) {
      errors.ollamaBaseUrl = 'Enter a full http(s) URL, e.g. http://localhost:11434';
    } else if (s.privacyMode === 'A' && !isLoopbackUrl(ollama)) {
      errors.ollamaBaseUrl =
        'Mode A (fully local) only allows an Ollama daemon on this machine (localhost / 127.0.0.1 / [::1]).';
    }
  }

  return errors;
}
