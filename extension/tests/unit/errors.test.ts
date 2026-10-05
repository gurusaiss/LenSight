import { describe, expect, it } from 'vitest';
import {
  AppError,
  AdapterUnavailableError,
  CapabilityTooLowError,
  ExtractionFailedError,
  IndexCorruptedError,
  ModelUnavailableError,
  NotInExtensionContextError,
  ProviderUnauthorizedError,
  ProviderUnreachableError,
  RateLimitedError,
  StorageFailureError,
  UnsupportedPageError,
  toAppError,
  userMessageFor,
} from '../../src/core/errors';

/**
 * Proves each typed error produces a specific, actionable user-facing
 * message (never a generic "Something went wrong") and a stable, safe
 * `code` for Diagnostics — the mandatory test the task asks for.
 */
describe('typed errors', () => {
  it('UnsupportedPageError names the boundary and suggests selection capture', () => {
    const err = new UnsupportedPageError('cross-origin iframe');
    expect(err.code).toBe('unsupported_page');
    expect(err.userMessage).toMatch(/cross-origin iframe/);
    expect(err.userMessage).toMatch(/Capture selection/);
    expect(err.userMessage).not.toMatch(/something went wrong/i);
  });

  it('CapabilityTooLowError includes the actual level and reason', () => {
    const err = new CapabilityTooLowError(4, 'canvas-rendered content has no text DOM');
    expect(err.code).toBe('capability_too_low');
    expect(err.userMessage).toMatch(/Level 4/);
    expect(err.userMessage).toMatch(/canvas-rendered content/);
  });

  it('ExtractionFailedError explains what to try next', () => {
    const err = new ExtractionFailedError('the page has no readable text content');
    expect(err.code).toBe('extraction_failed');
    expect(err.userMessage).toMatch(/no readable text content/);
    expect(err.userMessage).toMatch(/Capture selection/);
  });

  it('AdapterUnavailableError names the adapter and points to the known-fragility doc', () => {
    const err = new AdapterUnavailableError('WhatsApp Web');
    expect(err.code).toBe('adapter_unavailable');
    expect(err.userMessage).toMatch(/WhatsApp Web/);
    expect(err.userMessage).toMatch(/LIMITATIONS\.md/);
  });

  it('ProviderUnreachableError names the provider and endpoint', () => {
    const err = new ProviderUnreachableError('Ollama', 'http://localhost:11434');
    expect(err.code).toBe('provider_unreachable');
    expect(err.userMessage).toMatch(/Ollama/);
    expect(err.userMessage).toMatch(/http:\/\/localhost:11434/);
    expect(err.detail).toMatchObject({ providerName: 'Ollama', endpoint: 'http://localhost:11434' });
  });

  it('ProviderUnauthorizedError points at Settings', () => {
    const err = new ProviderUnauthorizedError('Gemini');
    expect(err.code).toBe('provider_unauthorized');
    expect(err.userMessage).toMatch(/Gemini/);
    expect(err.userMessage).toMatch(/Settings/);
  });

  it('ModelUnavailableError gives the pull command', () => {
    const err = new ModelUnavailableError('Ollama', 'llama3.1');
    expect(err.code).toBe('model_unavailable');
    expect(err.userMessage).toMatch(/ollama pull llama3\.1/);
  });

  it('RateLimitedError suggests waiting or switching providers', () => {
    const err = new RateLimitedError('Gemini');
    expect(err.code).toBe('rate_limited');
    expect(err.userMessage).toMatch(/rate-limiting/);
    expect(err.userMessage).toMatch(/Settings/);
  });

  it('StorageFailureError names the failed operation and points at Diagnostics', () => {
    const err = new StorageFailureError('add embeddings');
    expect(err.code).toBe('storage_failure');
    expect(err.userMessage).toMatch(/add embeddings/);
    expect(err.userMessage).toMatch(/Diagnostics/);
  });

  it('IndexCorruptedError offers a concrete recovery action', () => {
    const err = new IndexCorruptedError('an embedding references a missing chunk');
    expect(err.code).toBe('index_corrupted');
    expect(err.userMessage).toMatch(/Delete all data/);
  });

  it('NotInExtensionContextError explains the missing runtime', () => {
    const err = new NotInExtensionContextError();
    expect(err.code).toBe('not_in_extension_context');
    expect(err.userMessage).toMatch(/chrome\.runtime/);
  });

  it('toAppError passes an existing AppError through unchanged', () => {
    const original = new ModelUnavailableError('Ollama', 'llama3.1');
    expect(toAppError(original, 'ignored context')).toBe(original);
  });

  it('toAppError wraps a plain Error without inventing a generic message', () => {
    const wrapped = toAppError(new Error('boom'), 'Extraction');
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.code).toBe('unknown');
    expect(wrapped.userMessage).toMatch(/Extraction failed: boom/);
  });

  it('toAppError wraps a non-Error thrown value', () => {
    const wrapped = toAppError('a string was thrown', 'Import');
    expect(wrapped.userMessage).toMatch(/Import failed: a string was thrown/);
  });

  it('userMessageFor returns just the safe string', () => {
    expect(userMessageFor(new RateLimitedError('Gemini'), 'ignored')).toMatch(/rate-limiting/);
  });
});
