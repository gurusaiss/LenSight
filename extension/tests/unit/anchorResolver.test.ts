import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  buildPdfPageUrl,
  findElementForSnippet,
  highlightCitationInDocument,
  resolveCitationTarget,
  CITATION_HIGHLIGHT_CLASS,
} from '../../src/core/citation/anchorResolver';
import type { Citation } from '../../src/core/types';

describe('resolveCitationTarget', () => {
  it('resolves a PDF citation (headingPath ["Page N"]) to a pdf-page target', () => {
    const citation: Citation = { chunkId: 'c1', sourceId: 's1', snippet: 'Some page text' };
    const target = resolveCitationTarget(citation, ['Page 3']);
    expect(target).toEqual({ kind: 'pdf-page', page: 3 });
  });

  it('resolves a web-page citation with no PDF heading to a dom-text target', () => {
    const citation: Citation = { chunkId: 'c1', sourceId: 's1', snippet: 'Application requirements are listed below.' };
    const target = resolveCitationTarget(citation, ['Section 2', 'Application Requirements']);
    expect(target).toEqual({ kind: 'dom-text', snippet: citation.snippet });
  });

  it('resolves to dom-text even with no heading path at all', () => {
    const citation: Citation = { chunkId: 'c1', sourceId: 's1', snippet: 'Plain paragraph text.' };
    expect(resolveCitationTarget(citation)).toEqual({ kind: 'dom-text', snippet: citation.snippet });
  });

  it('resolves to none for an empty snippet and no PDF heading', () => {
    const citation: Citation = { chunkId: 'c1', sourceId: 's1', snippet: '   ' };
    expect(resolveCitationTarget(citation)).toEqual({ kind: 'none' });
  });
});

describe('buildPdfPageUrl', () => {
  it('appends a #page= fragment, replacing any existing fragment', () => {
    expect(buildPdfPageUrl('https://example.com/doc.pdf', 5)).toBe('https://example.com/doc.pdf#page=5');
    expect(buildPdfPageUrl('https://example.com/doc.pdf#page=1', 5)).toBe('https://example.com/doc.pdf#page=5');
  });
});

function makeDom(bodyHtml: string): Document {
  return new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`).window.document;
}

describe('findElementForSnippet (real DOM search, jsdom)', () => {
  it('finds the paragraph whose text contains the snippet', () => {
    const doc = makeDom(`
      <p>Unrelated introduction paragraph about something else entirely.</p>
      <p>The application requirements are: a resume, a cover letter, and two references.</p>
      <p>Closing paragraph.</p>
    `);
    const el = findElementForSnippet(doc.body, 'The application requirements are: a resume');
    expect(el?.textContent).toMatch(/application requirements/i);
  });

  it('is whitespace/case-insensitive', () => {
    const doc = makeDom('<li>Buy   milk,\n eggs, and bread tomorrow.</li>');
    const el = findElementForSnippet(doc.body, 'buy milk, eggs, and bread');
    expect(el).not.toBeNull();
  });

  it('returns null when nothing matches (content changed since capture)', () => {
    const doc = makeDom('<p>Completely different content now.</p>');
    expect(findElementForSnippet(doc.body, 'this text was deleted after capture')).toBeNull();
  });

  it('prefers the smallest matching element over an ancestor container', () => {
    const doc = makeDom(`
      <div id="wrapper">
        <p id="target">Specific sentence about pricing tiers.</p>
        <p>Some other paragraph.</p>
      </div>
    `);
    const el = findElementForSnippet(doc.body, 'specific sentence about pricing tiers');
    expect((el as Element).id).toBe('target');
  });
});

describe('highlightCitationInDocument', () => {
  it('adds the highlight class and reports success on a real match', () => {
    const doc = makeDom('<p id="p1">The quarterly report shows steady growth.</p>');
    const found = highlightCitationInDocument(doc, 'the quarterly report shows steady growth');
    expect(found).toBe(true);
    expect(doc.getElementById('p1')?.classList.contains(CITATION_HIGHLIGHT_CLASS)).toBe(true);
  });

  it('honestly reports false when no match exists', () => {
    const doc = makeDom('<p>Nothing relevant here.</p>');
    expect(highlightCitationInDocument(doc, 'text that does not appear anywhere')).toBe(false);
  });
});
