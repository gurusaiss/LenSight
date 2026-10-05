import { describe, expect, it, vi } from 'vitest';
import { OllamaProvider, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '../../src/core/ai/providers/ollamaProvider';
import { FENCE_OPEN, FENCE_CLOSE, BASE_SYSTEM_PROMPT } from '../../src/core/security/promptTemplate';

/**
 * OllamaProvider talks to a REAL local Ollama daemon in production — there
 * is no Ollama installed in this sandbox, so these tests mock `fetch`
 * exactly as `openAICompatibleProvider`'s equivalent tests do for other
 * remote-ish HTTP providers, per the task's explicit "honestly testable
 * without a real Ollama install" framing. What IS asserted for real, without
 * any mocking of our own code: the request is built via the shared
 * `buildPrompt` template (system/user/fenced-context all present and in the
 * right places), hits the correct native `/api/generate` endpoint with the
 * configured base URL, and the response is parsed from Ollama's actual
 * `{ response: string }` wire shape.
 */
describe('OllamaProvider', () => {
  it('defaults to http://localhost:11434 and a sensible default model', () => {
    const provider = new OllamaProvider();
    expect((provider as any).baseUrl).toBe(DEFAULT_OLLAMA_BASE_URL);
    expect((provider as any).model).toBe(DEFAULT_OLLAMA_MODEL);
  });

  it('POSTs to {baseUrl}/api/generate with a correctly-templated, non-streaming request body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'The answer is 42 [chunk_1].' }),
    });

    const provider = new OllamaProvider({
      baseUrl: 'http://localhost:11434',
      model: 'llama3.1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.generate(
      BASE_SYSTEM_PROMPT,
      'What is the answer?',
      [{ chunkId: 'chunk_1', text: 'The answer to everything is 42.' }],
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/generate');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('llama3.1');
    expect(body.stream).toBe(false);
    // The prompt sent to Ollama must be the shared, injection-safe template
    // — never a hand-assembled string bypassing promptTemplate.ts.
    expect(body.prompt).toContain(BASE_SYSTEM_PROMPT);
    expect(body.prompt).toContain('USER QUESTION:\nWhat is the answer?');
    expect(body.prompt).toContain(FENCE_OPEN);
    expect(body.prompt).toContain(FENCE_CLOSE);
    expect(body.prompt).toContain('The answer to everything is 42.');
    // Fenced content must appear strictly after the fence-open marker (real
    // structural ordering, not just presence) — same "escape-not-just-hope"
    // requirement the promptTemplate suite enforces elsewhere.
    expect(body.prompt.indexOf(FENCE_OPEN)).toBeLessThan(body.prompt.indexOf('The answer to everything is 42.'));

    // Response is parsed from Ollama's native shape ({ response: string }),
    // not OpenAI's ({ choices: [...] }).
    expect(result.answer).toBe('The answer is 42 [chunk_1].');
    expect(result.usedChunkIds).toEqual(['chunk_1']);
  });

  it('folds prior conversation history into the prompt (native endpoint has no messages array)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ response: 'ok' }) });
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await provider.generate(BASE_SYSTEM_PROMPT, 'Follow up?', [], [
      { role: 'user', text: 'earlier question' },
      { role: 'assistant', text: 'earlier answer' },
    ]);

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.prompt).toContain('USER: earlier question');
    expect(body.prompt).toContain('ASSISTANT: earlier answer');
    // History must come before the templated question/context, not after.
    expect(body.prompt.indexOf('USER: earlier question')).toBeLessThan(body.prompt.indexOf('USER QUESTION:'));
  });

  it('throws a clear, actionable error when Ollama is not reachable (connection failure)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const provider = new OllamaProvider({
      baseUrl: 'http://localhost:11434',
      model: 'llama3.1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.generate(BASE_SYSTEM_PROMPT, 'hi', [])).rejects.toThrow(
      /Ollama not reachable at http:\/\/localhost:11434.*install Ollama/i,
    );
  });

  it('throws a clear error naming the missing model on a 404 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'model "llama3.1" not found',
    });
    const provider = new OllamaProvider({ model: 'llama3.1', fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(provider.generate(BASE_SYSTEM_PROMPT, 'hi', [])).rejects.toThrow(/ollama pull llama3\.1/i);
  });

  it('surfaces a generic error for other non-2xx responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(provider.generate(BASE_SYSTEM_PROMPT, 'hi', [])).rejects.toThrow(/failed \(500\)/);
  });

  it('reports mode: local and name: ollama, per the AIProvider interface', () => {
    const provider = new OllamaProvider();
    expect(provider.mode).toBe('local');
    expect(provider.name).toBe('ollama');
  });
});
