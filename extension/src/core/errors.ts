/**
 * Typed error classes for the whole pipeline.
 *
 * The research doc's own bar: never surface "Something went wrong" — every
 * failure mode must explain (1) what happened and (2) what the user can do
 * about it. Every adapter/provider/orchestrator/background-message failure
 * path in this codebase should throw one of these (or let one propagate)
 * rather than a bare `Error`/string, so the UI can render a specific,
 * actionable message and (for Diagnostics) log a stable, content-free
 * `code` instead of freeform text that might embed page content.
 *
 * Design rules:
 * - `userMessage` is always safe to render directly in the UI — plain
 *   English, no raw stack traces, no page/message content.
 * - `code` is a short, stable, machine-readable identifier (e.g.
 *   'provider_unreachable') suitable for Diagnostics logging, exactly
 *   because it can never contain arbitrary content.
 * - `cause`, when present, is the original error/value for developer
 *   debugging (console only) — never rendered to the user and never logged
 *   into Diagnostics (see src/core/diagnostics.ts's allow-list).
 */

export type ErrorCode =
  | 'unsupported_page'
  | 'tab_access_denied'
  | 'capability_too_low'
  | 'extraction_failed'
  | 'adapter_unavailable'
  | 'provider_unreachable'
  | 'provider_unauthorized'
  | 'model_unavailable'
  | 'rate_limited'
  | 'storage_failure'
  | 'index_corrupted'
  | 'not_in_extension_context'
  | 'unknown';

export interface AppErrorOptions {
  cause?: unknown;
  /** Extra, non-content, structured detail safe for Diagnostics (e.g. a
   * status code, a provider name, a host name) — never page/message text. */
  detail?: Record<string, string | number | boolean | undefined>;
}

/** Base class for every typed error in this codebase. Always carries a
 * stable `code` and a user-safe `userMessage`, in addition to the standard
 * `message` (kept identical to `userMessage` here — there is deliberately no
 * separate "technical" message shown anywhere in the UI). */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly cause?: unknown;
  readonly detail?: Record<string, string | number | boolean | undefined>;

  constructor(code: ErrorCode, userMessage: string, options: AppErrorOptions = {}) {
    super(userMessage);
    this.name = new.target.name;
    this.code = code;
    this.userMessage = userMessage;
    this.cause = options.cause;
    this.detail = options.detail;
  }
}

/** The current page/context cannot be read at all (e.g. cross-origin iframe,
 * closed shadow DOM, DRM, a chrome:// page) — Level 7 in the capability
 * matrix. Distinct from CapabilityTooLowError, which is for "some adapter
 * exists but this content is below what it can reliably read". */
export class UnsupportedPageError extends AppError {
  constructor(reason: string, options: AppErrorOptions = {}) {
    super(
      'unsupported_page',
      `This page can't be read by the assistant (${reason}). This is a browser security ` +
        `boundary, not a bug — try selecting the text you want to ask about instead ` +
        `("Capture selection"), or open the content directly if it's inside an iframe.`,
      options,
    );
  }
}

/** The extension has no permission to script the current tab (audit
 * CMP-01: the content script is no longer injected into every site via a
 * static `<all_urls>` match; it is injected on demand using the `activeTab`
 * grant the user gives by clicking the toolbar icon / pressing the shortcut).
 * Also covers browser-internal pages no extension may script. */
export class TabAccessDeniedError extends AppError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'tab_access_denied',
      `The assistant doesn't have access to this tab. Click the Lensight toolbar icon (or press ` +
        `Ctrl/Cmd+Shift+E) while this tab is active to grant one-time access, then try again. Browser-internal ` +
        `pages (chrome://…, the Chrome Web Store, other extensions' pages) can never be read by any extension.`,
      options,
    );
  }
}

/** An adapter recognized the page but the only method available is below the
 * quality the user asked for (e.g. canvas-rendered content with no text DOM,
 * a scanned PDF with no text layer). */
export class CapabilityTooLowError extends AppError {
  constructor(level: number, reason: string, options: AppErrorOptions = {}) {
    super(
      'capability_too_low',
      `Only limited extraction is possible here (Level ${level}): ${reason}. See the capability ` +
        `badge in the side panel for what this means, or try "Capture selection" for a manual fallback.`,
      options,
    );
  }
}

/** DOM/file extraction ran but produced nothing usable. */
export class ExtractionFailedError extends AppError {
  constructor(reason: string, options: AppErrorOptions = {}) {
    super(
      'extraction_failed',
      `Couldn't extract any content from this page (${reason}). Try reloading the page, ` +
        `selecting the text manually and using "Capture selection", or reporting this if it ` +
        `keeps happening on a site that should work.`,
      options,
    );
  }
}

/** A site-specific adapter (WhatsApp, etc.) is present but its selectors no
 * longer match the live DOM — the honest "self-test failed" case the
 * research doc calls for, instead of a silent wrong answer. */
