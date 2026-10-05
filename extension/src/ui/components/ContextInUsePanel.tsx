import React, { useEffect, useState } from 'react';
import type { Chunk } from '../../core/types';

export interface ContextInUsePanelProps {
  sourceId: string | null;
  chunks: Chunk[];
  onLoad: (sourceId: string) => void;
  onDeleteChunk: (chunkId: string) => void;
}

/**
 * Real, rare privacy-UX differentiator (per the task's own framing): not
 * just "this source is indexed", but the EXACT chunks currently eligible for
 * retrieval, individually inspectable and individually removable — never
 * hidden state, per the Privacy Architecture's "Context in use" panel
 * requirement, taken to the chunk level rather than the source level.
 *
 * Deliberately reads from `src/core/storage/db.ts` via the background
 * worker's `GET_CHUNKS_FOR_SOURCE`/`DELETE_CHUNK` messages — no separate
 * copy of chunk state is kept anywhere else in the UI.
 */
export default function ContextInUsePanel({ sourceId, chunks, onLoad, onDeleteChunk }: ContextInUsePanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (sourceId && open) onLoad(sourceId);
  }, [sourceId, open, onLoad]);

  if (!sourceId) return null;

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left font-semibold"
        aria-expanded={open}
        aria-controls="context-in-use-body"
      >
        <span>Inspect chunks{open ? ` (${chunks.length})` : ''}</span>
        <span aria-hidden="true" className="text-slate-500 dark:text-slate-400">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div id="context-in-use-body" className="mt-2 space-y-1">
          <p className="text-slate-500 dark:text-slate-400">
            Every chunk below is currently eligible for retrieval when you ask a question about this source.
            Remove any one individually — it's excluded from future answers immediately, without deleting the
            whole source.
          </p>
          {chunks.length === 0 && <p className="text-slate-500 dark:text-slate-400">No chunks indexed yet.</p>}
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {chunks
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((chunk) => {
                const isExpanded = expandedId === chunk.id;
                return (
                  <li
                    key={chunk.id}
                    className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left"
                        onClick={() => setExpandedId(isExpanded ? null : chunk.id)}
                        aria-expanded={isExpanded}
                        title={chunk.sourceAnchor?.headingPath?.join(' > ')}
                      >
                        <span className="font-mono text-slate-500 dark:text-slate-400">#{chunk.position}</span>{' '}
                        {chunk.sourceAnchor?.headingPath?.length ? (
                          <span className="text-slate-500 dark:text-slate-400">{chunk.sourceAnchor.headingPath.join(' › ')}: </span>
                        ) : null}
                        {chunk.text.slice(0, 60)}
                        {chunk.text.length > 60 ? '…' : ''}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteChunk(chunk.id)}
                        className="shrink-0 rounded border border-red-300 dark:border-red-700 px-1.5 py-0.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                        aria-label={`Remove chunk ${chunk.position} from context`}
                      >
                        Remove
                      </button>
                    </div>
                    {isExpanded && (
                      <p className="mt-1 whitespace-pre-wrap border-t border-slate-100 dark:border-slate-800 pt-1 text-slate-600 dark:text-slate-300">
                        {chunk.text}
                      </p>
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}
