import type { SourceAdapter } from './SourceAdapter';
import type { DocumentBlock, SourceMetadata, StructuredDocument } from '../types';

/**
 * Level 1 adapter: generic website / article extraction.
 *
 * Deliberately dependency-free (no Readability.js) so it runs in any DOM
 * environment (real browser content script or a jsdom-like test fixture)
 * without a bundle-size or CSP cost. It approximates Readability's core idea:
 * strip obvious boilerplate (nav/header/footer/script/style/ads) and keep
 * headings/paragraphs/list items/links, in document order.
 *
 * This is the highest-value, lowest-risk MVP adapter per the research doc
 * ("safest and highest-value MVP target").
 */

const BOILERPLATE_SELECTORS = [
  'nav',
  'header',
  'footer',
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'form',
  'aside',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[aria-hidden="true"]',
  '.ad',
  '.ads',
  '.advertisement',
  '.cookie-banner',
];

const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, pre, code';
const BOILERPLATE_SELECTOR = BOILERPLATE_SELECTORS.join(',');

/**
 * Is `el` actually rendered to the user? (audit SEC-07)
 *
 * Root cause: extraction used to run on a *detached clone* of <body>, and
 * `getComputedStyle()` on a detached element does not reflect the page's
 * stylesheets, so the `display:none` / `visibility:hidden` check could never
 * fire in a real browser. It also only looked at the element itself, not its
 * ancestors (a <p> inside a hidden <div> has its own computed display
 * "block"). Net effect: text hidden from the user — a classic place to plant
 * prompt-injection instructions ("white text"/hidden div) — was captured and
 * sent to the model as page content.
 *
 * Now the check runs on the LIVE element: `checkVisibility()` where the
 * browser has it (Chrome 105+, covers every ancestor), otherwise an explicit
 * ancestor walk over `hidden` / `aria-hidden`-free computed styles.
 * `memo` caches per-ancestor results so a large page stays linear.
 */
function isRendered(el: Element, memo: Map<Element, boolean>): boolean {
  const anyEl = el as Element & { checkVisibility?: (opts?: Record<string, boolean>) => boolean };
  if (typeof anyEl.checkVisibility === 'function') {
    return anyEl.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  }
  const view = el.ownerDocument?.defaultView;
  const chain: Element[] = [];
  let node: Element | null = el;
  let verdict = true;
  while (node) {
    const cached = memo.get(node);
    if (cached !== undefined) {
      verdict = cached;
      break;
    }
    chain.push(node);
    if ((node as HTMLElement).hidden) {
      verdict = false;
      break;
    }
    if (view && typeof view.getComputedStyle === 'function') {
      const style = view.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        verdict = false;
        break;
      }
    }
    node = node.parentElement;
  }
  for (const n of chain) memo.set(n, verdict);
  return verdict;
}

/**
 * Walks the live DOM once, in document order. Two root-cause fixes vs. the
 * previous version:
 * - FUN-06: a block nested inside an already-captured block (`<pre><code>`,
 *   inline `<code>` inside a `<p>`, a `<p>` inside an `<li>`) used to be
 *   emitted AGAIN as its own block, duplicating text in the index (and in
 *   answers/citations). Now descendants of a captured block are skipped.
 * - PERF-02: no deep clone of the whole <body> per capture; the boilerplate
 *   check is a `closest()` lookup on the live element instead.
 */
function extractBlocks(root: Element): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  const captured = new Set<Element>();
  const visibility = new Map<Element, boolean>();
  root.querySelectorAll(BLOCK_SELECTOR).forEach((el) => {
    const blockAncestor = el.parentElement?.closest(BLOCK_SELECTOR);
    if (blockAncestor && captured.has(blockAncestor)) return;
    if (el.closest(BOILERPLATE_SELECTOR)) return;
    if (!isRendered(el, visibility)) return;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ type: 'heading', level: Number(tag[1]), text });
    } else if (tag === 'li') {
      blocks.push({ type: 'list-item', text });
    } else if (tag === 'pre' || tag === 'code') {
      blocks.push({ type: 'code', text });
    } else {
      // Filter out very short paragraph-like noise (single-word nav crumbs etc.)
      if (text.split(' ').length < 3) return;
      blocks.push({ type: 'paragraph', text });
    }
    captured.add(el);
  });
  return blocks;
}

/** Visible, non-boilerplate text for the no-blocks fallback path. */
function fallbackText(body: Element): string {
  const visibility = new Map<Element, boolean>();
  const doc = body.ownerDocument;
  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */);
  const parts: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || parent.closest(BOILERPLATE_SELECTOR) || !isRendered(parent, visibility)) continue;
    parts.push(n.textContent ?? '');
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function extractLinks(root: Element, baseUrl: string): string[] {
  const links = new Set<string>();
  root.querySelectorAll('a[href]').forEach((a) => {
    if (a.closest(BOILERPLATE_SELECTOR)) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    try {
      const resolved = new URL(href, baseUrl);
      // Only web links: drops javascript:, data:, blob:, vbscript: … in any case/whitespace spelling.
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
      links.add(resolved.toString());
    } catch {
      // Malformed href: not a link we can record — skipping it is the intended behavior.
    }
  });
  return Array.from(links);
}

export const genericWebAdapter: SourceAdapter = {
  sourceType: 'generic-web',

  detect(_doc: Document): boolean {
    // Applicable to any HTML document with a body — this is the universal
    // fallback adapter for ordinary websites/articles/SPAs with a normal DOM.
    return true;
  },

  getCapabilityLevel() {
    return 1;
  },

  getConfidence() {
    return 'high';
  },

  getMetadata(doc: Document): SourceMetadata {
    const title =
      doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
      doc.title ||
      'Untitled page';
    const author =
      doc.querySelector('meta[name="author"]')?.getAttribute('content') || undefined;
    const publishedRaw =
      doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
      undefined;
    const publishedAt = publishedRaw ? Date.parse(publishedRaw) : undefined;
    return {
      url: doc.location?.href || '',
      title,
      author,
      timestamps: { capturedAt: Date.now(), publishedAt: Number.isNaN(publishedAt) ? undefined : publishedAt },
    };
  },

  extractCurrentPage(doc: Document): StructuredDocument | null {
    if (!doc.body) return null;
    const blocks = extractBlocks(doc.body);
    const metadata = this.getMetadata(doc);
    if (blocks.length === 0) {
      // Fall back to visible raw text per the research doc's stated safe fallback.
      const text = fallbackText(doc.body);
      if (!text) return null;
      return {
        id: '',
        sourceId: '',
        title: metadata.title,
        text,
        blocks: [{ type: 'paragraph', text }],
        metadata,
        links: extractLinks(doc.body, metadata.url),
      };
    }
    const text = blocks.map((b) => b.text).join('\n\n');
    return {
      id: '',
      sourceId: '',
      title: metadata.title,
      text,
      blocks,
      metadata,
      links: extractLinks(doc.body, metadata.url),
    };
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
