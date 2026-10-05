import type { EmbeddingProvider } from './embeddings/EmbeddingProvider';
import { hashingEmbeddingProvider } from './embeddings/hashingEmbeddingProvider';
import { transformersEmbeddingProvider } from './embeddings/transformersEmbeddingProvider';
import type { AIProvider } from './providers/AIProvider';
import { extractiveLocalProvider } from './providers/extractiveLocalProvider';
import { GeminiProvider } from './providers/geminiProvider';
import { DEFAULT_OLLAMA_BASE_URL, OllamaProvider } from './providers/ollamaProvider';
import { AppError } from '../errors';
import { isLoopbackUrl } from '../net/loopback';

export { isLoopbackUrl };
import { OpenAICompatibleProvider } from './providers/openAICompatibleProvider';
import type { PrivacyMode } from '../types';

/**
 * Single place that turns a stored settings object (as read from
 * `chrome.storage.local`, see `entrypoints/background.ts`) into concrete
 * `EmbeddingProvider`/`AIProvider` instances. This is what makes provider
 * selection a genuine runtime choice driven by the user's settings rather
 * than a hardcoded import somewhere in the request path — the orchestrator
 * and background message router both call these two functions instead of
 * constructing/importing a specific provider class themselves.
 */

export type EmbeddingProviderKind = 'hashing' | 'transformers';
export type GenerationProviderKind = 'extractive-local' | 'ollama' | 'gemini' | 'openai-compatible';

/** Generation options that never leave the device — offered in every mode,
 * but the ONLY generation options offered when Privacy Mode is 'A'. */
export const LOCAL_ONLY_GENERATION_KINDS: GenerationProviderKind[] = ['extractive-local', 'ollama'];

/** Embedding options are local in every mode (embeddings never leave the
 * device regardless of privacy mode — only *generation* can go remote) but
 * differ in setup cost: hashing needs no install/download, transformers
 * needs a one-time model download. */
export const LOCAL_ONLY_EMBEDDING_KINDS: EmbeddingProviderKind[] = ['hashing', 'transformers'];

export interface StoredAIConfig {
  privacyMode?: PrivacyMode;
  embeddingProviderKind?: EmbeddingProviderKind;
  providerKind?: GenerationProviderKind;
  apiKey?: string;
  baseUrl?: string;
  ollamaBaseUrl?: string;
  model?: string;
}

/**
 * Selects the concrete EmbeddingProvider for the given stored config.
 * Defaults to `hashingEmbeddingProvider` (zero-setup, zero-network) unless
 * the user has explicitly opted into `transformers` (real neural
 * embeddings, one-time model download — see transformersEmbeddingProvider.ts).
 */
export function selectEmbeddingProvider(config: StoredAIConfig): EmbeddingProvider {
  if (config.embeddingProviderKind === 'transformers') return transformersEmbeddingProvider;
  return hashingEmbeddingProvider;
}

/**
 * Selects the concrete AIProvider for the given stored config.
 *
 * Mode A (fully local) is enforced HERE, not just in the settings UI: even
 * if stale `providerKind`/`apiKey` values from a previous Mode B/C session
 * are still sitting in storage, switching `privacyMode` to `'A'` always
 * constructs a local-only provider (never Gemini/OpenAI-compatible), so a
 * UI bug or storage inconsistency can never silently leak data off-device.
 */
export function selectAIProvider(config: StoredAIConfig): AIProvider {
  const kind = config.providerKind ?? 'extractive-local';

  if (config.privacyMode === 'A') {
    if (kind === 'ollama') {
      return new OllamaProvider({ baseUrl: resolveOllamaBaseUrl(config, true), model: config.model });
    }
    return extractiveLocalProvider;
  }

  if (kind === 'ollama') {
    return new OllamaProvider({ baseUrl: resolveOllamaBaseUrl(config, false), model: config.model });
  }
  if (kind === 'gemini' && config.apiKey) {
    return new GeminiProvider({ apiKey: config.apiKey, model: config.model });
  }
  if (kind === 'openai-compatible' && (config.apiKey || config.baseUrl)) {
    return new OpenAICompatibleProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model });
  }
  return extractiveLocalProvider;
}

/**
 * Ollama base URL for the given config (audit issue SEC-02).
 *
 * Root cause: this used to be `config.ollamaBaseUrl ?? config.baseUrl`.
 * `baseUrl` is the OpenAI-compatible provider's endpoint (e.g.
 * https://api.openai.com/v1 or https://openrouter.ai/api/v1) and stays in
 * storage after the user switches to Mode A + Ollama. With `ollamaBaseUrl`
 * left blank (its placeholder shows the default, so blank is the normal
 * case), the "fully local" Ollama provider POSTed the question AND the
 * retrieved page chunks to that remote host's `/api/generate` — breaking
 * Mode A's "nothing ever leaves the device" guarantee.
 *
 * Now: only `ollamaBaseUrl` is ever used (default http://localhost:11434),
 * and in Mode A it must be a loopback address or the request is refused
 * before anything is sent.
 */
export function resolveOllamaBaseUrl(config: StoredAIConfig, requireLoopback: boolean): string {
  const configured = config.ollamaBaseUrl?.trim();
  const baseUrl = configured ? configured : DEFAULT_OLLAMA_BASE_URL;
  if (requireLoopback && !isLoopbackUrl(baseUrl)) {
    throw new ModeAViolationError(baseUrl);
  }
  return baseUrl;
}

/** Thrown instead of contacting a non-local host while Mode A is active. */
export class ModeAViolationError extends AppError {
  constructor(endpoint: string) {
    super(
      'provider_unreachable',
      `Mode A (fully local) only allows an Ollama daemon on this machine (localhost / 127.0.0.1), but the ` +
        `configured Ollama base URL is "${endpoint}". Nothing was sent. Change the Ollama base URL in Settings ` +
        `to a local address, or switch to Mode B if you intend to use a remote server.`,
      { detail: { endpoint } },
    );
  }
}
