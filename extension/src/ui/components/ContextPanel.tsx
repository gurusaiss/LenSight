import React, { useRef } from 'react';
import type { CapabilityLevel, ConfidenceLevel } from '../../core/types';
import SourceCapabilityBadge from './SourceCapabilityBadge';

export interface ContextPanelProps {
  source: { title: string; url: string; chunkCount: number } | null;
  capabilityLevel: CapabilityLevel;
  confidence: ConfidenceLevel;
  onExtractPage: () => void;
  onExtractSelection: () => void;
  onImportFile?: (file: File) => void;
  isExtracting: boolean;
}

/** Shows the current source(s), capability level, and "Context in use" —
 * always visible, never hidden state, per the Privacy Architecture's
 * "User controls" section. */
export default function ContextPanel({
  source,
  capabilityLevel,
  confidence,
  onExtractPage,
  onExtractSelection,
  onImportFile,
  isExtracting,
}: ContextPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2 rounded-md border border-slate-200 dark:border-slate-700 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Context in use</h2>
        <SourceCapabilityBadge level={capabilityLevel} confidence={confidence} />
      </div>
      {source ? (
        <div className="text-xs text-slate-600 dark:text-slate-300">
          <div className="truncate font-medium">{source.title}</div>
          <div className="truncate text-slate-500 dark:text-slate-400">{source.url}</div>
          <div>{source.chunkCount} chunk(s) indexed</div>
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">No source captured yet.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onExtractPage}
          disabled={isExtracting}
          className="rounded bg-slate-900 dark:bg-slate-100 dark:text-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          {isExtracting ? 'Extracting…' : 'Capture this page'}
        </button>
        <button
          type="button"
          onClick={onExtractSelection}
          disabled={isExtracting}
          className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs disabled:opacity-50"
        >
          Capture selection
        </button>
        {onImportFile && (
          <>
            {/* A11Y-01: this used to be a <label> wrapping a display:none
                file input — not focusable, so keyboard users could never
                import a file. A real <button> now opens the picker. */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isExtracting}
              className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs disabled:opacity-50"
            >
              Import file…
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.markdown,.csv,.json,.pdf"
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onImportFile(file);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
