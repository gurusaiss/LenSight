import { buildPrompt, type UntrustedChunk } from '../../security/promptTemplate';
import { ProviderUnauthorizedError, ProviderUnreachableError, RateLimitedError } from '../../errors';
import type { AIProvider, AIProviderResult, ConversationTurn } from './AIProvider';

/**
 * Remote provider: Google Generative Language API (Gemini), `generateContent`.
 *
 * The API key is NEVER hardcoded. In the extension it must be read from
 * `chrome.storage.local` (see src/ui/hooks/useAssistant.ts / background
 * message handlers); in Node/tests it is read from an environment variable
 * or injected explicitly via the constructor. This class never contains a
 * literal key string.
 *
 * This is Mode B (local data, remote AI) from the Privacy Architecture:
 * only the retrieved chunks + question are sent here — never the raw page.
 */
export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = 'gemini-1.5-flash';

export class GeminiProvider implements AIProvider {
  name = 'gemini';
  mode: 'remote' = 'remote';

  private apiKey: string | undefined;
  private model: string;
  private fetchImpl: typeof fetch;

  constructor(options: GeminiProviderOptions = {}) {
    this.apiKey = options.apiKey ?? (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : undefined);
    this.model = options.model ?? DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(
    systemPrompt: string,
    userQuestion: string,
    untrustedContext: UntrustedChunk[],
    _history?: ConversationTurn[],
  ): Promise<AIProviderResult> {
    if (!this.apiKey) {
      throw new ProviderUnauthorizedError('Gemini', {
        message:
          'Gemini needs an API key. Set one in the extension Settings page (stored only in ' +
          'chrome.storage.local) or GEMINI_API_KEY for local/testing use — a key is never hardcoded.',
      });
    }

    const { system, user } = buildPrompt(userQuestion, untrustedContext, systemPrompt);

    // SEC-06: the key goes in the `x-goog-api-key` header (supported by the
    // Generative Language API), never the URL — a `?key=` query string ends
    // up in error objects/diagnostic details, proxies and logs. The model id
    // is user-entered, so it is path-encoded.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
    };

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderUnreachableError('Gemini', 'generativelanguage.googleapis.com', { cause: err });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new ProviderUnauthorizedError('Gemini', { detail: { status: res.status }, cause: errText });
      }
      if (res.status === 429) {
        throw new RateLimitedError('Gemini', { detail: { status: res.status }, cause: errText });
      }
      throw new ProviderUnreachableError('Gemini', url, {
        detail: { status: res.status },
        cause: errText,
        message: `Gemini request failed (${res.status}): ${errText || 'no further detail from the API'}.`,
      });
    }

    const json = await res.json();
    const answer: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';

    const usedChunkIds = untrustedContext
      .filter((c) => answer.includes(c.chunkId))
      .map((c) => c.chunkId);

    return { answer, usedChunkIds };
  }
}
