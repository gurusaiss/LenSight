import { describe, expect, it } from 'vitest';
import { selectAIProvider, selectEmbeddingProvider } from '../../src/core/ai/providerSelection';
import { hashingEmbeddingProvider } from '../../src/core/ai/embeddings/hashingEmbeddingProvider';
import { transformersEmbeddingProvider } from '../../src/core/ai/embeddings/transformersEmbeddingProvider';
import { extractiveLocalProvider } from '../../src/core/ai/providers/extractiveLocalProvider';
import { OllamaProvider } from '../../src/core/ai/providers/ollamaProvider';
import { GeminiProvider } from '../../src/core/ai/providers/geminiProvider';
import { OpenAICompatibleProvider } from '../../src/core/ai/providers/openAICompatibleProvider';

/**
 * Proves provider selection is a genuine runtime decision driven by stored
 * mode+provider config (see entrypoints/background.ts's getActiveProvider /
 * getActiveEmbeddingProvider, which call exactly these two functions) —
 * never a hardcoded provider anywhere in the ask-question path.
 */
describe('selectEmbeddingProvider', () => {
  it('defaults to hashingEmbeddingProvider when no embeddingProviderKind is stored', () => {
    expect(selectEmbeddingProvider({})).toBe(hashingEmbeddingProvider);
  });

  it('selects hashingEmbeddingProvider explicitly', () => {
    expect(selectEmbeddingProvider({ embeddingProviderKind: 'hashing' })).toBe(hashingEmbeddingProvider);
  });

  it('selects transformersEmbeddingProvider when opted in', () => {
    expect(selectEmbeddingProvider({ embeddingProviderKind: 'transformers' })).toBe(transformersEmbeddingProvider);
  });
});

describe('selectAIProvider', () => {
  it('defaults to extractiveLocalProvider with no config at all', () => {
    expect(selectAIProvider({})).toBe(extractiveLocalProvider);
  });

  it('Mode A + extractive-local (or unset) -> extractiveLocalProvider', () => {
    expect(selectAIProvider({ privacyMode: 'A' })).toBe(extractiveLocalProvider);
    expect(selectAIProvider({ privacyMode: 'A', providerKind: 'extractive-local' })).toBe(extractiveLocalProvider);
  });

  it('Mode A + ollama -> a real OllamaProvider, configured with the stored baseUrl/model', () => {
    const provider = selectAIProvider({
      privacyMode: 'A',
      providerKind: 'ollama',
      ollamaBaseUrl: 'http://localhost:9999',
      model: 'mistral',
    });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect((provider as any).baseUrl).toBe('http://localhost:9999');
    expect((provider as any).model).toBe('mistral');
  });

  it('Mode A NEVER constructs a remote provider, even if providerKind/apiKey say gemini/openai-compatible '
    + '(stale storage from a previous Mode B/C session must not leak data off-device)', () => {
    const withGemini = selectAIProvider({ privacyMode: 'A', providerKind: 'gemini', apiKey: 'leaked-key' });
    expect(withGemini).toBe(extractiveLocalProvider);
    expect(withGemini).not.toBeInstanceOf(GeminiProvider);

    const withOpenAI = selectAIProvider({
      privacyMode: 'A',
      providerKind: 'openai-compatible',
      apiKey: 'leaked-key',
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(withOpenAI).toBe(extractiveLocalProvider);
    expect(withOpenAI).not.toBeInstanceOf(OpenAICompatibleProvider);
  });

  it('Mode B + gemini + apiKey -> a real GeminiProvider', () => {
    const provider = selectAIProvider({ privacyMode: 'B', providerKind: 'gemini', apiKey: 'k', model: 'gemini-1.5-flash' });
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('Mode B + gemini WITHOUT an apiKey falls back to extractiveLocalProvider (no half-configured remote call)', () => {
    const provider = selectAIProvider({ privacyMode: 'B', providerKind: 'gemini' });
    expect(provider).toBe(extractiveLocalProvider);
  });

  it('Mode B/C + openai-compatible + baseUrl (no key, e.g. local Ollama-as-OpenAI-endpoint) -> OpenAICompatibleProvider', () => {
    const provider = selectAIProvider({
      privacyMode: 'B',
      providerKind: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it('ollama is available outside Mode A too (Mode C mixing local generation with local data)', () => {
    const provider = selectAIProvider({ privacyMode: 'C', providerKind: 'ollama' });
    expect(provider).toBeInstanceOf(OllamaProvider);
  });
});
