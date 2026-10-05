import React, { useEffect, useState } from 'react';
import { loadDiagnosticsLog, type DiagnosticEvent } from '../../core/diagnostics';
import { getStorageUsage } from '../../core/storage/db';
import type { PrivacyMode, StorageUsage } from '../../core/types';

interface StoredConfigForDisplay {
  privacyMode?: PrivacyMode;
  embeddingProviderKind?: 'hashing' | 'transformers';
  providerKind?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

/**
 * Diagnostics panel: active privacy mode + providers, last extraction/ingest
 * result per adapter, storage usage, and recent non-content errors &mdash;
 * exactly the research doc's Observability section, and structurally unable
 * to contain page/message content because it only ever reads
 * `src/core/diagnostics.ts`'s allow-listed `DiagnosticEvent` records (see
 * that module's doc comment and `tests/unit/diagnostics.test.ts`).
 */
export default function Diagnostics() {
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [config, setConfig] = useState<StoredConfigForDisplay>({});
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const [log, storageUsage] = await Promise.all([
      loadDiagnosticsLog(),
      getStorageUsage().catch(() => null),
    ]);
    setEvents(log.slice().reverse()); // newest first
    setUsage(storageUsage);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(['privacyMode', 'embeddingProviderKind', 'providerKind']);
      setConfig(stored as StoredConfigForDisplay);
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const failures = events.filter((e) => e.outcome === 'failure');
  const successes = events.filter((e) => e.outcome === 'success');
  const avgLatency = (list: DiagnosticEvent[]) => {
    const withLatency = list.filter((e) => typeof e.latencyMs === 'number');
    if (withLatency.length === 0) return null;
    return Math.round(withLatency.reduce((sum, e) => sum + (e.latencyMs ?? 0), 0) / withLatency.length);
  };

  return (
    <div className="max-w-lg space-y-6 p-4 text-sm">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Diagnostics</h1>
        <button
          type="button"
          onClick={refresh}
          className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Everything on this page is structurally limited to failure types, adapter/provider names, capability
        levels, and timings &mdash; page content, chat messages, and questions are never logged here. See
        docs/LIMITATIONS.md and src/core/diagnostics.ts.
      </p>

      <section className="space-y-1 rounded border border-slate-200 dark:border-slate-700 p-3">
        <h2 className="font-semibold">Active configuration</h2>
        <div className="text-xs text-slate-600 dark:text-slate-300">
          <div>Privacy mode: {config.privacyMode ?? 'B (default)'}</div>
          <div>Embedding provider: {config.embeddingProviderKind ?? 'hashing (default)'}</div>
          <div>AI provider: {config.providerKind ?? 'extractive-local (default)'}</div>
        </div>
      </section>

      <section className="space-y-1 rounded border border-slate-200 dark:border-slate-700 p-3">
        <h2 className="font-semibold">Storage usage</h2>
        {usage ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-600 dark:text-slate-300">
            <div>Estimated bytes used</div>
            <div>{formatBytes(usage.bytesUsed)}</div>
            <div>Sources</div>
            <div>{usage.counts.sources}</div>
            <div>Chunks</div>
            <div>{usage.counts.chunks}</div>
            <div>Embeddings</div>
            <div>{usage.counts.embeddings}</div>
            <div>Sessions</div>
            <div>{usage.counts.sessions}</div>
            <div>Conversations</div>
            <div>{usage.counts.conversations}</div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">{loading ? 'Loading…' : 'Storage usage unavailable here.'}</p>
        )}
      </section>

      <section className="space-y-1 rounded border border-slate-200 dark:border-slate-700 p-3">
        <h2 className="font-semibold">Performance (recent)</h2>
        <div className="text-xs text-slate-600 dark:text-slate-300">
          <div>Avg. ingest latency: {avgLatency(events.filter((e) => e.area === 'ingest')) ?? '—'} ms</div>
          <div>Avg. ask latency: {avgLatency(events.filter((e) => e.area === 'ai')) ?? '—'} ms</div>
          <div>
            Recent events: {successes.length} succeeded, {failures.length} failed (last {events.length})
          </div>
        </div>
      </section>

      <section className="space-y-1 rounded border border-slate-200 dark:border-slate-700 p-3">
        <h2 className="font-semibold">Recent errors</h2>
        {failures.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">No recent failures recorded.</p>
        ) : (
          <ul className="space-y-1">
            {failures.slice(0, 20).map((e, i) => (
              <li key={i} className="rounded bg-red-50 dark:bg-red-950 px-2 py-1 text-xs text-red-700 dark:text-red-300">
                <span className="font-mono">{e.code ?? 'unknown'}</span> &middot; {e.area}
                {e.adapter ? ` · ${e.adapter}` : ''}
                {e.provider ? ` · ${e.provider}` : ''} &middot; {formatTime(e.timestamp)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
