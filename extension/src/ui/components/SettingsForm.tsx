import React, { useEffect, useRef, useState } from 'react';
import type { DataExport, PrivacyMode } from '../../core/types';
import {
  QUICK_ACTIONS,
  loadQuickActionPrefs,
  saveQuickActionPrefs,
  type QuickActionId,
} from '../../core/quickActions';
import { validateEndpointSettings, type SettingsErrors } from '../../core/settingsValidation';

function hasChromeRuntime(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.sendMessage;
}

type ProviderKind = 'extractive-local' | 'ollama' | 'gemini' | 'openai-compatible';
type EmbeddingProviderKind = 'hashing' | 'transformers';

interface StoredSettings {
  privacyMode?: PrivacyMode;
  embeddingProviderKind?: EmbeddingProviderKind;
  providerKind?: ProviderKind;
  apiKey?: string;
  baseUrl?: string;
  ollamaBaseUrl?: string;
  model?: string;
}

const STORAGE_KEYS: (keyof StoredSettings)[] = [
  'privacyMode',
  'embeddingProviderKind',
  'providerKind',
  'apiKey',
  'baseUrl',
  'ollamaBaseUrl',
  'model',
];

// Honest privacy-mode copy reused verbatim (condensed) from docs/PRIVACY.md —
// never invent new privacy claims here, per the task's explicit requirement.
const PRIVACY_NOTES: Record<PrivacyMode, string> = {
  A: 'Fully local: extraction, embeddings, vector search, and generation all stay on-device — nothing ever leaves your machine. Three local options below, honestly different in setup cost: extractive "Basic local mode" (zero install, no real generation), Transformers.js neural embeddings (one-time ~90MB model download), and Ollama generation (you install/run Ollama yourself — see docs/LIMITATIONS.md).',
  B: 'Local data, remote AI (default once you configure a provider below): extraction, chunking, embeddings, and vector search stay local — only the retrieved chunks (typically a few hundred to a few thousand tokens) plus your question are sent to the AI provider you choose, over HTTPS.',
  C: 'User configured: same local-first pipeline as above; you choose which provider (if any) receives retrieved context, and can mix modes per source in a future release. Verify each provider\'s current data-use terms yourself — see docs/PRIVACY.md.',
};

// Every AI provider option, and whether it is available in Mode A. Mode A
// must only ever offer options that never leave the device — enforced here
// in the UI AND, independently, in src/core/ai/providerSelection.ts so a
// settings-page bug alone could never leak data off-device.
const PROVIDER_OPTIONS: { value: ProviderKind; label: string; localOnly: boolean }[] = [
  { value: 'extractive-local', label: 'Basic local mode (extractive, no network, no install)', localOnly: true },
  { value: 'ollama', label: 'Ollama (local model daemon — requires installing Ollama)', localOnly: true },
  { value: 'gemini', label: 'Google Gemini', localOnly: false },
  { value: 'openai-compatible', label: 'OpenAI-compatible (OpenAI / OpenRouter / Groq)', localOnly: false },
];

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

/**
 * Settings UI for provider configuration (Phase 5, deferred from Phase 4).
 * Real state wiring to `chrome.storage.local` — the same storage keys
 * `entrypoints/background.ts`'s `getActiveProvider()` already reads
 * (`providerKind`, `apiKey`, `baseUrl`, `model`), plus `privacyMode` for the
 * always-visible PrivacyIndicator.
 *
 * The API key is masked on input, stored only in chrome.storage.local
 * (never logged, never sent anywhere by this form itself), and is never
 * rendered back in plaintext after a successful save — only a "key
 * configured" indicator is shown on reload.
 */
