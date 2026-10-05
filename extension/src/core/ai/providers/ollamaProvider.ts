import { buildPrompt, type UntrustedChunk } from '../../security/promptTemplate';
import { ModelUnavailableError, ProviderUnreachableError } from '../../errors';
import type { AIProvider, AIProviderResult, ConversationTurn } from './AIProvider';

/**
 * Local generation via a user-installed Ollama daemon (Mode A — Fully Local
 * generation option).
 *
 * IMPORTANT HONESTY NOTE (see docs/LIMITATIONS.md / docs/PRIVACY.md): this is
 * "local" in the sense that no cloud provider is ever contacted — but the
 * model itself does NOT run inside the browser extension. A browser
 * extension cannot bundle or execute a multi-GB LLM binary; it can only make
 * an HTTP request to a model runtime that already exists on the user's
 * machine. This is exactly the "desktop companion" boundary the research doc
 * calls out (see "Native desktop apps" in the Feasibility section): Ollama
 * itself IS that local companion process here, just one the user installs
 * and runs themselves rather than one this codebase ships. If Ollama is not
 * installed/running, this provider must fail loudly with an actionable
 * error — never silently fall back to a different provider pretending to be
 * smarter than it is.
 *
 * Talks to Ollama's native, non-streaming `/api/generate` endpoint (not the
 * OpenAI-compatible `/v1/chat/completions` surface — that path is already
 * covered by `openAICompatibleProvider.ts`, which Ollama also exposes; this
 * file exists specifically to exercise Ollama's own native wire format so
 * both integration paths are real, tested code, not just documented).
 *
 * Prompt assembly is NOT duplicated here — `buildPrompt` from
 * `core/security/promptTemplate.ts` is the only place SYSTEM / USER QUESTION
 * / `<untrusted_context>` are assembled, per the injection-safety design
 * rule (see SECURITY.md). Ollama's native endpoint takes one prompt string
 * rather than a messages array, so the assembled three-channel prompt is
 * passed as-is via `buildPrompt(...).assembled`.
 */
export interface OllamaProviderOptions {
  /** Default: http://localhost:11434 — override for a non-default port/host. */
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'llama3.1';

export class OllamaProvider implements AIProvider {
  name = 'ollama';
  mode: 'local' = 'local';

  private baseUrl: string;
  private model: string;
  private fetchImpl: typeof fetch;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '');
    this.model = options.model ?? DEFAULT_OLLAMA_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(
    systemPrompt: string,
    userQuestion: string,
    untrustedContext: UntrustedChunk[],
    history: ConversationTurn[] = [],
  ): Promise<AIProviderResult> {
    // Ollama's native /api/generate endpoint takes a single prompt string,
    // not a messages array — so any prior conversation turns are folded into
    // the prompt text ahead of the (still centrally-assembled) SYSTEM/USER
    // QUESTION/untrusted-context template, rather than bypassing it.
    const historyText =
      history.length > 0
        ? `${history.map((h) => `${h.role.toUpperCase()}: ${h.text}`).join('\n')}\n\n`
        : '';
    const { assembled } = buildPrompt(userQuestion, untrustedContext, systemPrompt);
    const prompt = historyText + assembled;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt, stream: false }),
      });
    } catch (err) {
      // Network-level failure (connection refused, DNS, etc.) — this is the
      // expected, common case when Ollama simply isn't installed/running.
      // Surface a clear, actionable, typed error rather than a raw fetch error.
      throw new ProviderUnreachableError('Ollama', this.baseUrl, {
        cause: err,
        message:
          `Ollama not reachable at ${this.baseUrl} — install Ollama and pull a model ` +
          `(e.g. \`ollama pull ${this.model}\`), or switch providers in Settings. ` +
          `(${String((err as Error)?.message ?? err)})`,
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (res.status === 404) {
        throw new ModelUnavailableError('Ollama', this.model, {
          detail: { status: res.status },
          message:
            `Ollama responded but the model "${this.model}" was not found at ${this.baseUrl} — run ` +
            `\`ollama pull ${this.model}\` first, or choose a different model in Settings. (${errText})`,
        });
      }
      throw new ProviderUnreachableError('Ollama', this.baseUrl, {
        detail: { status: res.status },
        cause: errText,
        message: `OllamaProvider: request to ${this.baseUrl}/api/generate failed (${res.status}): ${errText}`,
      });
    }

    const json = await res.json();
    const answer: string = json?.response ?? '';

    const usedChunkIds = untrustedContext.filter((c) => answer.includes(c.chunkId)).map((c) => c.chunkId);

    return { answer, usedChunkIds };
  }
}
