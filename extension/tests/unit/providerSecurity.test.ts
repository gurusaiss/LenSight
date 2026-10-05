import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ModeAViolationError,
  isLoopbackUrl,
  resolveOllamaBaseUrl,
  selectAIProvider,
} from '../../src/core/ai/providerSelection';
import { GeminiProvider } from '../../src/core/ai/providers/geminiProvider';

/** Audit remediation tests: SEC-02 (Mode A leak via stale baseUrl) and SEC-06 (Gemini key in URL). */

afterEach(() => {
  vi.unstubAllGlobals();
});

function okOllamaResponse() {
  return new Response(JSON.stringify({ response: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('SEC-02: Mode A + Ollama never contacts a remote host', () => {
  it('reproduction: stale OpenAI-compatible baseUrl + blank ollamaBaseUrl must NOT become the Ollama endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okOllamaResponse());
    vi.stubGlobal('fetch', fetchMock);
    const provider = selectAIProvider({
      privacyMode: 'A',
      providerKind: 'ollama',
      baseUrl: 'https://api.openai.com/v1', // left over from a previous Mode B session
      ollamaBaseUrl: '', // the Settings field left blank (its placeholder shows the default)
    });
    await provider.generate('sys', 'What is on this page?', [{ chunkId: 'chk_1', text: 'private page text' }]);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toBe('http://localhost:11434/api/generate');
    expect(calledUrl).not.toContain('openai.com');
  });

  it('reproduction: ollamaBaseUrl never saved (undefined) + stale remote baseUrl -> still localhost, not the remote host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okOllamaResponse());
    vi.stubGlobal('fetch', fetchMock);
    const provider = selectAIProvider({ privacyMode: 'A', providerKind: 'ollama', baseUrl: 'https://openrouter.ai/api/v1' });
    await provider.generate('sys', 'q', [{ chunkId: 'chk_1', text: 'private page text' }]);
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:11434/api/generate');
  });

  it('refuses (throws before any request) when Mode A is given a non-loopback Ollama URL', () => {
    expect(() =>
      selectAIProvider({ privacyMode: 'A', providerKind: 'ollama', ollamaBaseUrl: 'https://ollama.example.com' }),
    ).toThrow(ModeAViolationError);
  });

  it('allows loopback variants in Mode A', () => {
    for (const url of ['http://localhost:11434', 'http://127.0.0.1:11434', 'http://[::1]:11434']) {
      expect(resolveOllamaBaseUrl({ ollamaBaseUrl: url }, true)).toBe(url);
    }
  });

  it('does not treat look-alike hosts as loopback', () => {
    expect(isLoopbackUrl('http://localhost.evil.example')).toBe(false);
    expect(isLoopbackUrl('http://127.0.0.1.nip.io')).toBe(false);
    expect(isLoopbackUrl('file:///etc/passwd')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });

  it('Mode B may use a remote Ollama server, but still never the OpenAI-compatible baseUrl', () => {
    expect(resolveOllamaBaseUrl({ ollamaBaseUrl: 'https://ollama.example.com' }, false)).toBe('https://ollama.example.com');
    expect(resolveOllamaBaseUrl({ baseUrl: 'https://api.openai.com/v1' }, false)).toBe('http://localhost:11434');
  });
});

describe('SEC-06: Gemini API key is sent in a header, never in the URL', () => {
  it('puts the key in x-goog-api-key and keeps it out of the request URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'answer' }] } }] }), { status: 200 }),
    );
    const provider = new GeminiProvider({ apiKey: 'SECRET-KEY-123', model: 'gemini-1.5-flash', fetchImpl: fetchMock as any });
    await provider.generate('sys', 'q', []);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain('SECRET-KEY-123');
    expect(String(url)).not.toContain('key=');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('SECRET-KEY-123');
  });

  it('error objects for failed requests do not carry the key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('server error', { status: 500 }));
    const provider = new GeminiProvider({ apiKey: 'SECRET-KEY-123', fetchImpl: fetchMock as any });
    const err: any = await provider.generate('sys', 'q', []).catch((e: unknown) => e);
    expect(JSON.stringify({ msg: err.userMessage, detail: err.detail })).not.toContain('SECRET-KEY-123');
  });

  it('path-encodes a user-entered model id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    const provider = new GeminiProvider({ apiKey: 'k', model: '../../evil?x=', fetchImpl: fetchMock as any });
    await provider.generate('sys', 'q', []);
    expect(String(fetchMock.mock.calls[0][0])).toContain('models/..%2F..%2Fevil%3Fx%3D:generateContent');
  });
});