export default function SettingsForm() {
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>('B');
  const [embeddingProviderKind, setEmbeddingProviderKind] = useState<EmbeddingProviderKind>('hashing');
  const [providerKind, setProviderKind] = useState<ProviderKind>('extractive-local');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [quickActionOrder, setQuickActionOrder] = useState<QuickActionId[]>([]);
  const [quickActionHidden, setQuickActionHidden] = useState<QuickActionId[]>([]);
  const [onboardingReplayed, setOnboardingReplayed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [dataMessage, setDataMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<SettingsErrors>({});
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      if (!hasChromeStorage()) {
        setLoaded(true);
        return;
      }
      try {
        const stored = (await chrome.storage.local.get(STORAGE_KEYS)) as StoredSettings;
        if (stored.privacyMode) setPrivacyMode(stored.privacyMode);
        if (stored.embeddingProviderKind) setEmbeddingProviderKind(stored.embeddingProviderKind);
        if (stored.providerKind) setProviderKind(stored.providerKind);
        setHasStoredKey(!!stored.apiKey);
        setBaseUrl(stored.baseUrl ?? '');
        setOllamaBaseUrl(stored.ollamaBaseUrl ?? '');
        setModel(stored.model ?? '');
        const prefs = await loadQuickActionPrefs();
        setQuickActionOrder(prefs.order);
        setQuickActionHidden(prefs.hidden);
      } catch (err: any) {
        // FUN-09: previously an unhandled rejection that left the page blank
        // (`loaded` never became true). Show the form with defaults + why.
        setSaveError(`Couldn't load your saved settings (${String(err?.message ?? err)}). Showing defaults — saving will overwrite them.`);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const moveQuickAction = (id: QuickActionId, direction: -1 | 1) => {
    setQuickActionOrder((order) => {
      const idx = order.indexOf(id);
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= order.length) return order;
      const copy = [...order];
      [copy[idx], copy[nextIdx]] = [copy[nextIdx], copy[idx]];
      saveQuickActionPrefs({ order: copy, hidden: quickActionHidden }).catch((err) =>
        setSaveError(`Couldn't save quick-action order: ${String(err?.message ?? err)}`),
      );
      return copy;
    });
  };

  const toggleQuickActionHidden = (id: QuickActionId) => {
    setQuickActionHidden((hidden) => {
      const next = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
      saveQuickActionPrefs({ order: quickActionOrder, hidden: next }).catch((err) =>
        setSaveError(`Couldn't save quick-action visibility: ${String(err?.message ?? err)}`),
      );
      return next;
    });
  };

  const replayOnboarding = async () => {
    if (!hasChromeStorage()) return;
    try {
      await chrome.storage.local.remove('onboardingCompleted');
      setOnboardingReplayed(true);
    } catch (err: any) {
      setSaveError(`Couldn't reset the onboarding tour: ${String(err?.message ?? err)}`);
    }
  };

  // Switching to Mode A must immediately drop any non-local provider choice
  // in the UI itself (in addition to providerSelection.ts's independent
  // enforcement at request time) — never leave a remote provider "selected"
  // while Mode A is displayed as active.
  useEffect(() => {
    if (privacyMode === 'A' && !PROVIDER_OPTIONS.find((p) => p.value === providerKind)?.localOnly) {
      setProviderKind('extractive-local');
    }
  }, [privacyMode, providerKind]);

  const visibleProviderOptions = PROVIDER_OPTIONS.filter((p) => privacyMode !== 'A' || p.localOnly);

  const handleSave = async () => {
    setSaved(false);
    setSaveError(null);
    if (!hasChromeStorage()) return;
    // SEC-08: validate endpoint URLs before anything is stored.
    const errors = validateEndpointSettings({ privacyMode, providerKind, baseUrl, ollamaBaseUrl });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveError('Not saved — fix the highlighted field(s) first.');
      return;
    }
    setIsSaving(true);
    try {
      const toStore: StoredSettings = {
        privacyMode,
        embeddingProviderKind,
        providerKind,
        baseUrl: baseUrl.trim(),
        ollamaBaseUrl: ollamaBaseUrl.trim(),
        model: model.trim(),
      };
      // Only overwrite the stored key if the user typed a new one — leaving
      // the masked field blank keeps whatever key was already saved, rather
      // than clearing it.
      if (apiKeyInput.trim().length > 0) {
        toStore.apiKey = apiKeyInput.trim();
      }
      await chrome.storage.local.set(toStore);
      setHasStoredKey(apiKeyInput.trim().length > 0 || hasStoredKey);
      setApiKeyInput(''); // never keep the plaintext key in component state after save
      setSaved(true);
    } catch (err: any) {
      // FUN-09: a failed chrome.storage.local.set (e.g. quota) used to be an
      // unhandled rejection with no feedback at all.
      setSaveError(`Settings were NOT saved: ${String(err?.message ?? err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  // --- Data management: export / import / delete all (Diagnostics/Settings
  // gap fix — src/core/storage/db.ts's exportAllData/importData/deleteAllData
  // were real, tested logic with NO UI path to reach them anywhere, despite
  // src/core/errors.ts's IndexCorruptedError telling users to "use 'Delete
  // all data' in Settings to reset" — a real dead-end this pass fixes. ---

  const handleExport = async () => {
    setDataMessage(null);
    if (!hasChromeRuntime()) return;
    setIsExporting(true);
    try {
      const response: any = await chrome.runtime.sendMessage({ type: 'EXPORT_DATA' });
      if (!response?.ok) throw new Error(response?.error ?? 'Export failed.');
      const data = response.data as DataExport;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-context-assistant-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDataMessage({ kind: 'ok', text: `Exported ${data.sources.length} source(s), ${data.chunks.length} chunk(s).` });
    } catch (err: any) {
      setDataMessage({ kind: 'error', text: String(err?.message ?? err) });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setDataMessage(null);
    if (!hasChromeRuntime()) return;
    setIsImporting(true);
    try {
      // Chrome caps a single extension message at 64 MiB; stay clearly below it.
      if (file.size > 48 * 1024 * 1024) {
        throw new Error('That export file is larger than 48 MB, which is more than a single import can carry.');
      }
      const text = await file.text();
      let parsed: DataExport;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('That file is not valid JSON — export a file from this extension first.');
      }
      const response: any = await chrome.runtime.sendMessage({ type: 'IMPORT_DATA', data: parsed });
      if (!response?.ok) throw new Error(response?.error ?? 'Import failed.');
      setDataMessage({ kind: 'ok', text: 'Import complete. Re-open the side panel to see the restored data.' });
    } catch (err: any) {
      setDataMessage({ kind: 'error', text: String(err?.message ?? err) });
    } finally {
      setIsImporting(false);
    }
  };

  const handleDeleteAllData = async () => {
    setDataMessage(null);
    if (!hasChromeRuntime()) return;
    if (typeof window !== 'undefined' && !window.confirm('Delete ALL captured sources, chunks, sessions, and conversations? This cannot be undone.')) {
      return;
    }
    setIsDeletingAll(true);
    try {
      const response: any = await chrome.runtime.sendMessage({ type: 'DELETE_ALL_DATA' });
      if (!response?.ok) throw new Error(response?.error ?? 'Failed to delete data.');
      setDataMessage({ kind: 'ok', text: 'All local data deleted.' });
    } catch (err: any) {
      setDataMessage({ kind: 'error', text: String(err?.message ?? err) });
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleClearKey = async () => {
    if (!hasChromeStorage()) return;
    try {
      await chrome.storage.local.remove('apiKey');
      setHasStoredKey(false);
      setApiKeyInput('');
      setSaved(true);
    } catch (err: any) {
      setSaveError(`Couldn't clear the stored key: ${String(err?.message ?? err)}`);
    }
  };

  if (!loaded) return null;

  return (
    <div className="max-w-lg space-y-6 p-4 text-sm">
      <h1 className="text-lg font-bold">Lensight — Settings</h1>

      {!hasChromeStorage() && (
        <p className="rounded bg-amber-100 dark:bg-amber-900 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">
          chrome.storage is unavailable in this preview context — settings shown here would not persist.
        </p>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Privacy mode</h2>
        <div className="space-y-2">
          {(['A', 'B', 'C'] as PrivacyMode[]).map((m) => (
            <label key={m} className="flex items-start gap-2 rounded border border-slate-200 dark:border-slate-700 p-2">
              <input type="radio" name="privacy-mode" checked={privacyMode === m} onChange={() => setPrivacyMode(m)} className="mt-1" />
              <span>
                <span className="font-medium">Mode {m}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{PRIVACY_NOTES[m]}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold" id="settings-embeddings-heading">Local embeddings</h2>
        <select
          aria-labelledby="settings-embeddings-heading"
          value={embeddingProviderKind}
          onChange={(e) => setEmbeddingProviderKind(e.target.value as EmbeddingProviderKind)}
          className="w-full rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1"
        >
          <option value="hashing">Hashing / bag-of-words (default — no network, no download)</option>
          <option value="transformers">Transformers.js neural embeddings (Xenova/all-MiniLM-L6-v2, one-time ~90MB download)</option>
        </select>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Embeddings always stay on-device in every privacy mode — this only changes retrieval quality vs. setup
          cost. Switching this after you have already captured sources means those sources won&apos;t match new
          queries until re-captured (the two vector spaces aren&apos;t comparable) — see docs/LIMITATIONS.md.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold" id="settings-provider-heading">AI provider (generation)</h2>
        {privacyMode === 'A' && (
          <p className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-1 text-xs text-slate-600 dark:text-slate-300">
            Mode A is active — only local, no-cloud generation options are offered.
          </p>
        )}
        <select
          aria-labelledby="settings-provider-heading"
          value={providerKind}
          onChange={(e) => setProviderKind(e.target.value as ProviderKind)}
          className="w-full rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1"
        >
          {visibleProviderOptions.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>

        {providerKind === 'ollama' && (
          <div className="space-y-2 rounded border border-slate-200 dark:border-slate-700 p-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Requires Ollama installed and running locally — the extension itself does not and cannot run a
              model; it makes an HTTP request to your own Ollama daemon. If it isn&apos;t reachable, asking a
              question will show a clear error telling you to install/start Ollama, not a silent fallback.
            </p>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Ollama base URL</span>
              <input
                value={ollamaBaseUrl}
                onChange={(e) => setOllamaBaseUrl(e.target.value)}
                placeholder="http://localhost:11434"
                inputMode="url"
                aria-invalid={!!fieldErrors.ollamaBaseUrl}
                aria-describedby={fieldErrors.ollamaBaseUrl ? 'settings-ollama-url-error' : undefined}
                className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1"
              />
              {fieldErrors.ollamaBaseUrl && (
                <span id="settings-ollama-url-error" className="mt-1 block text-xs text-red-600 dark:text-red-400">
                  {fieldErrors.ollamaBaseUrl}
                </span>
              )}
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Model</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="llama3.1"
                className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1"
              />
            </label>
          </div>
        )}

        {(providerKind === 'gemini' || providerKind === 'openai-compatible') && (
          <div className="space-y-2 rounded border border-slate-200 dark:border-slate-700 p-2">
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">API key</span>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={hasStoredKey ? '•••••••• (key configured — leave blank to keep it)' : 'Paste API key'}
                className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1"
                autoComplete="off"
              />
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                {hasStoredKey ? '✓ Key configured (stored locally, never shown again in plaintext).' : 'No key configured yet.'}
              </span>
            </label>
            {hasStoredKey && (
              <button type="button" onClick={handleClearKey} className="text-xs text-red-600 dark:text-red-400 underline">
                Clear stored key
              </button>
            )}

            {providerKind === 'openai-compatible' && (
              <>
                <label className="block">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Base URL</span>
                  <input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    inputMode="url"
                    aria-invalid={!!fieldErrors.baseUrl}
                    aria-describedby={fieldErrors.baseUrl ? 'settings-base-url-error' : undefined}
                    className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1"
                  />
                  {fieldErrors.baseUrl && (
                    <span id="settings-base-url-error" className="mt-1 block text-xs text-red-600 dark:text-red-400">
                      {fieldErrors.baseUrl}
                    </span>
                  )}
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Model</span>
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="gpt-4o-mini"
                    className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1"
                  />
                </label>
              </>
            )}
            {providerKind === 'gemini' && (
              <label className="block">
                <span className="text-xs text-slate-500 dark:text-slate-400">Model</span>
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gemini-1.5-flash"
                  className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1"
                />
              </label>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Quick actions</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Reorder or hide the quick-action buttons shown in the side panel and Command Palette (Ctrl/Cmd+K).
          Changes save immediately.
        </p>
        <ul className="space-y-1">
          {quickActionOrder.map((id, i) => {
            const def = QUICK_ACTIONS.find((a) => a.id === id);
            if (!def) return null;
            const hidden = quickActionHidden.includes(id);
            return (
              <li
                key={id}
                className={`flex items-center justify-between gap-2 rounded border border-slate-200 dark:border-slate-700 px-2 py-1 ${hidden ? 'opacity-50' : ''}`}
              >
                <span>{def.label}</span>
                <div className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => moveQuickAction(id, -1)}
                    className="rounded border border-slate-300 dark:border-slate-600 px-1.5 disabled:opacity-30"
                    aria-label={`Move ${def.label} up`}
                  >
                    {'↑'}
                  </button>
                  <button
                    type="button"
                    disabled={i === quickActionOrder.length - 1}
                    onClick={() => moveQuickAction(id, 1)}
                    className="rounded border border-slate-300 dark:border-slate-600 px-1.5 disabled:opacity-30"
                    aria-label={`Move ${def.label} down`}
                  >
                    {'↓'}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleQuickActionHidden(id)}
                    className="rounded border border-slate-300 dark:border-slate-600 px-1.5"
                  >
                    {hidden ? 'Show' : 'Hide'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Onboarding</h2>
        <button
          type="button"
          onClick={replayOnboarding}
          className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs"
        >
          Replay onboarding tour
        </button>
        {onboardingReplayed && (
          <span role="status" className="ml-2 text-xs text-green-700 dark:text-green-400">
            It will show again next time you open the side panel.
          </span>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Data</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Everything below operates only on this device&apos;s local IndexedDB — sources, chunks, sessions, and
          conversations. Nothing here is ever sent anywhere.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {isExporting ? 'Exporting…' : 'Export all data'}
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            disabled={isImporting}
            className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {isImporting ? 'Importing…' : 'Import data…'}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) handleImportFile(file);
            }}
          />
          <button
            type="button"
            onClick={handleDeleteAllData}
            disabled={isDeletingAll}
            className="rounded border border-red-300 dark:border-red-700 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
          >
            {isDeletingAll ? 'Deleting…' : 'Delete all data'}
          </button>
        </div>
        {dataMessage && (
          <p
            role={dataMessage.kind === 'error' ? 'alert' : 'status'}
            className={`text-xs ${
              dataMessage.kind === 'ok' ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'
            }`}
          >
            {dataMessage.text}
          </p>
        )}
      </section>

      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        className="rounded bg-slate-900 dark:bg-slate-100 dark:text-slate-900 px-3 py-1.5 text-white disabled:opacity-50"
      >
        {isSaving ? 'Saving…' : 'Save settings'}
      </button>
      <span role="status" className="ml-3 text-xs text-green-700 dark:text-green-400">
        {saved ? 'Saved.' : ''}
      </span>
      {saveError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {saveError}
        </p>
      )}
    </div>
  );
}
