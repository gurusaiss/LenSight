import type { Citation } from '../types';

/**
 * Real citation click-through, split into two testable pieces:
 *
 * 1. `resolveCitationTarget` — pure logic (no DOM) deciding WHERE a citation
 *    should navigate: a PDF page number (from the chunk's
 *    `sourceAnchor.headingPath`, which pdfAdapter.ts sets to `["Page N"]`),
 *    or a DOM text anchor to scroll/highlight for page/WhatsApp sources.
 *    This is what tests/unit/anchorResolver.test.ts exercises directly.
 *
 * 2. `findElementForSnippet` — the actual DOM search, used by
 *    entrypoints/content.ts's `HIGHLIGHT_CITATION` handler. It only needs a
 *    `Document`/`Element` and text, so it's exercised with jsdom here too,
 *    even though a live browser click can't be driven in this environment.
 */

const PDF_PAGE_HEADING_RE = /^Page (\d+)$/;

export type CitationTarget =
  | { kind: 'pdf-page'; page: number }
  | { kind: 'dom-text'; snippet: string }
  | { kind: 'none' };

/** Decides how to navigate to a citation's original location, given the
 * citation itself and (optionally) the heading path recorded on the chunk it
 * came from — pdfAdapter.ts's per-page heading ("Page N") is the only
 * heading-path shape that means "open this page", everything else is a
 * best-effort DOM text search using the citation's own snippet. */
export function resolveCitationTarget(citation: Citation, headingPath?: string[]): CitationTarget {
  const pdfHeading = headingPath?.find((h) => PDF_PAGE_HEADING_RE.test(h));
  if (pdfHeading) {
    const match = PDF_PAGE_HEADING_RE.exec(pdfHeading);
    if (match) return { kind: 'pdf-page', page: Number(match[1]) };
  }
  if (citation.snippet && citation.snippet.trim().length > 0) {
    return { kind: 'dom-text', snippet: citation.snippet };
  }
  return { kind: 'none' };
}

/** Builds a URL that opens a PDF directly to a given page, using the
 * standard `#page=N` fragment most PDF viewers (including Chrome's and
 * Firefox's built-in ones) honor. */
export function buildPdfPageUrl(baseUrl: string, page: number): string {
  const withoutFragment = baseUrl.split('#')[0];
  return `${withoutFragment}#page=${page}`;
}

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Best-effort DOM search for the element whose text content contains (a
 * meaningful prefix of) the given snippet — used to scroll/highlight the
 * original location of a DOM-based citation (generic-web/WhatsApp sources).
 * Deliberately simple (no fuzzy matching): the snippet is the first ~240
 * characters of the actual chunk text, so an exact substring match against
 * normalized whitespace is reliable for content that hasn't changed since
 * capture, and honestly fails (`null`) rather than guessing when it has. */
export function findElementForSnippet(root: Element | Document, snippet: string): Element | null {
  const needle = normalizeForMatch(snippet).slice(0, 120);
  if (!needle) return null;

  const candidates = root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, pre, code, span, div');
  let best: Element | null = null;
  let bestLen = Infinity;

  candidates.forEach((el) => {
    // Skip container elements that merely contain a matching descendant —
    // prefer the smallest (most specific) matching element so highlighting
    // wraps the actual sentence, not the whole page body.
    const text = normalizeForMatch(el.textContent || '');
    if (!text || !text.includes(needle)) return;
    if (text.length < bestLen) {
      best = el;
      bestLen = text.length;
    }
  });

  return best;
}

export const CITATION_HIGHLIGHT_CLASS = 'ai-context-assistant-citation-highlight';

/** Injects the one-off CSS rule for the highlight class into the current
 * page (idempotent — checks for its own `<style>` tag first). Only ever
 * touches a single tiny inline stylesheet the content script owns; never
 * modifies the page's own styles. */
export function ensureCitationHighlightStyle(doc: Document): void {
  const id = 'ai-context-assistant-citation-style';
  if (doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = `.${CITATION_HIGHLIGHT_CLASS} { outline: 2px solid #f59e0b !important; background-color: rgba(245, 158, 11, 0.15) !important; transition: outline 0.2s ease, background-color 0.2s ease; }`;
  doc.head?.appendChild(style);
}

/** Scrolls to and briefly highlights the element matching a citation
 * snippet. Pure-DOM (no chrome.* dependency) so it's testable with jsdom;
 * `entrypoints/content.ts` is the only caller that also has the
 * `chrome.runtime.onMessage` plumbing around it. Returns whether a match was
 * found, so the caller can report "source location not found" honestly
 * instead of pretending the click always works. */
export function highlightCitationInDocument(doc: Document, snippet: string): boolean {
  const el = findElementForSnippet(doc.body ?? doc, snippet);
  if (!el) return false;
  // Feature-detected: real browsers implement scrollIntoView; jsdom (used in
  // this project's unit tests) does not, and this function must still work
  // correctly (and be testable) in both environments.
  if (typeof (el as HTMLElement).scrollIntoView === 'function') {
    (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  el.classList.add(CITATION_HIGHLIGHT_CLASS);
  setTimeout(() => el.classList.remove(CITATION_HIGHLIGHT_CLASS), 2500);
  return true;
}
