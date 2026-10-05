import { buildPrompt, type UntrustedChunk } from '../../security/promptTemplate';
import { ProviderUnauthorizedError, ProviderUnreachableError, RateLimitedError } from '../../errors';
import type { AIProvider, AIProviderResult, ConversationTurn } from './AIProvider';
import { isLoopbackUrl } from '../../net/loopback';

/**
 * Remote (or locally-hosted) provider that speaks the OpenAI
 * `/chat/completions` wire format. One adapter covers OpenAI, OpenRouter,
 * Groq, and a local Ollama instance run with its OpenAI-compatible endpoint
 * (e.g. `http://localhost:11434/v1`) — configurable via `baseUrl`.
 *
 * The API key is never hardcoded — see GeminiProvider's comment for the same
 * rule; it applies identically here. A local Ollama endpoint typically needs
 * no real key, so an empty/placeholder key is accepted for that case only.
 */
export interface OpenAICompatibleOptions {
  apiKey?: string;
  baseUrl?: string; // e.g. https://api.openai.com/v1, https://openrouter.ai/api/v1, http://localhost:11434/v1
  model?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export class OpenAICompatibleProvider implements AIProvider {
  name = 'openai-compatible';
  mode: 'remote' = 'remote';

  private apiKey: string | undefined;
  private baseUrl: string;
  private model: string;
  private fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleOptions = {}) {
    this.apiKey = options.apiKey ?? (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : undefined);
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = options.model ?? DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(
    systemPrompt: string,
    userQuestion: string,
    untrustedContext: UntrustedChunk[],
    history: ConversationTurn[] = [],
  ): Promise<AIProviderResult> {
    // Parsed-host check, not a substring regex (which also matched e.g.
    // https://localhost.attacker.example and skipped the key requirement).
    const isLocalEndpoint = isLoopbackUrl(this.baseUrl);
    if (!this.apiKey && !isLocalEndpoint) {
      throw new ProviderUnauthorizedError(this.name, {
        message:
          `This provider (${this.baseUrl}) needs an API key. Configure one in extension Settings, or ` +
          `OPENAI_API_KEY for local/testing use — never hardcoded. A local endpoint (localhost/127.0.0.1) ` +
          `doesn't need one.`,
      });
    }

    const { system, user } = buildPrompt(userQuestion, untrustedContext, systemPrompt);

    const messages = [
      { role: 'system', content: system },
      ...history.map((h) => ({ role: h.role, content: h.text })),
      { role: 'user', content: user },
    ];

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.model, messages }),
      });
    } catch (err) {
      throw new ProviderUnreachableError(this.name, this.baseUrl, { cause: err });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new ProviderUnauthorizedError(this.name, { detail: { status: res.status }, cause: errText });
      }
      if (res.status === 429) {
        throw new RateLimitedError(this.name, { detail: { status: res.status }, cause: errText });
      }
      throw new ProviderUnreachableError(this.name, this.baseUrl, {
        detail: { status: res.status },
        cause: errText,
        message: `${this.name} request to ${this.baseUrl} failed (${res.status}): ${errText || 'no further detail'}.`,
      });
    }

    const json = await res.json();
    const answer: string = json?.choices?.[0]?.message?.content ?? '';

    const usedChunkIds = untrustedContext
      .filter((c) => answer.includes(c.chunkId))
      .map((c) => c.chunkId);

    return { answer, usedChunkIds };
  }
}
