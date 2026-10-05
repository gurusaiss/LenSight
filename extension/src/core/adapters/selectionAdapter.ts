import type { SourceAdapter } from './SourceAdapter';
import type { SourceMetadata, StructuredDocument } from '../types';

/**
 * Universal fallback adapter (Level 3): captures whatever the user has
 * selected with window.getSelection(), regardless of what site they're on.
 * This is the guaranteed-to-work path when a site's DOM can't be parsed
 * reliably (obfuscated SPA, canvas-rendered content, closed shadow DOM, etc).
 */
export const selectionAdapter: SourceAdapter = {
  sourceType: 'selection',

  detect(_doc: Document): boolean {
    if (typeof window === 'undefined') return false;
    const sel = window.getSelection?.();
    return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
  },

  getCapabilityLevel() {
    return 3;
  },

  getConfidence() {
    return 'high';
  },

  getMetadata(doc: Document): SourceMetadata {
    return {
      url: doc.location?.href || '',
      title: doc.title || 'Selection',
      timestamps: { capturedAt: Date.now() },
    };
  },

  extractCurrentPage(_doc: Document): StructuredDocument | null {
    // Selection adapter has no "whole page" mode by design.
    return null;
  },

  extractSelection(selection: Selection | null): StructuredDocument | null {
    if (!selection || selection.isCollapsed) return null;
    const text = selection.toString().trim();
    if (!text) return null;
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const title = typeof document !== 'undefined' ? document.title : 'Selection';
    return {
      id: '',
      sourceId: '',
      title: `Selection from ${title}`,
      text,
      blocks: [{ type: 'paragraph', text }],
      metadata: { url, title, timestamps: { capturedAt: Date.now() } },
    };
  },
};
