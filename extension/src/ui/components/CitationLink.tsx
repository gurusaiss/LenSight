import React from 'react';
import type { Citation } from '../../core/types';

export interface CitationLinkProps {
  citation: Citation;
  onOpen?: (citation: Citation) => void;
}

/**
 * A clickable citation. Where the original source is a live DOM page, onOpen
 * can scroll/highlight the source; for sources where navigation isn't
 * possible (e.g. a deleted/scrolled-past chat message, a PDF page), it shows
 * the extracted snippet inline instead — per the spec's Citations section.
 */
export default function CitationLink({ citation, onOpen }: CitationLinkProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(citation)}
      className="block w-full rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-left text-xs
                 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
      title={citation.chunkId}
    >
      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">[{citation.chunkId}]</span>{' '}
      {citation.snippet}
      {citation.snippet.length >= 240 ? '…' : ''}
    </button>
  );
}
