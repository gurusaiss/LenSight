import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { genericWebAdapter } from '../../src/core/adapters/genericWebAdapter';
import { cleanText } from '../../src/core/processing/clean';
import { chunkDocument } from '../../src/core/processing/chunk';

const ARTICLE_HTML = `<!doctype html>
<html><head><title>Test Article — Local-First AI Assistants</title>
<meta name="author" content="Test Author" /></head>
<body>
<nav>Home | About | Contact</nav>
<header>Site Header</header>
<article>
  <h1>Why Local-First AI Assistants Matter</h1>
  <p>Local-first software keeps your data on your own device by default, giving you control over what leaves your machine and when.</p>
  <h2>Privacy By Architecture</h2>
  <p>Rather than trusting a policy promise, a local-first assistant is architected so that extraction, chunking, and embedding all happen on-device before any network call is made.</p>
</article>
<aside>Related articles sidebar</aside>
<footer>All rights reserved.</footer>
</body></html>`;

/**
 * Exercises the real genericWebAdapter + clean + chunk pipeline against a
 * real DOM (via jsdom) in Node, since the Playwright e2e browser download
 * was blocked in this environment (see tests/e2e/smoke.spec.ts and
 * docs/SETUP.md for details) — this gives direct automated coverage of the
 * adapter logic that the e2e test would otherwise be the only check for.
 */
describe('genericWebAdapter (real DOM via jsdom)', () => {
  it('extracts headings/paragraphs and strips nav/header/footer/aside boilerplate', () => {
    const dom = new JSDOM(ARTICLE_HTML, { url: 'https://example.com/article' });
    const extracted = genericWebAdapter.extractCurrentPage(dom.window.document as unknown as Document);

    expect(extracted).not.toBeNull();
    expect(extracted!.title).toContain('Test Article');
    expect(extracted!.text).toContain('Local-first software');
    expect(extracted!.text).not.toContain('Site Header');
    expect(extracted!.text).not.toContain('Related articles sidebar');
    expect(extracted!.text).not.toContain('Home | About | Contact');
  });

  it('feeds cleanly into chunking, producing at least one usable chunk', () => {
    const dom = new JSDOM(ARTICLE_HTML, { url: 'https://example.com/article' });
    const extracted = genericWebAdapter.extractCurrentPage(dom.window.document as unknown as Document)!;
    const cleaned = { ...extracted, text: cleanText(extracted.text), id: 'doc_1', sourceId: 'src_1' };
    const chunks = chunkDocument(cleaned);

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].text).toContain('Local-first software');
  });

  it('getMetadata reads title/author from the document', () => {
    const dom = new JSDOM(ARTICLE_HTML, { url: 'https://example.com/article' });
    const meta = genericWebAdapter.getMetadata(dom.window.document as unknown as Document);
    expect(meta.author).toBe('Test Author');
    expect(meta.title).toContain('Test Article');
  });

  it('falls back to raw text when the page has no headings/paragraphs at all', () => {
    const dom = new JSDOM('<html><body><div>just some plain text content here</div></body></html>', {
      url: 'https://example.com/plain',
    });
    const extracted = genericWebAdapter.extractCurrentPage(dom.window.document as unknown as Document);
    expect(extracted).not.toBeNull();
    expect(extracted!.text).toContain('just some plain text content here');
  });

  it('returns null for a document with an empty body', () => {
    const dom = new JSDOM('<html><body></body></html>', { url: 'https://example.com/empty' });
    const extracted = genericWebAdapter.extractCurrentPage(dom.window.document as unknown as Document);
    expect(extracted).toBeNull();
  });
});