export class AdapterUnavailableError extends AppError {
  constructor(adapterName: string, options: AppErrorOptions = {}) {
    super(
      'adapter_unavailable',
      `The ${adapterName} adapter couldn't find the content it expects on this page — the site's ` +
        `layout may have changed since this adapter was built (this is a known, disclosed risk for ` +
        `site-specific adapters — see LIMITATIONS.md). Falling back to "Capture selection" will still work.`,
      options,
    );
  }
}

/** A local or remote model/daemon endpoint could not be reached at all
 * (network error, connection refused, DNS failure — not an HTTP error
 * response, which is `ModelUnavailableError`/`RateLimitedError` instead). */
export class ProviderUnreachableError extends AppError {
  constructor(providerName: string, endpoint: string, options: AppErrorOptions & { message?: string } = {}) {
    super(
      'provider_unreachable',
      options.message ??
        `Couldn't reach the ${providerName} provider at ${endpoint}. If this is a local provider ` +
          `(e.g. Ollama), make sure it's installed and running; if it's remote, check your network ` +
          `connection. Nothing was sent anywhere else.`,
      { ...options, detail: { providerName, endpoint, ...options.detail } },
    );
  }
}

/** The provider was reached, but rejected the API key/authorization. */
export class ProviderUnauthorizedError extends AppError {
  constructor(providerName: string, options: AppErrorOptions & { message?: string } = {}) {
    super(
      'provider_unauthorized',
      options.message ??
        `${providerName} rejected the request — the API key looks missing or invalid. Check the key ` +
          `in Settings (it's never shown again in plaintext once saved, so re-enter it if unsure).`,
      { ...options, detail: { providerName, ...options.detail } },
    );
  }
}

/** The provider is reachable but the specific model isn't available there
 * (e.g. an Ollama model that hasn't been pulled yet). */
export class ModelUnavailableError extends AppError {
  constructor(providerName: string, modelName: string, options: AppErrorOptions & { message?: string } = {}) {
    super(
      'model_unavailable',
      options.message ??
        `${providerName} is reachable, but the model "${modelName}" isn't available there yet. For ` +
          `Ollama, run \`ollama pull ${modelName}\`; otherwise pick a different model in Settings.`,
      { ...options, detail: { providerName, modelName, ...options.detail } },
    );
  }
}

/** HTTP 429 or provider-reported quota/rate limit. */
export class RateLimitedError extends AppError {
  constructor(providerName: string, options: AppErrorOptions & { message?: string } = {}) {
    super(
      'rate_limited',
      options.message ??
        `${providerName} is rate-limiting requests right now. Wait a moment and try again, or switch ` +
          `to a different provider (including a fully local one) in Settings.`,
      { ...options, detail: { providerName, ...options.detail } },
    );
  }
}

/** IndexedDB write/read failed (quota exceeded, blocked, browser storage
 * pressure, etc.). */
export class StorageFailureError extends AppError {
  constructor(operation: string, options: AppErrorOptions = {}) {
    super(
      'storage_failure',
      `Local storage failed during "${operation}" — this is usually the browser's storage quota or ` +
        `a blocked IndexedDB connection, not lost data. Check "Storage usage" in Diagnostics, and ` +
        `consider deleting old sources if you're near the limit.`,
      { ...options, detail: { operation, ...options.detail } },
    );
  }
}

/** The local vector index/chunk store is in an inconsistent state (e.g. an
 * embedding referencing a chunk that no longer exists). */
export class IndexCorruptedError extends AppError {
  constructor(reason: string, options: AppErrorOptions = {}) {
    super(
      'index_corrupted',
      `The local search index looks inconsistent (${reason}). Re-capture the affected source, or ` +
        `use "Delete all data" in Settings to reset and start clean — no content ever left your device.`,
      options,
    );
  }
}

/** The UI is being rendered outside the extension runtime (e.g. a Vite/dev
 * preview with no chrome.* APIs) — distinct from every real failure above. */
export class NotInExtensionContextError extends AppError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'not_in_extension_context',
      'This isn\'t running as an installed extension (chrome.runtime is unavailable), so there is no ' +
        'background worker to talk to. Load it via chrome://extensions as described in SETUP.md.',
      options,
    );
  }
}

/** Wraps any unrecognized thrown value into an AppError so downstream code
 * (message handlers, hooks) can rely on `.userMessage`/`.code` always being
 * present, without ever inventing a generic "Something went wrong". */
export function toAppError(err: unknown, fallbackContext: string): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new AppError(
    'unknown',
    `${fallbackContext} failed: ${message}. If this keeps happening, check Diagnostics for recent ` +
      `error details (no page content is ever included there).`,
    { cause: err },
  );
}

/** Extracts a user-safe message from anything thrown, for call sites that
 * need a plain string (e.g. `sendResponse({ error })`) rather than the full
 * AppError object. Always prefers `.userMessage` over a raw `.message`. */
export function userMessageFor(err: unknown, fallbackContext: string): string {
  return toAppError(err, fallbackContext).userMessage;
}
